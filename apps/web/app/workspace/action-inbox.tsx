'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  browserWorkQueueClient,
  type ItemTindakan,
  type JenisTindakan,
  type KotakTindakan,
  type WorkQueueClient,
} from '@/api-clients/work-queue-client';
import {
  browserPurchaseReviewClient,
  purchaseFailure,
  type PurchaseReviewClient,
} from '@/api-clients/purchase-client';
import {
  bookingFailure,
  browserBookingClient,
  type BookingClient,
} from '@/api-clients/booking-client';
import {
  browserLedgerClient,
  ledgerFailure,
  type LedgerClient,
} from '@/api-clients/ledger-client';
import { Button } from '../components/actions';
import { Modal, useOptionalAppFeedback } from '../components/app-feedback';
import { Textarea } from '../components/forms';
import { useDelayedAction } from '../lib/use-delayed-action';
import { Feedback, Skeleton } from '../ui';
import { TransferProofViewer, type KeputusanTransfer } from './transfer-proof-viewer';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export const JUDUL_JENIS: Record<JenisTindakan, string> = {
  TRANSFER: 'Transfer menunggu diperiksa',
  PENJUALAN_LANGSUNG: 'Penjualan tunai/kartu menunggu persetujuan',
  PEMBATALAN: 'Pembatalan kurang dari 12 jam',
  RESCHEDULE: 'Permohonan ubah jadwal',
  PENYESUAIAN: 'Penyesuaian sesi',
};

/** Label pendek untuk ubin ringkas di beranda Owner. */
export const LABEL_UBIN: Record<JenisTindakan, string> = {
  TRANSFER: 'Transfer',
  PENJUALAN_LANGSUNG: 'Tunai/kartu',
  PEMBATALAN: 'Batal < 12 jam',
  RESCHEDULE: 'Ganti jadwal',
  PENYESUAIAN: 'Penyesuaian sesi',
};

/** Nilai `?tindakan=` dari tautan notifikasi. */
const PARAM_JENIS: Record<string, JenisTindakan> = {
  transfer: 'TRANSFER',
  kasir: 'PENJUALAN_LANGSUNG',
  pembatalan: 'PEMBATALAN',
  reschedule: 'RESCHEDULE',
  penyesuaian: 'PENYESUAIAN',
};

type Alasan = { kode: string; label: string; perluCatatan?: boolean };

const ALASAN_TOLAK: Partial<Record<JenisTindakan, Alasan[]>> = {
  PENJUALAN_LANGSUNG: [
    { kode: 'AMOUNT_MISMATCH', label: 'Nominal tidak sesuai' },
    { kode: 'DUPLICATE_PURCHASE', label: 'Tercatat ganda' },
    { kode: 'OTHER_REVIEW_REQUIRED', label: 'Lainnya', perluCatatan: true },
  ],
  RESCHEDULE: [
    { kode: 'TARGET_UNAVAILABLE', label: 'Kelas tujuan tidak tersedia' },
    { kode: 'OUTSIDE_POLICY', label: 'Di luar aturan reschedule' },
    { kode: 'OUT_OF_SCOPE', label: 'Di luar cabang ini' },
  ],
  PENYESUAIAN: [
    { kode: 'INVALID_EVIDENCE', label: 'Bukti tidak cukup' },
    { kode: 'DUPLICATE_REQUEST', label: 'Pengajuan ganda' },
    { kode: 'OUT_OF_SCOPE', label: 'Di luar cabang ini' },
  ],
};

/** "26 hari", "4 jam": satuan terbesar yang masih utuh. */
export function lamaMenunggu(sejak: string, now: number): string {
  const jam = Math.floor((now - new Date(sejak).getTime()) / 3_600_000);
  if (jam >= 48) return `${Math.floor(jam / 24)} hari`;
  if (jam >= 24) return '1 hari';
  return jam <= 0 ? 'kurang dari 1 jam' : `${jam} jam`;
}

