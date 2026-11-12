'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api-client';
import { foregroundFetch } from '../../../components/app-loading';
import { Button, ButtonLink } from '../../../components/actions';
import { AdminPageHeader } from '../../../components/admin/admin-page-header';
import { Panel } from '../../../components/admin/admin-ui';
import { Textarea, TextInput } from '../../../components/forms';
import { formatRupiah } from '../../../lib/formatters';
import { Feedback, Skeleton } from '../../../ui';

export type PratinjauRefund = {
  customerPackageId: string;
  member: { id: string; displayName: string };
  paket: { id: string; name: string; code: string | null };
  status: string;
  hargaDibayarRp: number;
  totalSesi: number;
  sisaSesi: number;
  sesiTerpakai: number;
  hargaPerSesiRp: number;
  nominalRefundRp: number;
  bookingAktif: number;
  bisaRefund: boolean;
};

const PESAN: Record<string, string> = {
  PACKAGE_HAS_ACTIVE_BOOKINGS: 'Paket ini masih punya booking aktif. Centang pembatalan booking untuk melanjutkan.',
  REFUND_NO_PAID_PURCHASE: 'Paket ini tidak punya pembelian lunas yang bisa direfund.',
  REFUND_NOTHING_LEFT: 'Sisa sesi paket ini sudah 0.',
  VALIDATION_ERROR: 'Periksa isian: nama bank, nomor rekening (angka), nama pemilik rekening, alasan (min. 10 karakter), dan bukti transfer (gambar/PDF).',
  FORBIDDEN: 'Akun Anda tidak berwenang memproses refund.',
  RESOURCE_NOT_FOUND: 'Paket tidak ditemukan di cabang Anda.',
};

