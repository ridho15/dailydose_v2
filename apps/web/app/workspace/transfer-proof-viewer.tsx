'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  purchaseFailure,
  type CekOtomatisBukti,
  type PaymentReviewItem,
  type PurchaseReviewClient,
} from '@/api-clients/purchase-client';
import { orderReasonLabels } from '@/lib/order-presenters';
import { Button } from '../components/actions';
import { Modal } from '../components/app-feedback';
import { Textarea } from '../components/forms';
import { Feedback, Skeleton } from '../ui';
import { ProofImageViewer } from './payments/[id]/proof-image-viewer';

export type KodeTolakTransfer =
  | 'PROOF_INVALID'
  | 'AMOUNT_MISMATCH'
  | 'DUPLICATE_PURCHASE'
  | 'OTHER_REVIEW_REQUIRED';

/** Chip alasan memakai kode yang sama dengan yang dibaca member di halaman pesanannya. */
export const ALASAN_TOLAK_TRANSFER: { kode: KodeTolakTransfer; label: string }[] = [
  { kode: 'PROOF_INVALID', label: 'Bukti tidak jelas' },
  { kode: 'AMOUNT_MISMATCH', label: 'Nominal tidak sesuai' },
  { kode: 'DUPLICATE_PURCHASE', label: 'Transaksi ganda' },
  { kode: 'OTHER_REVIEW_REQUIRED', label: 'Lainnya' },
];

