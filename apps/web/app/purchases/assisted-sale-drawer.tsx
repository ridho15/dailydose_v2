'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assistedPaymentMethodLabels,
  assistedSaleFailure,
  browserAssistedSaleClient,
  type AssistedPaymentMethod,
  type AssistedSaleClient,
  type AssistedSalePricePreview,
  type ExtensionTargetList,
  type Purchase,
} from '@/api-clients/purchase-client';
import { customerClient } from '../customers/customer-client';
import { Feedback } from '../ui';
import { Button, ButtonLink } from '../components/actions';
import { Drawer, useAppFeedback } from '../components/app-feedback';
import {
  AsyncSearchSelect,
  SearchSelect,
  SelectInput,
  TextInput,
  type SearchSelectOption,
} from '../components/forms';
import { formatRupiah } from '../lib/formatters';
import { formatPaymentCode } from '../lib/order-presenters';
import { browserOrderClient, sha256Upload } from '@/api-clients/order-client';
import { compressImageIfNeeded } from '@/lib/image-compression';

type PackageOption = SearchSelectOption & { priceRp: number; perpanjangan: boolean };
type TargetState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; list: ExtensionTargetList }
  | { status: 'error'; message: string };
const NO_BRANCHES: Array<{ id: string; name: string }> = [];

async function kirimBuktiManual(purchase: Purchase, file: File) {
  const compressed = await compressImageIfNeeded(file);
  const sha256 = await sha256Upload(compressed);
  await browserOrderClient.uploadProof(purchase as never, compressed, sha256, undefined);
}

/**
 * Penjualan manual di meja. Staf mencatat pembayaran yang diterima; paket baru aktif setelah
 * penyetuju LAIN menyetujuinya di antrean Pembayaran (pencatat tidak boleh menyetujui sendiri).
 */