function waktuKelas(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

function rincianItem(item: ItemTindakan): string {
  const bagian: string[] = [];
  if (item.jenis === 'RESCHEDULE' && item.kelas && item.kelasTujuan)
    bagian.push(`${item.kelas.nama} ${waktuKelas(item.kelas.mulai)} ke ${waktuKelas(item.kelasTujuan.mulai)}`);
  else if (item.kelas) bagian.push(`${item.kelas.nama} ${waktuKelas(item.kelas.mulai)}`);
  else bagian.push(item.rincian);
  if (item.nilaiRp != null) bagian.push(rp(item.nilaiRp));
  if (item.jenis === 'PENYESUAIAN' && item.sesi != null)
    bagian.push(`${item.sesi > 0 ? '+' : ''}${item.sesi} sesi`);
  if (item.jenis === 'PEMBATALAN' && item.sesi) bagian.push(`${item.sesi} sesi kembali bila disetujui`);
  if (item.branchName) bagian.push(item.branchName);
  return bagian.join(' · ');
}

/** Akibat menyetujui satu item, ditampilkan sebelum tombol Setujui. */
function pesanSetujui(item: ItemTindakan): string {
  switch (item.jenis) {
    case 'PENJUALAN_LANGSUNG':
      return `${item.nama} · ${rincianItem(item)}. Dicatat oleh ${item.pencatat ?? 'staf'}. Pastikan uangnya sudah Anda terima; paket langsung aktif.`;
    case 'RESCHEDULE':
      return `Booking ${item.nama} dipindah: ${rincianItem(item)}.`;
    case 'PEMBATALAN':
      return `Booking ${item.nama} dibatalkan dan kursinya terbuka. ${item.sesi ? `${item.sesi} sesi kembali ke paket.` : 'Sesi member tetap utuh.'} Alasan: ${item.alasan ?? '-'}`;
    default:
      return `${item.nama} · ${rincianItem(item)}. Alasan: ${item.alasan ?? '-'}`;
  }
}

/**
 * Kotak masuk "Perlu tindakan" di beranda staf. Hanya berisi keputusan yang boleh diambil pengguna
 * ini (server menyaring dari izin memutus dan pemisahan tugas), dengan Setujui/Tolak langsung di
 * kartu. Setiap keputusan tetap dikirim ke endpoint aslinya, yang memeriksa ulang aturannya.
 */
export function ActionInbox({
  branchId,
  queueClient = browserWorkQueueClient,
  purchaseClient = browserPurchaseReviewClient,
  bookingClient = browserBookingClient,
  ledgerClient = browserLedgerClient,
  now = Date.now(),
  emptyMessage = 'Tidak ada yang perlu Anda putuskan saat ini.',
  tampilan = 'daftar',
}: {
  branchId?: string;
  queueClient?: WorkQueueClient;
  purchaseClient?: PurchaseReviewClient;
  bookingClient?: BookingClient;
  ledgerClient?: LedgerClient;
  now?: number;
  emptyMessage?: string;
  /**
   * `daftar`: semua kartu dengan Setujui/Tolak (meja depan). `ringkas`: satu ubin per jenis; klik
   * ubin membuka mode periksa satu per satu yang lanjut otomatis ke item berikutnya (beranda Owner).
   */
  tampilan?: 'daftar' | 'ringkas';
}) {
  // Tanpa penyedia umpan balik (tes komponen induk) kotak masuk tidak dirender: keputusan uang
  // wajib lewat dialog konfirmasi.
  const optionalFeedback = useOptionalAppFeedback();
  const feedback = optionalFeedback!;
  // Tautan notifikasi membawa `?tindakan=<jenis>`; dibaca sekali di browser.
  const [fokus, setFokus] = useState<JenisTindakan | undefined>();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setFokus(PARAM_JENIS[new URLSearchParams(window.location.search).get('tindakan') ?? '']);
  }, []);
  const [data, setData] = useState<KotakTindakan | null>(null);
  const [gagalMuat, setGagalMuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [sibukId, setSibukId] = useState<string | null>(null);
  const [lanjutan, setLanjutan] = useState<Partial<Record<JenisTindakan, string | null>>>({});
  const [buktiId, setBuktiId] = useState<string | null>(null);
  const [tolak, setTolak] = useState<ItemTindakan | null>(null);
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const tunda = useDelayedAction(10_000);
  const fokusRef = useRef<HTMLElement | null>(null);
  // Mode periksa berurutan (tampilan ringkas).
  const [periksa, setPeriksa] = useState<JenisTindakan | null>(null);
  const [dilewati, setDilewati] = useState<Set<string>>(new Set());
  // Transfer yang sudah diputuskan tetapi masih dalam jeda 10 detik: dilompati di mode periksa.
  const [ditunda, setDitunda] = useState<Set<string>>(new Set());
  const idTertunda = useRef<string | null>(null);

  const muat = useCallback(async () => {
    if (!queueClient.tindakan || !optionalFeedback) return;
    setGagalMuat(false);
    try {
      const hasil = await queueClient.tindakan({ branchId });
      setData(hasil);
      setLanjutan({});
    } catch {
      setGagalMuat(true);
    }
  }, [branchId, queueClient, optionalFeedback]);

  useEffect(() => {
    void muat();
  }, [muat]);

  useEffect(() => {
    if (fokus && data && fokusRef.current && typeof fokusRef.current.scrollIntoView === 'function')
      fokusRef.current.scrollIntoView({ block: 'start' });
  }, [data, fokus]);

  const kelompok = useMemo(() => {
    const peta = new Map<JenisTindakan, ItemTindakan[]>();
    for (const item of data?.items ?? []) peta.set(item.jenis, [...(peta.get(item.jenis) ?? []), item]);
    return (data?.ringkasan ?? []).map((r) => ({ ...r, items: peta.get(r.jenis) ?? [] }));
  }, [data]);

  const keluarkan = (id: string) =>
    setData((d) => {
      if (!d) return d;
      const item = d.items.find((i) => i.id === id);
      return {
        ...d,
        items: d.items.filter((i) => i.id !== id),
        ringkasan: d.ringkasan
          .map((r) => (item && r.jenis === item.jenis ? { ...r, jumlah: r.jumlah - 1 } : r))
          .filter((r) => r.jumlah > 0),
      };
    });

  /** Menjalankan keputusan dengan kunci tombol; galat tampil sekali di atas kotak masuk. */
  const jalankan = async (item: ItemTindakan, kerja: () => Promise<unknown>, sukses: string) => {
    setSibukId(item.id);
    setGalat('');
    try {
      await kerja();
      keluarkan(item.id);
      feedback.showToast({ tone: 'success', title: sukses, durationMs: 8000 });
    } catch (cause) {
      setGalat(
        item.jenis === 'TRANSFER' || item.jenis === 'PENJUALAN_LANGSUNG'
          ? purchaseFailure(cause)
          : item.jenis === 'PENYESUAIAN'
            ? await ledgerFailure(cause)
            : await bookingFailure(cause),
      );
      void muat();
    } finally {
      setSibukId(null);
    }
  };

  const versiPembelian = async (id: string) => (await purchaseClient.detail(id)).purchase.version;

  const setujui = async (item: ItemTindakan, langsung = false) => {
    if (item.jenis === 'TRANSFER') {
      setBuktiId(item.id);
      return;
    }
    const pesan = { [item.jenis]: pesanSetujui(item) } as Record<Exclude<JenisTindakan, 'TRANSFER'>, string>;
    // Di mode periksa, layar periksa itu sendiri sudah menampilkan pesan ini di atas tombol Setujui.
    const yakin =
      langsung ||
      (await feedback.confirm({
        tone: item.jenis === 'PEMBATALAN' ? 'danger' : 'warning',
        title: `Setujui ${JUDUL_JENIS[item.jenis].toLowerCase()}?`,
        message: pesan[item.jenis],
        confirmLabel: 'Setujui',
      }));
    if (!yakin) return;
    const kunci = crypto.randomUUID();
    if (item.jenis === 'PENJUALAN_LANGSUNG')
      await jalankan(
        item,
        async () => purchaseClient.approve(item.id, await versiPembelian(item.id), kunci),
        'Penjualan disetujui, paket member aktif',
      );
    else if (item.jenis === 'RESCHEDULE')
      await jalankan(
        item,
        () =>
          bookingClient.decideReschedule(
            item.id,
            'approve',
            { reasonCode: 'ELIGIBILITY_VERIFIED', expectedVersion: item.version || 1 },
            kunci,
          ),
        'Reschedule disetujui, booking sudah dipindah',
      );
    else if (item.jenis === 'PEMBATALAN')
      await jalankan(
        item,
        () => bookingClient.putuskanPembatalan!(item.id, 'approve', item.version),
        'Pembatalan disetujui',
      );
    else
      await jalankan(
        item,
        () =>
          ledgerClient.decideAdjustment(
            item.id,
            'approve',
            { reasonCode: 'CORRECTION_VERIFIED', expectedVersion: item.version },
            kunci,
          ),
        'Penyesuaian sesi disetujui',
      );
  };

  const mulaiTolak = async (item: ItemTindakan, langsung = false) => {
    if (item.jenis === 'TRANSFER') {
      setBuktiId(item.id);
      return;
    }
    if (item.jenis === 'PEMBATALAN') {
      const yakin = langsung || await feedback.confirm({
        tone: 'warning',
        title: `Tolak pembatalan ${item.nama}?`,
        message: 'Booking tetap terjadwal dan sesi tidak berubah. Member diberi tahu.',
        confirmLabel: 'Tolak',
      });
      if (yakin)
        await jalankan(
          item,
          () => bookingClient.putuskanPembatalan!(item.id, 'reject', item.version),
          'Pembatalan ditolak, booking tetap terjadwal',
        );
      return;
    }
    setKode('');
    setCatatan('');
    setTolak(item);
  };

  const kirimTolak = async () => {
    const item = tolak;
    if (!item || !kode) return;
    const kunci = crypto.randomUUID();
    const note = catatan.trim() || undefined;
    await jalankan(
      item,
      async () => {
        if (item.jenis === 'PENJUALAN_LANGSUNG')
          await purchaseClient.reject(
            item.id,
            await versiPembelian(item.id),
            kode as 'AMOUNT_MISMATCH' | 'DUPLICATE_PURCHASE' | 'OTHER_REVIEW_REQUIRED',
            kunci,
            note,
          );
        else if (item.jenis === 'RESCHEDULE')
          await bookingClient.decideReschedule(
            item.id,
            'reject',
            { reasonCode: kode, expectedVersion: item.version || 1, note },
            kunci,
          );
        else
          await ledgerClient.decideAdjustment(
            item.id,
            'reject',
            { reasonCode: kode, note, expectedVersion: item.version },
            kunci,
          );
      },
      'Penolakan tersimpan',
    );
    setTolak(null);
  };

  const keputusanTransfer = (k: KeputusanTransfer) => {
    const item = data?.items.find((i) => i.id === k.purchase.id);
    setBuktiId(null);
    if (!item) return;
    // Mode periksa: keputusan sebelumnya langsung dikirim supaya yang berikutnya bisa ditunda.
    if (periksa && tunda.pending) tunda.flush();
    idTertunda.current = item.id;
    setDitunda((d) => new Set(d).add(item.id));
    const label =
      k.keputusan === 'approve' ? `Setujui pembayaran ${item.nama}` : `Tolak pembayaran ${item.nama}`;
    const terjadwal = tunda.schedule(label, () =>
      jalankan(
        item,
        () =>
          k.keputusan === 'approve'
            ? purchaseClient.approve(item.id, k.purchase.version, crypto.randomUUID())
            : purchaseClient.reject(item.id, k.purchase.version, k.kode!, crypto.randomUUID(), k.catatan),
        k.keputusan === 'approve' ? 'Pembayaran disetujui, paket member aktif' : 'Pembayaran ditolak',
      ),
    );
    if (!terjadwal)
      setGalat('Masih ada keputusan yang menunggu dikirim. Kirim sekarang atau batalkan dulu.');
  };

  const muatLagi = async (jenis: JenisTindakan, cursor?: string) => {
    if (!queueClient.tindakan) return;
    try {
      const hal = await queueClient.tindakan({ branchId, jenis, cursor });
      setData((d) => {
        if (!d) return d;
        const ada = new Set(d.items.map((i) => i.id));
        return { ...d, items: [...d.items, ...hal.items.filter((i) => !ada.has(i.id))] };
      });
      setLanjutan((l) => ({ ...l, [jenis]: hal.nextCursor }));
    } catch {
      setGalat('Daftar berikutnya belum dapat dimuat. Coba lagi.');
    }
  };

  const grupPeriksa = periksa ? kelompok.find((k) => k.jenis === periksa) : undefined;
  const itemPeriksa = grupPeriksa?.items.find((i) => !dilewati.has(i.id) && !ditunda.has(i.id));
  const sisaPeriksa = grupPeriksa
    ? grupPeriksa.jumlah - grupPeriksa.items.filter((i) => ditunda.has(i.id)).length
    : 0;
  const mulaiPeriksa = (jenis: JenisTindakan) => {
    setDilewati(new Set());
    setPeriksa(jenis);
  };
  const selesaiPeriksa = () => {
    setPeriksa(null);
    setBuktiId(null);
  };

  // Mode periksa: muat halaman berikutnya bila item yang termuat habis; selesai bila semua sudah.
  useEffect(() => {
    if (!periksa || !data || itemPeriksa) return;
    const cursor = lanjutan[periksa];
    if (grupPeriksa && cursor !== null && grupPeriksa.items.length < grupPeriksa.jumlah) {
      void muatLagi(periksa, cursor);
      return;
    }
    setPeriksa(null);
    setBuktiId(null);
    feedback.showToast({
      tone: 'success',
      title: dilewati.size ? `Selesai. ${dilewati.size} item dilewati dan masih menunggu.` : 'Semua sudah diperiksa',
      durationMs: 6000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periksa, data, itemPeriksa?.id]);

  // Transfer di mode periksa dibuka langsung di penampil bukti.
  useEffect(() => {
    if (periksa === 'TRANSFER' && itemPeriksa) setBuktiId(itemPeriksa.id);
  }, [periksa, itemPeriksa?.id]);

  const alasan = tolak ? (ALASAN_TOLAK[tolak.jenis] ?? []) : [];
  const perluCatatan = alasan.find((a) => a.kode === kode)?.perluCatatan ?? false;
  const total = kelompok.reduce((s, k) => s + k.jumlah, 0);

  if (!queueClient.tindakan || !optionalFeedback) return null;

  return (
    <section aria-labelledby="perlu-tindakan-judul" id="perlu-tindakan" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="perlu-tindakan-judul" className="m-0 text-xl font-semibold text-dd-ink">
          {tampilan === 'ringkas' ? 'Perlu keputusan' : 'Perlu tindakan'}
          {total > 0 ? ` (${total})` : ''}
        </h2>
      </div>
      {tunda.pending && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-dd-lg border border-dd-warning-line/60 bg-dd-warning-soft p-4"
        >
          <span className="min-w-0 flex-1 text-[15px] text-dd-ink">
            <strong>{tunda.pending.label}</strong> dikirim dalam {tunda.pending.secondsLeft} detik.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              tunda.cancel();
              const id = idTertunda.current;
              if (id)
                setDitunda((d) => {
                  const next = new Set(d);
                  next.delete(id);
                  return next;
                });
            }}
          >
            Batalkan
          </Button>
          <Button size="sm" onClick={() => tunda.flush()}>
            Kirim sekarang
          </Button>
        </div>
      )}
      {galat && (
        <Feedback kind="error" onDismiss={() => setGalat('')}>
          {galat}
        </Feedback>
      )}
      {gagalMuat && (
        <Feedback kind="error">
          Daftar keputusan belum dapat dimuat.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void muat()}>
            Coba lagi
          </button>
        </Feedback>
      )}
      {data && data.gagal.length > 0 && (
        <Feedback kind="warning">
          Sebagian daftar belum dapat dimuat ({data.gagal.map((j) => JUDUL_JENIS[j]).join(', ')}).
          Angka di bawah belum lengkap.
        </Feedback>
      )}
      {!data && !gagalMuat && <Skeleton label="Memuat yang perlu diputuskan" />}
      {data && total === 0 && data.gagal.length === 0 && (
        <p className="m-0 flex items-center gap-2 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
          <CheckCircle2 className="size-5 shrink-0 text-dd-forest" aria-hidden="true" />
          {emptyMessage}
        </p>
      )}
      {tampilan === 'ringkas' && total > 0 && (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4" aria-label="Keputusan per jenis">
          {kelompok.map((k) => (
            <li key={k.jenis}>
              <button
                type="button"
                onClick={() => mulaiPeriksa(k.jenis)}
                className="flex h-full min-h-11 w-full flex-col items-start gap-1 rounded-dd-lg border border-dd-line bg-white p-3 text-left transition hover:border-dd-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-dd-forest sm:p-4"
                aria-label={`Periksa ${k.jumlah} ${LABEL_UBIN[k.jenis].toLowerCase()}`}
              >
                <span className="text-[28px] font-semibold leading-none tabular-nums text-dd-ink">{k.jumlah}</span>
                <span className="text-[15px] font-semibold text-dd-ink">{LABEL_UBIN[k.jenis]}</span>
                {k.items[0] && (
                  <span className="text-sm text-dd-muted">Terlama {lamaMenunggu(k.items[0].masukPada, now)}</span>
                )}
                <span className="mt-1 hidden text-sm font-semibold text-dd-forest sm:inline">Periksa satu per satu</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tampilan === 'daftar' && kelompok.map((k) => {
        const cursor = lanjutan[k.jenis];
        const masihAda = cursor !== null && k.items.length < k.jumlah;
        return (
          <section
            key={k.jenis}
            aria-labelledby={`tindakan-${k.jenis}`}
            ref={k.jenis === fokus ? (el) => void (fokusRef.current = el) : undefined}
            className="space-y-2"
          >
            <h3 id={`tindakan-${k.jenis}`} className="m-0 text-[15px] font-semibold text-dd-muted">
              {JUDUL_JENIS[k.jenis]} ({k.jumlah})
            </h3>
            <ul className="m-0 grid list-none gap-2 p-0">
              {k.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[17px] font-semibold text-dd-ink">{item.nama}</p>
                    <p className="m-0 mt-0.5 text-[15px] text-dd-muted">{rincianItem(item)}</p>
                    {item.alasan && item.jenis !== 'RESCHEDULE' && (
                      <p className="m-0 mt-0.5 text-[15px] text-dd-ink">Alasan: {item.alasan}</p>
                    )}
                    {item.jenis === 'PEMBATALAN' && item.alasan?.startsWith('[IZIN MEDIS]') && !item.buktiUrl && (
                      <p className="m-0 text-[15px] font-semibold text-dd-danger">
                        Izin medis tanpa bukti. Minta surat dokter dulu sebelum menyetujui.
                      </p>
                    )}
                    {item.buktiUrl && (
                      <a
                        href={item.buktiUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center text-[15px] font-semibold text-dd-forest underline"
                      >
                        Lihat bukti pendukung
                      </a>
                    )}
                    <p className="m-0 mt-0.5 text-sm text-dd-muted">
                      Menunggu {lamaMenunggu(item.masukPada, now)}
                      {item.pencatat ? ` · diajukan ${item.pencatat}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      disabled={sibukId !== null}
                      onClick={() => void mulaiTolak(item)}
                    >
                      Tolak
                    </Button>
                    <Button
                      loading={sibukId === item.id}
                      disabled={sibukId !== null && sibukId !== item.id}
                      onClick={() => void setujui(item)}
                    >
                      {item.jenis === 'TRANSFER' ? 'Periksa bukti' : 'Setujui'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {masihAda && (
              <Button variant="ghost" size="sm" onClick={() => void muatLagi(k.jenis, cursor)}>
                Tampilkan lebih banyak
              </Button>
            )}
          </section>
        );
      })}
      {data && data.pengingat.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0" aria-label="Perlu diperhatikan">
          {data.pengingat.map((p) => (
            <li key={p.key}>
              <Link
                href={p.href}
                className="inline-flex min-h-11 items-center rounded-dd-md border border-dd-border-interactive bg-white px-3 text-[15px] font-semibold text-dd-ink no-underline hover:border-dd-forest"
              >
                {p.key === 'renewal'
                  ? `${p.jumlah} member paketnya habis dan belum renew`
                  : p.key === 'perpanjangan'
                    ? `${p.jumlah} member masih punya sesi, paketnya berakhir dalam 14 hari`
                    : `${p.jumlah} kelas di bawah kuota minimum`}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <TransferProofViewer
        purchaseId={buktiId}
        client={purchaseClient}
        onClose={periksa ? selesaiPeriksa : () => setBuktiId(null)}
        onDecide={keputusanTransfer}
        posisi={periksa === 'TRANSFER' ? `sisa ${sisaPeriksa}` : undefined}
        onLewati={
          periksa === 'TRANSFER' && itemPeriksa
            ? () => {
                const id = itemPeriksa.id;
                setBuktiId(null);
                setDilewati((d) => new Set(d).add(id));
              }
            : undefined
        }
      />

      {periksa && periksa !== 'TRANSFER' && itemPeriksa && (
        <Modal
          open={!tolak}
          title={`${JUDUL_JENIS[periksa]} (sisa ${sisaPeriksa})`}
          busy={sibukId !== null}
          onClose={selesaiPeriksa}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={sibukId !== null}
                onClick={() => setDilewati((d) => new Set(d).add(itemPeriksa.id))}
              >
                Lewati
              </Button>
              <Button
                variant="secondary"
                disabled={sibukId !== null}
                onClick={() => void mulaiTolak(itemPeriksa, true)}
              >
                Tolak
              </Button>
              <Button loading={sibukId === itemPeriksa.id} onClick={() => void setujui(itemPeriksa, true)}>
                Setujui
              </Button>
            </div>
          }
        >
          <div className="grid gap-2">
            <p className="m-0 text-[19px] font-semibold text-dd-ink">{itemPeriksa.nama}</p>
            <p className="m-0 text-[15px] text-dd-muted">{rincianItem(itemPeriksa)}</p>
            {itemPeriksa.alasan && itemPeriksa.jenis !== 'RESCHEDULE' && (
              <p className="m-0 text-[15px] text-dd-ink">Alasan: {itemPeriksa.alasan}</p>
            )}
            {itemPeriksa.jenis === 'PEMBATALAN' && itemPeriksa.alasan?.startsWith('[IZIN MEDIS]') && !itemPeriksa.buktiUrl && (
              <p className="m-0 text-[15px] font-semibold text-dd-danger">
                Izin medis tanpa bukti. Minta surat dokter dulu sebelum menyetujui.
              </p>
            )}
            {itemPeriksa.buktiUrl && (
              <a
                href={itemPeriksa.buktiUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center text-[15px] font-semibold text-dd-forest underline"
              >
                Lihat bukti pendukung
              </a>
            )}
            <p className="m-0 text-sm text-dd-muted">
              Menunggu {lamaMenunggu(itemPeriksa.masukPada, now)}
              {itemPeriksa.pencatat ? ` · diajukan ${itemPeriksa.pencatat}` : ''}
            </p>
            <p className="m-0 mt-2 rounded-dd-md bg-dd-surface-muted p-3 text-[15px] text-dd-ink">
              Bila disetujui: {pesanSetujui(itemPeriksa)}
            </p>
          </div>
        </Modal>
      )}

      <Modal
        open={tolak !== null}
        title={tolak ? `Tolak: ${tolak.nama}` : 'Tolak'}
        description={tolak ? rincianItem(tolak) : undefined}
        busy={sibukId !== null}
        onClose={() => setTolak(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={sibukId !== null} onClick={() => setTolak(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              loading={sibukId !== null}
              disabled={!kode || (perluCatatan && catatan.trim().length < 3)}
              onClick={() => void kirimTolak()}
            >
              Tolak
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alasan penolakan">
            {alasan.map((a) => (
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
          <Textarea
            label={perluCatatan ? 'Catatan (wajib)' : 'Catatan (opsional)'}
            value={catatan}
            maxLength={500}
            onChange={(event) => setCatatan(event.target.value)}
          />
        </div>
      </Modal>
    </section>
  );
}