export interface KeputusanTransfer {
  keputusan: 'approve' | 'reject';
  purchase: PaymentReviewItem;
  kode?: KodeTolakTransfer;
  catatan?: string;
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/** Penjelasan hasil cek otomatis untuk staf: kenapa sistem tidak menyetujui sendiri. */
export const ALASAN_CEK_OTOMATIS: Record<string, string> = {
  NOMINAL_TIDAK_DITEMUKAN: 'Nominal unik tidak terbaca di foto bukti.',
  WAKTU_TIDAK_TERBACA: 'Tanggal dan jam transfer tidak terbaca di foto bukti.',
  WAKTU_DI_LUAR_JENDELA: 'Waktu transfer di foto lebih dari 1 jam sebelum bukti diunggah, atau sebelum pesanan dibuat.',
  FOTO_DIPAKAI_ULANG: 'Foto yang sama pernah dipakai untuk pesanan lain.',
  BUKAN_GAMBAR: 'Bukti berupa PDF; sistem hanya membaca foto.',
  GAGAL_BACA: 'Foto tidak bisa dibaca sistem (OCR gagal).',
  TANPA_KODE_UNIK: 'Pesanan ini tidak punya kode unik.',
  BUKAN_TRANSFER_BANK: 'Metode bayarnya bukan transfer bank.',
  TABEL_BUKTI_SIDIK_BELUM_ADA: 'Fitur belum aktif di server: tabel bukti_sidik belum dibuat.',
  PENYIMPANAN_TIDAK_SIAP: 'Fitur belum aktif di server: penyimpanan berkas belum terhubung.',
  GALAT_SISTEM: 'Cek otomatis gagal karena galat sistem.',
};

const jamWib = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(
    new Date(iso),
  );

export function PenjelasanCekOtomatis({ cek }: { cek: CekOtomatisBukti }) {
  if (cek.hasil === 'COCOK') return null;
  const terbaca = [
    cek.nominalTerbaca.length ? `angka ${cek.nominalTerbaca.map((n) => n.toLocaleString('id-ID')).join(', ')}` : '',
    cek.waktuTerbaca.length ? `waktu ${cek.waktuTerbaca.map(jamWib).join(', ')}` : '',
  ].filter(Boolean);
  return (
    <Feedback kind="warning">
      Belum disetujui otomatis: {ALASAN_CEK_OTOMATIS[cek.hasil] ?? cek.hasil}
      {terbaca.length > 0 && ` Terbaca di foto: ${terbaca.join('; ')}.`} Periksa manual lalu putuskan.
    </Feedback>
  );
}

/**
 * Langkah kedua persetujuan transfer: bukti dibuka layar penuh, lalu Setujui atau Tolak di tempat.
 * Setujui baru aktif setelah gambar/PDF bukti benar-benar tampil, sama seperti halaman detail.
 * Keputusan diteruskan ke pemanggil, yang menundanya 10 detik supaya masih bisa dibatalkan.
 */
export function TransferProofViewer({
  purchaseId,
  client,
  onClose,
  onDecide,
  posisi,
  onLewati,
}: {
  purchaseId: string | null;
  client: PurchaseReviewClient;
  onClose(): void;
  onDecide(keputusan: KeputusanTransfer): void;
  /** Mode periksa berurutan: mis. "sisa 9", tampil di judul. */
  posisi?: string;
  /** Mode periksa berurutan: lewati transfer ini dan buka berikutnya. */
  onLewati?(): void;
}) {
  const [purchase, setPurchase] = useState<PaymentReviewItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState('');
  const [terbuka, setTerbuka] = useState(false);
  const [galat, setGalat] = useState('');
  const [menolak, setMenolak] = useState(false);
  const [kode, setKode] = useState<KodeTolakTransfer | null>(null);
  const [catatan, setCatatan] = useState('');

  useEffect(() => {
    if (!purchaseId) return;
    let batal = false;
    let blobUrl: string | null = null;
    setPurchase(null);
    setUrl(null);
    setTerbuka(false);
    setGalat('');
    setMenolak(false);
    setKode(null);
    setCatatan('');
    (async () => {
      try {
        const detail = await client.detail(purchaseId);
        if (batal) return;
        setPurchase(detail.purchase);
        const bukti = detail.purchase.paymentProof;
        if (!bukti) {
          // QRIS yang dicatat staf boleh tanpa gambar; transfer bank wajib bukti (dicek ulang server).
          if (detail.purchase.paymentMethod === 'QRIS') setTerbuka(true);
          else setGalat('Bukti transfer belum ada. Buka detail pembayaran untuk mengunggah bukti manual.');
          return;
        }
        if (bukti.scanStatus !== 'CLEAN') {
          setGalat('Berkas bukti masih diperiksa sistem. Coba lagi beberapa saat lagi.');
          return;
        }
        const blob = await client.loadProof(bukti.id);
        if (batal) return;
        blobUrl = URL.createObjectURL(blob);
        setMime(blob.type || bukti.mimeType);
        setUrl(blobUrl);
      } catch (cause) {
        if (!batal) setGalat(purchaseFailure(cause));
      }
    })();
    return () => {
      batal = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [client, purchaseId]);

  const nominal = purchase ? (purchase.payableAmountRpSnapshot ?? purchase.priceRpSnapshot) : 0;
  const perluCatatan = kode === 'OTHER_REVIEW_REQUIRED';
  const siapTolak = Boolean(kode) && (!perluCatatan || catatan.trim().length >= 3);

  return (
    <Modal
      open={Boolean(purchaseId)}
      title={`${purchase ? `Bukti transfer ${purchase.customer.displayName}` : 'Bukti transfer'}${posisi ? ` (${posisi})` : ''}`}
      description={
        purchase
          ? `${purchase.packageNameSnapshot} · ${purchase.branch.name} · ${rp(nominal)}`
          : undefined
      }
      onClose={onClose}
      className="max-w-4xl"
      footer={
        purchase && (
          <div className="flex flex-wrap justify-end gap-2">
            {menolak ? (
              <>
                <Button variant="secondary" onClick={() => setMenolak(false)}>
                  Kembali
                </Button>
                <Button
                  variant="danger"
                  disabled={!siapTolak}
                  leadingIcon={<XCircle className="size-4" aria-hidden="true" />}
                  onClick={() =>
                    kode &&
                    onDecide({
                      keputusan: 'reject',
                      purchase,
                      kode,
                      catatan: catatan.trim() || undefined,
                    })
                  }
                >
                  Tolak pembayaran
                </Button>
              </>
            ) : (
              <>
                {onLewati && (
                  <Button variant="ghost" onClick={onLewati}>
                    Lewati
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setMenolak(true)}>
                  Tolak
                </Button>
                <Button
                  disabled={!terbuka}
                  title={terbuka ? undefined : 'Tunggu sampai bukti tampil.'}
                  leadingIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                  onClick={() => onDecide({ keputusan: 'approve', purchase })}
                >
                  Setujui dan aktifkan paket
                </Button>
              </>
            )}
          </div>
        )
      }
    >
      {galat && <Feedback kind="error">{galat}</Feedback>}
      {!purchase && !galat && <Skeleton label="Membuka bukti transfer" />}
      {purchase && purchase.paymentMethod === 'BANK_TRANSFER' && purchase.paymentUniqueCode != null && (
        <p className="m-0 text-[15px] text-dd-ink">
          Cocokkan nominal <strong className="tabular-nums">{rp(nominal)}</strong> (kode unik{' '}
          {String(purchase.paymentUniqueCode).padStart(3, '0')}) dengan mutasi rekening.
        </p>
      )}
      {purchase?.cekOtomatis && <PenjelasanCekOtomatis cek={purchase.cekOtomatis} />}
      {purchase && !purchase.paymentProof && purchase.paymentMethod === 'QRIS' && (
        <Feedback kind="info">
          QRIS ini dicatat staf di meja tanpa gambar bukti. Cocokkan nominalnya dengan riwayat QRIS
          studio sebelum menyetujui.
        </Feedback>
      )}
      {url &&
        (mime === 'application/pdf' ? (
          <iframe
            src={url}
            title={`Bukti transfer ${purchase?.customer.displayName ?? ''}`}
            onLoad={() => setTerbuka(true)}
            className="mt-4 h-[60vh] w-full rounded-dd-lg border border-dd-border-interactive"
          />
        ) : (
          <ProofImageViewer
            src={url}
            alt={`Bukti transfer ${purchase?.customer.displayName ?? ''}`}
            onLoad={() => setTerbuka(true)}
            onError={() => setGalat('Gambar bukti tidak bisa ditampilkan. Buka detail pembayaran.')}
          />
        ))}
      {menolak && (
        <div className="mt-4 grid gap-3 border-t border-dd-line pt-4">
          <p className="m-0 text-[15px] font-semibold text-dd-ink">Pilih alasan penolakan</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alasan penolakan">
            {ALASAN_TOLAK_TRANSFER.map((a) => (
              <button
                key={a.kode}
                type="button"
                role="radio"
                aria-checked={kode === a.kode}
                onClick={() => setKode(a.kode)}
                className={`min-h-11 rounded-dd-md border px-3 text-[15px] ${
                  kode === a.kode
                    ? 'border-dd-forest bg-dd-success-soft font-semibold text-dd-forest'
                    : 'border-dd-border-interactive bg-white text-dd-ink'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          {kode && <p className="m-0 text-sm text-dd-muted">Member akan membaca: {orderReasonLabels[kode]}</p>}
          <Textarea
            label={perluCatatan ? 'Catatan untuk member (wajib)' : 'Catatan untuk member (opsional)'}
            value={catatan}
            maxLength={500}
            onChange={(event) => setCatatan(event.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}