export function AssistedSaleDrawer({
  open,
  branch,
  branches = NO_BRANCHES,
  customer,
  client = browserAssistedSaleClient,
  onClose,
  onRecorded,
  perpanjangTargetId,
}: {
  open: boolean;
  /** Cabang aktif di topbar; bila kosong, staf memilih cabang penjualan di formulir. */
  branch?: { id: string; name: string } | null;
  /** Cabang yang dapat dipilih ketika tidak ada cabang aktif. */
  branches?: Array<{ id: string; name: string }>;
  /** Bila diisi, pelanggan terkunci (dibuka dari halaman detail pelanggan). */
  customer?: { id: string; name: string };
  client?: AssistedSaleClient;
  onClose(): void;
  onRecorded?(purchase: Purchase): void;
  /** Dibuka dari tombol "Perpanjang berbayar": paket perpanjangan dan paket member ini langsung terpilih. */
  perpanjangTargetId?: string;
}) {
  const feedback = useAppFeedback();
  const [customerOption, setCustomerOption] = useState<SearchSelectOption | undefined>(
    customer ? { id: customer.id, label: customer.name } : undefined,
  );
  const [packageOption, setPackageOption] = useState<PackageOption>();
  const [method, setMethod] = useState<AssistedPaymentMethod>('CASH');
  const [voucherCode, setVoucherCode] = useState('');
  const [note, setNote] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [chosenBranchId, setChosenBranchId] = useState('');
  const [targets, setTargets] = useState<TargetState>({ status: 'idle' });
  const [targetId, setTargetId] = useState('');
  const [pricePreview, setPricePreview] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data?: AssistedSalePricePreview;
    message?: string;
  }>({ status: 'idle' });
  const [recordedPurchase, setRecordedPurchase] = useState<Purchase | null>(null);
  const [step2File, setStep2File] = useState<File | null>(null);
  const [step2Uploading, setStep2Uploading] = useState(false);
  const [step2Uploaded, setStep2Uploaded] = useState(false);
  const [step2Error, setStep2Error] = useState('');
  const idempotencyKey = useRef<string | undefined>(undefined);
  const branchKey = branches.map((item) => item.id).join('|');
  const dirty = Boolean(
    !recordedPurchase &&
      ((!customer && customerOption) || packageOption || voucherCode.trim() || note.trim() || Boolean(proofFile)),
  );

  useEffect(() => {
    if (!open) return;
    setCustomerOption(customer ? { id: customer.id, label: customer.name } : undefined);
    setPackageOption(undefined);
    setChosenBranchId(branch?.id ?? (branches.length === 1 ? branches[0]!.id : ''));
    setMethod('CASH');
    setVoucherCode('');
    setNote('');
    setProofFile(null);
    setFailure('');
    setPricePreview({ status: 'idle' });
    setRecordedPurchase(null);
    setStep2File(null);
    setStep2Uploading(false);
    setStep2Uploaded(false);
    setStep2Error('');
    idempotencyKey.current = undefined;
  }, [open, customer?.id, customer?.name, branch?.id, branchKey]);

  const searchCustomers = useCallback(async (query: string) => {
    const result = await customerClient.list({ q: query || undefined, status: 'ACTIVE' });
    return {
      items: result.items.map((item) => ({
        id: item.id,
        label: item.displayName,
        description: [item.phoneE164, item.email].filter(Boolean).join(' · ') || undefined,
      })),
      nextCursor: result.page.nextCursor ?? undefined,
    };
  }, []);

  const saleBranch = branch ?? branches.find((item) => item.id === chosenBranchId) ?? null;
  const saleBranchId = saleBranch?.id ?? '';
  const searchPackages = useCallback(
    async (query: string) => {
      const packages = await client.searchPackages(query);
      return packages
        .filter((pkg) => !pkg.branchId || pkg.branchId === saleBranchId)
        .map<PackageOption>((pkg) => ({
          id: pkg.id,
          label: pkg.name,
          description: pkg.perpanjanganMasaAktif
            ? `${formatRupiah(pkg.priceRp)} · perpanjangan masa aktif ${pkg.durationDays > 0 ? pkg.durationDays : 30} hari`
            : `${formatRupiah(pkg.priceRp)} · ${pkg.sessionCount} sesi · ${pkg.durationDays} hari`,
          priceRp: pkg.priceRp,
          perpanjangan: Boolean(pkg.perpanjanganMasaAktif),
        }));
    },
    [client, saleBranchId],
  );

  // Dari tombol "Perpanjang berbayar": pilih paket perpanjangan yang dijual di cabang ini secara otomatis.
  useEffect(() => {
    if (!open || !perpanjangTargetId || !saleBranchId) return;
    let active = true;
    searchPackages('')
      .then((list) => {
        const pilihan = list.find((pkg) => pkg.perpanjangan);
        if (!active) return;
        if (pilihan) {
          setPackageOption(pilihan);
          setMethod('BANK_TRANSFER');
        } else setFailure('Belum ada paket perpanjangan masa aktif yang dijual di cabang ini. Buat dulu di Kelola Paket.');
      })
      .catch((error) => active && setFailure(assistedSaleFailure(error)));
    return () => {
      active = false;
    };
  }, [open, perpanjangTargetId, saleBranchId, searchPackages]);

  // Paket perpanjangan masa aktif: muat paket aktif member untuk dipilih yang diperpanjang.
  const isExtension = Boolean(packageOption?.perpanjangan);
  const customerId = customerOption?.id ?? '';
  useEffect(() => {
    setTargetId('');
    if (!open || !isExtension || !customerId || !saleBranchId) {
      setTargets({ status: 'idle' });
      return;
    }
    const load = client.extensionTargets ?? browserAssistedSaleClient.extensionTargets!;
    let active = true;
    setTargets({ status: 'loading' });
    load(customerId, saleBranchId, packageOption?.id)
      .then((list) => {
        if (!active) return;
        setTargets({ status: 'ready', list });
        const eligible = list.items.filter((item) => item.extensionsLeft > 0);
        const diminta = perpanjangTargetId && eligible.find((item) => item.customerPackageId === perpanjangTargetId);
        if (diminta) setTargetId(diminta.customerPackageId);
        else if (eligible.length === 1) setTargetId(eligible[0]!.customerPackageId);
      })
      .catch((error) => {
        if (active) setTargets({ status: 'error', message: assistedSaleFailure(error) });
      });
    return () => {
      active = false;
    };
  }, [open, isExtension, customerId, saleBranchId, client, perpanjangTargetId, packageOption?.id]);

  // Hitung rincian tagihan (promo + voucher + rekening tujuan) secara otomatis di form admin.
  useEffect(() => {
    if (!open || !saleBranchId || !packageOption?.id) {
      setPricePreview({ status: 'idle' });
      return;
    }
    const previewFn = client.previewPrice;
    if (!previewFn) {
      setPricePreview({ status: 'idle' });
      return;
    }
    let active = true;
    const trimmedVoucher = voucherCode.trim();
    const timer = setTimeout(() => {
      setPricePreview((prev) => ({ status: 'loading', data: prev.data }));
      previewFn({
        branchId: saleBranchId,
        packageId: packageOption.id,
        paymentMethod: method,
        ...(trimmedVoucher.length >= 3 ? { voucherCode: trimmedVoucher } : {}),
      })
        .then((data) => active && setPricePreview({ status: 'ready', data }))
        .catch((err) => active && setPricePreview({ status: 'error', message: assistedSaleFailure(err) }));
    }, trimmedVoucher ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, saleBranchId, packageOption?.id, method, voucherCode, client]);

  // Lama perpanjangan mengikuti paket perpanjangan yang dipilih (dari server; bawaan 30 hari).
  const hariTambah = targets.status === 'ready' ? targets.list.days : 30;
  const selectedTarget =
    targets.status === 'ready' ? targets.list.items.find((item) => item.customerPackageId === targetId) : undefined;
  // Transfer bank baru mendapat kode unik 3 digit setelah transaksi dicatat, sehingga unggah bukti
  // dilakukan setelah submit (Tahap 2). Metode non-transfer untuk paket kedaluwarsa tetap wajib bukti
  // sebelum dicatat karena nominal sudah pasti di meja.
  const isBankTransfer = method === 'BANK_TRANSFER';
  const wajibBuktiDiAwal = Boolean(selectedTarget?.kedaluwarsa) && !isBankTransfer;
  const ready = Boolean(
    customerOption && packageOption && saleBranch && (!isExtension || selectedTarget) && (!wajibBuktiDiAwal || proofFile),
  );
  const displaySubtotalRp = pricePreview.data?.subtotalRp ?? packageOption?.priceRp ?? 0;
  const displayTotalRp = pricePreview.data?.baseAmountRp ?? packageOption?.priceRp ?? 0;

  const submit = async () => {
    if (!customerOption || !packageOption || !saleBranch) return;
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Catat penjualan paket?',
      message: (selectedTarget
        ? selectedTarget.kedaluwarsa
          ? `${packageOption.label} untuk ${customerOption.label} (${formatRupiah(displayTotalRp)}, ${assistedPaymentMethodLabels[method]}). ${selectedTarget.packageName} sudah kedaluwarsa; setelah penyetuju lain menyetujuinya di antrean Pembayaran, paket aktif lagi ${hariTambah} hari dari hari disetujui.`
          : `${packageOption.label} untuk ${customerOption.label} (${formatRupiah(displayTotalRp)}, ${assistedPaymentMethodLabels[method]}). Masa aktif ${selectedTarget.packageName} bertambah ${hariTambah} hari setelah penyetuju lain menyetujuinya di antrean Pembayaran.`
        : `${packageOption.label} untuk ${customerOption.label} (${formatRupiah(displayTotalRp)}, ${assistedPaymentMethodLabels[method]}). Paket aktif setelah penyetuju lain menyetujuinya di antrean Pembayaran.`)
        + ' Dengan mencatat, Anda menyatakan sudah menyampaikan Syarat & Ketentuan kepada member: paket hangus saat masa berlaku habis, perpanjangan maksimal 3 kali, dan pembayaran tidak dapat dikembalikan.',
      confirmLabel: 'Catat penjualan',
    });
    if (!accepted) return;
    setBusy(true);
    setFailure('');
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const purchase = await client.record(
        {
          customerUserId: customerOption.id,
          packageId: packageOption.id,
          branchId: saleBranch.id,
          paymentMethod: method,
          voucherCode: voucherCode.trim() || undefined,
          note: note.trim() || undefined,
          ...(selectedTarget ? { targetCustomerPackageId: selectedTarget.customerPackageId } : {}),
        },
        idempotencyKey.current,
      );
      let buktiTersimpan = false;
      if (!isBankTransfer && proofFile) {
        try {
          await kirimBuktiManual(purchase, proofFile);
          buktiTersimpan = true;
        } catch (proofErr) {
          console.error('Gagal melampirkan bukti manual:', proofErr);
          feedback.showToast({
            tone: 'warning',
            title: 'Penjualan dicatat, namun bukti gagal diunggah',
            message: 'Anda dapat mengunggah ulang bukti di halaman Detail Pembayaran.',
          });
        }
      }
      feedback.showToast({
        tone: 'success',
        title: 'Penjualan dicatat',
        message: isBankTransfer
          ? 'Kode unik dibuat. Unggah bukti transfer setelah member membayar sesuai nominal.'
          : buktiTersimpan
            ? 'Penjualan dan bukti pembayaran berhasil disimpan.'
            : 'Menunggu persetujuan penyetuju lain di antrean Pembayaran.',
      });
      if (isBankTransfer || purchase.paymentUniqueCode || purchase.extension) {
        setRecordedPurchase(purchase);
      } else {
        onRecorded?.(purchase);
        onClose();
      }
    } catch (error) {
      setFailure(assistedSaleFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadStep2Proof = async () => {
    if (!recordedPurchase || !step2File) return;
    setStep2Uploading(true);
    setStep2Error('');
    try {
      await kirimBuktiManual(recordedPurchase, step2File);
      setStep2Uploaded(true);
      setStep2File(null);
      feedback.showToast({
        tone: 'success',
        title: 'Bukti transfer berhasil diunggah',
        message: 'Pembayaran siap diperiksa penyetuju lain di antrean Pembayaran.',
      });
    } catch {
      setStep2Error('Bukti belum dapat diunggah. Coba lagi atau unggah lewat Detail Pembayaran.');
    } finally {
      setStep2Uploading(false);
    }
  };

  const finishRecorded = () => {
    if (!recordedPurchase) return;
    const saved = recordedPurchase;
    setRecordedPurchase(null);
    setStep2File(null);
    setStep2Uploaded(false);
    setStep2Error('');
    onRecorded?.(saved);
    onClose();
  };

  return (
    <Drawer
      open={open}
      title={recordedPurchase ? 'Penjualan tercatat' : 'Catat penjualan paket'}
      description={
        recordedPurchase
          ? 'Berikan rincian tagihan berikut kepada member, lalu lanjutkan ke persetujuan pembayaran.'
          : saleBranch
            ? `Penjualan di meja untuk cabang ${saleBranch.name}.`
            : 'Pilih cabang tempat penjualan terjadi.'
      }
      busy={busy}
      dirty={dirty}
      onDirtyClose={() =>
        feedback.confirm({
          tone: 'warning',
          title: 'Buang isian penjualan?',
          message: 'Data yang belum dicatat akan hilang.',
          confirmLabel: 'Buang',
        })
      }
      onClose={recordedPurchase ? finishRecorded : onClose}
      footer={
        recordedPurchase ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" onClick={finishRecorded}>
              Selesai
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" form="assisted-sale-form" loading={busy} disabled={!ready}>
              Catat penjualan
            </Button>
          </div>
        )
      }
    >
      {recordedPurchase ? (
        <div className="grid gap-4" data-testid="assisted-sale-recorded-summary">
          <div className="rounded-dd-md border border-dd-forest/30 bg-dd-forest/5 p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-dd-forest">
              Total yang harus dibayar
            </p>
            <p className="text-2xl font-bold text-dd-ink tabular-nums">
              {formatRupiah(
                recordedPurchase.payableAmountRp ??
                  recordedPurchase.payableAmountRpSnapshot ??
                  recordedPurchase.priceRpSnapshot ??
                  displayTotalRp,
              )}
            </p>
            {Number(recordedPurchase.paymentUniqueCode) > 0 && (
              <p className="text-xs font-semibold text-dd-forest">
                Termasuk kode unik transfer: {formatPaymentCode(recordedPurchase.paymentUniqueCode ?? null)}
              </p>
            )}
            {recordedPurchase.paymentAccount && (
              <p className="text-xs text-dd-ink pt-1">
                Transfer ke <strong>{recordedPurchase.paymentAccount.bankName}</strong>{' '}
                <span className="font-mono font-semibold">{recordedPurchase.paymentAccount.accountNumber}</span>{' '}
                a.n. {recordedPurchase.paymentAccount.accountHolderName}
              </p>
            )}
          </div>
          {recordedPurchase.extension && (
            <div className="rounded-dd-md border border-dd-line bg-white p-3 text-sm space-y-1">
              <p className="font-semibold text-dd-ink">
                Perpanjangan: {recordedPurchase.extension.targetPackageName ?? 'Paket member'} (+{recordedPurchase.extension.days} hari)
              </p>
              <p className="text-xs text-dd-muted">
                Paket akan diperpanjang otomatis setelah transaksi ini disetujui penyetuju lain di Antrean Pembayaran.
              </p>
            </div>
          )}
          {(recordedPurchase.paymentMethod === 'BANK_TRANSFER' || Number(recordedPurchase.paymentUniqueCode) > 0) && (
            <div
              className="space-y-2 rounded-dd-sm border border-dashed border-dd-line bg-dd-surface-muted/40 p-3"
              data-testid="assisted-sale-step2-proof-box"
            >
              {step2Uploaded ? (
                <p
                  role="status"
                  className="rounded-dd-sm border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-700"
                >
                  Bukti transfer berhasil diunggah. Menunggu verifikasi penyetuju lain di Antrean Pembayaran.
                </p>
              ) : (
                <>
                  <label htmlFor="assisted-sale-step2-proof" className="block text-xs font-semibold text-dd-ink">
                    Unggah bukti transfer (sesuai nominal di atas)
                  </label>
                  <p className="text-xs text-dd-muted">
                    {selectedTarget?.kedaluwarsa
                      ? 'Wajib sebelum Finance menyetujui perpanjangan paket kedaluwarsa. Unggah di sini setelah member transfer, atau nanti lewat Detail Pembayaran.'
                      : 'Unggah di sini setelah member mentransfer tepat sesuai kode unik, atau nanti lewat Detail Pembayaran.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="assisted-sale-step2-proof"
                      type="file"
                      data-testid="input-assisted-sale-proof-step2"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      disabled={step2Uploading}
                      onChange={(e) => {
                        setStep2File(e.target.files?.[0] ?? null);
                        setStep2Error('');
                      }}
                      className="text-xs file:mr-2 file:rounded-dd-sm file:border-0 file:bg-dd-forest/10 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-dd-forest hover:file:bg-dd-forest/20 cursor-pointer"
                    />
                    {step2File && (
                      <Button
                        type="button"
                        size="sm"
                        data-testid="btn-upload-proof-step2"
                        loading={step2Uploading}
                        onClick={() => void uploadStep2Proof()}
                      >
                        Unggah bukti
                      </Button>
                    )}
                  </div>
                  {step2Error && <Feedback kind="error">{step2Error}</Feedback>}
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/workspace/payments/${encodeURIComponent(recordedPurchase.id)}`}>
              Buka detail pembayaran
            </ButtonLink>
            {recordedPurchase.extension?.targetCustomerPackageId && (
              <ButtonLink
                variant="secondary"
                href={`/ledger/${encodeURIComponent(recordedPurchase.extension.targetCustomerPackageId)}`}
              >
                Lihat detail paket member
              </ButtonLink>
            )}
          </div>
        </div>
      ) : (
      <form
        id="assisted-sale-form"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {customer ? (
          <TextInput label="Pelanggan" value={customer.name} readOnly />
        ) : (
          <AsyncSearchSelect
            label="Pelanggan"
            required
            value={customerOption?.id ?? ''}
            selectedOption={customerOption}
            placeholder="Cari nama, email, atau telepon"
            loadOptions={searchCustomers}
            onChange={(_id, option) => setCustomerOption(option)}
          />
        )}
        {!branch && (
          <SearchSelect
            label="Cabang penjualan"
            required
            value={chosenBranchId}
            placeholder="Pilih cabang"
            options={branches.map((item) => ({ id: item.id, label: item.name }))}
            onChange={(value) => {
              setChosenBranchId(value);
              setPackageOption(undefined);
            }}
          />
        )}
        <AsyncSearchSelect
          key={saleBranchId || 'no-branch'}
          label="Paket"
          required
          disabled={!saleBranch}
          value={packageOption?.id ?? ''}
          selectedOption={packageOption}
          placeholder="Pilih paket aktif"
          loadOptions={searchPackages}
          onChange={(_id, option) => setPackageOption(option as PackageOption | undefined)}
        />
        {isExtension && (
          <fieldset className="grid gap-2 rounded-dd-md border border-dd-line p-3">
            <legend className="px-1 text-sm font-semibold text-dd-ink">Paket member yang diperpanjang</legend>
            <p className="text-xs text-dd-muted">
              Masa aktif bertambah {hariTambah} hari setelah pembayaran disetujui (paket aktif ditambah dari tanggal
              berakhir saat ini; paket kedaluwarsa dihitung dari hari disetujui). Paling banyak 3 kali per paket.
            </p>
            {!customerOption ? (
              <p className="text-sm text-dd-muted">Pilih pelanggan terlebih dahulu.</p>
            ) : targets.status === 'loading' ? (
              <p className="text-sm text-dd-muted" role="status">
                Memuat paket aktif member…
              </p>
            ) : targets.status === 'error' ? (
              <Feedback kind="error">{targets.message}</Feedback>
            ) : targets.status === 'ready' && targets.list.items.length === 0 ? (
              <Feedback kind="warning">
                Member ini tidak punya paket aktif yang bisa diperpanjang atau paket kedaluwarsa yang masih bersisa
                sesi. Jual paket baru untuk melanjutkan latihan.
              </Feedback>
            ) : targets.status === 'ready' ? (
              targets.list.items.map((item) => {
                const full = item.extensionsLeft <= 0;
                return (
                  <label
                    key={item.customerPackageId}
                    className={`flex min-h-[44px] items-start gap-2 rounded-dd-sm border p-2.5 text-sm ${
                      targetId === item.customerPackageId ? 'border-dd-forest bg-dd-forest/5' : 'border-dd-line'
                    } ${full ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <input
                      type="radio"
                      name="extensionTarget"
                      value={item.customerPackageId}
                      checked={targetId === item.customerPackageId}
                      disabled={full}
                      onChange={() => setTargetId(item.customerPackageId)}
                      className="mt-0.5 size-4 shrink-0 accent-dd-forest"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-semibold text-dd-ink">{item.packageName}</span>
                      <span className="text-xs text-dd-muted">
                        Sisa {item.remainingSessions} sesi ·{' '}
                        {item.kedaluwarsa ? (
                          <span className="font-semibold text-dd-danger">kedaluwarsa sejak {tanggalWib(item.validUntil)}</span>
                        ) : (
                          `berlaku sampai ${tanggalWib(item.validUntil)}`
                        )}
                        {full ? '' : `, menjadi ${tanggalWib(item.validUntilAfterExtension)}${item.kedaluwarsa ? ' (dihitung dari hari disetujui, wajib bukti bayar)' : ''}`}
                      </span>
                      <span className="text-xs text-dd-muted">
                        {full
                          ? item.extensionsPending > 0
                            ? 'Batas 3 kali sudah terisi (termasuk pesanan yang menunggu pembayaran).'
                            : 'Sudah diperpanjang 3 kali, batas maksimal.'
                          : `Sudah diperpanjang ${item.extensionsUsed} dari ${targets.list.maxPerPackage} kali.`}
                      </span>
                    </span>
                  </label>
                );
              })
            ) : null}
          </fieldset>
        )}
        <SelectInput
          label="Metode pembayaran"
          value={method}
          onChange={(event) => {
            const next = event.target.value as AssistedPaymentMethod;
            setMethod(next);
            if (next === 'BANK_TRANSFER') setProofFile(null);
          }}
        >
          {Object.entries(assistedPaymentMethodLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Kode voucher (opsional)"
          value={voucherCode}
          maxLength={40}
          onChange={(event) => setVoucherCode(event.target.value)}
        />
        <TextInput
          label="Catatan (opsional)"
          value={note}
          maxLength={200}
          placeholder="Contoh: dibayar tunai di meja resepsionis"
          onChange={(event) => setNote(event.target.value)}
        />
        {!isBankTransfer && (
          <div className="space-y-1.5 rounded-dd-sm border border-dashed border-dd-line bg-dd-surface-muted/40 p-3">
            <label className="block text-xs font-semibold text-dd-ink">
              Bukti transfer / struk pembayaran {wajibBuktiDiAwal ? '(wajib untuk paket kedaluwarsa)' : '(opsional)'}
            </label>
            <p className="text-xs text-dd-muted">
              Format: JPG, PNG, WebP, PDF. Otomatis dikompresi agar hemat kuota.
            </p>
            <input
              type="file"
              data-testid="input-assisted-sale-proof"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setProofFile(file);
              }}
              className="text-xs file:mr-2 file:rounded-dd-sm file:border-0 file:bg-dd-forest/10 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-dd-forest hover:file:bg-dd-forest/20 cursor-pointer"
            />
            {proofFile && (
              <p className="text-xs text-emerald-700 font-medium">
                File dipilih: {proofFile.name} ({(proofFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        )}

        {packageOption && (
          <div
            className="rounded-dd-md border border-dd-forest/30 bg-dd-forest/5 p-3 text-sm space-y-1.5"
            data-testid="assisted-sale-payment-summary"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-dd-muted">Harga paket</span>
              <span className="font-medium text-dd-ink tabular-nums">{formatRupiah(displaySubtotalRp)}</span>
            </div>
            {pricePreview.data?.promotion && pricePreview.data.promotion.discountRp > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-dd-muted">Promo ({pricePreview.data.promotion.name})</span>
                <span className="font-semibold text-dd-forest tabular-nums">
                  −{formatRupiah(pricePreview.data.promotion.discountRp)}
                </span>
              </div>
            )}
            {pricePreview.data?.voucher && pricePreview.data.voucher.discountRp > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-dd-muted">Voucher ({pricePreview.data.voucher.code})</span>
                <span className="font-semibold text-dd-forest tabular-nums">
                  −{formatRupiah(pricePreview.data.voucher.discountRp)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-dd-line pt-1.5">
              <span className="font-semibold text-dd-ink">Total yang harus dibayar</span>
              <span className="text-base font-bold text-dd-forest tabular-nums">
                {formatRupiah(displayTotalRp)}
              </span>
            </div>
            {method === 'BANK_TRANSFER' && (
              <p className="text-xs text-dd-muted">
                Kode unik transfer 3 digit akan ditambahkan otomatis setelah penjualan dicatat, lalu Anda dapat langsung mengunggah bukti transfernya.
                {pricePreview.data?.paymentAccount
                  ? ` Rekening: ${pricePreview.data.paymentAccount.bankName} ${pricePreview.data.paymentAccount.accountNumber} (a.n. ${pricePreview.data.paymentAccount.accountHolderName}).`
                  : ''}
              </p>
            )}
            {pricePreview.status === 'error' && pricePreview.message && (
              <p className="text-xs font-medium text-dd-danger">{pricePreview.message}</p>
            )}
          </div>
        )}

        <Feedback kind="info">
          Penjualan dicatat dengan status menunggu. Pencatat tidak dapat menyetujui penjualannya
          sendiri; persetujuan dilakukan oleh Finance atau Manager di antrean Pembayaran.
        </Feedback>
        {failure && <Feedback kind="error">{failure}</Feedback>}
      </form>
      )}
    </Drawer>
  );
}

function tanggalWib(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(
    new Date(value),
  );
}