/** Form refund paket: Admin, Manager, Owner, Super Owner. */
export function RefundBaruView() {
  const params = useSearchParams();
  const router = useRouter();
  const paketId = params.get('paket') ?? '';
  const [data, setData] = useState<PratinjauRefund | null>(null);
  const [gagalMuat, setGagalMuat] = useState('');
  const [bank, setBank] = useState('');
  const [nomor, setNomor] = useState('');
  const [nama, setNama] = useState('');
  const [alasan, setAlasan] = useState('');
  const [bukti, setBukti] = useState<File | null>(null);
  const [batalkanBooking, setBatalkanBooking] = useState(false);
  const [yakin, setYakin] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [gagal, setGagal] = useState('');

  useEffect(() => {
    if (!paketId) return;
    apiFetch<PratinjauRefund>(`/customer-packages/${encodeURIComponent(paketId)}/refund-preview`, {
      label: 'Menghitung refund…',
    })
      .then(setData)
      .catch((error) =>
        setGagalMuat((error instanceof ApiError && error.code && PESAN[error.code]) || 'Data paket belum dapat dimuat.'),
      );
  }, [paketId]);

  if (!paketId) return <Feedback kind="error">Paket tidak dipilih.</Feedback>;
  if (gagalMuat) return <Feedback kind="error">{gagalMuat}</Feedback>;
  if (!data) return <Skeleton label="Menghitung refund" />;

  const lengkap =
    bank.trim().length >= 2 &&
    /^\d{5,30}$/.test(nomor.replace(/[\s.-]/g, '')) &&
    nama.trim().length >= 2 &&
    alasan.trim().length >= 10 &&
    Boolean(bukti) &&
    (data.bookingAktif === 0 || batalkanBooking);

  const kirim = async () => {
    if (!bukti) return;
    setSibuk(true);
    setGagal('');
    const body = new FormData();
    body.set('bankName', bank.trim());
    body.set('nomorRekening', nomor.trim());
    body.set('namaRekening', nama.trim());
    body.set('alasan', alasan.trim());
    body.set('batalkanBooking', String(batalkanBooking));
    body.set('bukti', bukti);
    try {
      const response = await foregroundFetch(
        `/api/v1/package-refunds/${encodeURIComponent(paketId)}`,
        { method: 'POST', credentials: 'include', body },
        'Memproses refund…',
      );
      const hasil = await response.json().catch(() => null);
      if (!response.ok) {
        const code = hasil?.error?.code ?? hasil?.code;
        setGagal(PESAN[code as string] ?? 'Refund belum tersimpan. Coba lagi.');
        setYakin(false);
        return;
      }
      router.push(`/workspace/refunds/${encodeURIComponent(hasil.id)}`);
    } finally {
      setSibuk(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <AdminPageHeader
        title="Refund paket"
        description={`${data.member.displayName} · ${data.paket.name}`}
        actions={
          <ButtonLink variant="secondary" size="sm" href={`/ledger/${encodeURIComponent(paketId)}`}>
            Kembali ke paket
          </ButtonLink>
        }
      />

      <Panel className="space-y-3 p-5">
        <h2 className="m-0 text-base font-semibold">Perhitungan refund</h2>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
          <dt className="text-dd-muted">Harga final dibayar</dt>
          <dd className="m-0 text-right font-semibold">{formatRupiah(data.hargaDibayarRp)}</dd>
          <dt className="text-dd-muted">Total sesi paket</dt>
          <dd className="m-0 text-right">{data.totalSesi} sesi</dd>
          <dt className="text-dd-muted">Harga per sesi</dt>
          <dd className="m-0 text-right">{formatRupiah(data.hargaPerSesiRp)}</dd>
          <dt className="text-dd-muted">Sesi terpakai</dt>
          <dd className="m-0 text-right">{data.sesiTerpakai} sesi</dd>
          <dt className="text-dd-muted">Sisa sesi direfund</dt>
          <dd className="m-0 text-right">{data.sisaSesi} sesi</dd>
          <dt className="border-t border-dd-line pt-2 font-semibold">Total refund</dt>
          <dd className="m-0 border-t border-dd-line pt-2 text-right text-lg font-semibold text-dd-forest">
            {formatRupiah(data.nominalRefundRp)}
          </dd>
        </dl>
        <p className="m-0 text-xs text-dd-muted">
          Rumus: harga final ÷ total sesi × sisa sesi. Harga final adalah harga setelah promo/voucher, tanpa kode unik
          transfer.
        </p>
      </Panel>

      {!data.bisaRefund ? (
        <Feedback kind="warning">Paket ini tidak bisa direfund (belum lunas atau sisa sesinya 0).</Feedback>
      ) : (
        <Panel className="space-y-3 p-5">
          <h2 className="m-0 text-base font-semibold">Rekening tujuan dan bukti transfer</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Nama bank" placeholder="mis. BCA" value={bank} onChange={(e) => setBank(e.target.value)} />
            <TextInput
              label="Nomor rekening"
              inputMode="numeric"
              value={nomor}
              onChange={(e) => setNomor(e.target.value)}
            />
          </div>
          <TextInput label="Nama pemilik rekening" value={nama} onChange={(e) => setNama(e.target.value)} />
          <Textarea
            label="Alasan refund (minimal 10 karakter)"
            rows={3}
            maxLength={500}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
          />
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Bukti transfer refund (gambar atau PDF, maks. 8 MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setBukti(e.target.files?.[0] ?? null)}
            />
          </label>
          {data.bookingAktif > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={batalkanBooking} onChange={(e) => setBatalkanBooking(e.target.checked)} />
              <span>Batalkan {data.bookingAktif} booking aktif dari paket ini (wajib untuk melanjutkan).</span>
            </label>
          )}
          {yakin && (
            <Feedback kind="warning">
              Refund {formatRupiah(data.nominalRefundRp)} untuk {data.member.displayName}. Sisa {data.sisaSesi} sesi paket
              akan dinolkan dan tidak bisa dipakai lagi. Lanjutkan?
            </Feedback>
          )}
          {gagal && <Feedback kind="error">{gagal}</Feedback>}
          <div className="flex flex-wrap justify-end gap-2">
            {yakin && (
              <Button variant="secondary" disabled={sibuk} onClick={() => setYakin(false)}>
                Kembali
              </Button>
            )}
            <Button disabled={!lengkap || sibuk} onClick={() => (yakin ? void kirim() : setYakin(true))}>
              {yakin ? 'Ya, proses refund' : 'Lanjut'}
            </Button>
          </div>
        </Panel>
      )}
    </main>
  );
}
