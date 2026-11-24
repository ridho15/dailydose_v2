'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { bookingFailure } from '@/api-clients/booking-client';
import { Button } from '../../components/actions';
import { Modal } from '../../components/app-feedback';
import { SearchInput, SelectInput, TextInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';
import { useSessionContext } from '../../session-context';

export interface BarisPengajuan {
  id: string;
  version: number;
  bookingId: string;
  sessionCount: number;
  reason: string;
  requestedByName: string | null;
  createdAt: string;
  buktiUrl?: string | null;
  customerName: string | null;
  className: string | null;
  classStartAt: string | null;
  branchId: string | null;
  branchName: string | null;
  canDecide: boolean;
}

export interface FilterDaftar {
  branchId?: string;
  dari?: string;
  sampai?: string;
  jenis?: '' | 'medis' | 'biasa';
  q?: string;
  cursor?: string;
}

type Halaman = { items: BarisPengajuan[]; nextCursor: string | null };

export interface DaftarPembatalanClient {
  muat(filter: FilterDaftar): Promise<Halaman>;
  putuskan(id: string, keputusan: 'approve' | 'reject', version: number): Promise<unknown>;
}

const clientBawaan: DaftarPembatalanClient = {
  muat(filter) {
    const qs = new URLSearchParams({ limit: '50' });
    for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, v);
    return apiFetch<Halaman>(`/bookings/late-cancellations?${qs}`, { label: 'Memuat pengajuan batal…' });
  },
  putuskan(id, keputusan, version) {
    return apiFetch(`/bookings/late-cancellations/${encodeURIComponent(id)}/${keputusan}`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: version }),
      label: keputusan === 'approve' ? 'Menyetujui pembatalan…' : 'Menolak pembatalan…',
    });
  },
};

const PENANDA_MEDIS = '[IZIN MEDIS]';

const waktuWib = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(
        new Date(iso),
      )
    : '-';

export function hariMenunggu(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/**
 * Daftar lengkap pengajuan batal kurang dari 12 jam dengan filter cabang, tanggal kelas, dan alasan,
 * plus keputusan massal (audit 24 November 2026: antrean periksa satu per satu tidak cukup untuk
 * puluhan pengajuan). Setiap keputusan tetap dikirim satu per satu lewat jalur yang sama dengan
 * kotak masuk, jadi aturan pemisahan tugas dan audit berlaku per pengajuan.
 */
export function DaftarPembatalanView({ client = clientBawaan }: { client?: DaftarPembatalanClient }) {
  const ctx = useSessionContext();
  const cabangList = useMemo(() => (ctx?.session?.branches ?? []).map((b) => ({ id: b.id, name: b.name })), [ctx]);
  const [isian, setIsian] = useState<FilterDaftar>({ branchId: ctx?.activeBranchId || '', jenis: '' });
  const [filter, setFilter] = useState<FilterDaftar>(isian);
  const [items, setItems] = useState<BarisPengajuan[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState('');
  const [hasil, setHasil] = useState('');
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [konfirmasi, setKonfirmasi] = useState<'approve' | 'reject' | null>(null);
  const [proses, setProses] = useState<{ selesai: number; total: number } | null>(null);

  const ambil = useCallback(
    async (lanjut?: string) => {
      setMemuat(true);
      setGalat('');
      try {
        const h = await client.muat({ ...filter, cursor: lanjut });
        setItems((lama) => (lanjut ? [...lama, ...h.items] : h.items));
        setCursor(h.nextCursor);
        if (!lanjut) setTerpilih(new Set());
      } catch (error) {
        setGalat(await bookingFailure(error));
      } finally {
        setMemuat(false);
      }
    },
    [client, filter],
  );
  useEffect(() => void ambil(), [ambil]);

  const bisaDipilih = items.filter((i) => i.canDecide);
  const semuaTerpilih = bisaDipilih.length > 0 && bisaDipilih.every((i) => terpilih.has(i.id));
  const pilih = (id: string) =>
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  const jalankan = async (keputusan: 'approve' | 'reject') => {
    const daftar = items.filter((i) => terpilih.has(i.id) && i.canDecide);
    setProses({ selesai: 0, total: daftar.length });
    const gagal: string[] = [];
    for (const [n, i] of daftar.entries()) {
      try {
        await client.putuskan(i.id, keputusan, i.version);
      } catch (error) {
        gagal.push(`${i.customerName ?? 'Member'}: ${await bookingFailure(error)}`);
      }
      setProses({ selesai: n + 1, total: daftar.length });
    }
    setProses(null);
    setKonfirmasi(null);
    const berhasil = daftar.length - gagal.length;
    setHasil(
      `${berhasil} pengajuan ${keputusan === 'approve' ? 'disetujui' : 'ditolak'}.` +
        (gagal.length ? ` ${gagal.length} gagal: ${gagal.join('; ')}` : ''),
    );
    void ambil();
  };

  const jumlahTerpilih = items.filter((i) => terpilih.has(i.id) && i.canDecide).length;

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="m-0 text-2xl font-semibold text-dd-ink">Pengajuan batal kurang dari 12 jam</h1>
          <p className="m-0 mt-1 text-[15px] text-dd-muted">
            Semua pengajuan yang menunggu keputusan. Pengajuan yang booking atau kelasnya sudah dibatalkan ditutup
            otomatis.
          </p>
        </div>
        <Link href="/workspace" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-dd-forest">
          Kembali ke Perlu tindakan
        </Link>
      </header>

      <form
        className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setHasil('');
          setFilter({ ...isian, q: isian.q?.trim() });
        }}
      >
        <SelectInput
          label="Cabang"
          value={isian.branchId ?? ''}
          onChange={(e) => setIsian((f) => ({ ...f, branchId: e.target.value }))}
        >
          <option value="">Semua cabang</option>
          {cabangList.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Kelas dari tanggal"
          type="date"
          value={isian.dari ?? ''}
          onChange={(e) => setIsian((f) => ({ ...f, dari: e.target.value }))}
        />
        <TextInput
          label="Sampai tanggal"
          type="date"
          value={isian.sampai ?? ''}
          onChange={(e) => setIsian((f) => ({ ...f, sampai: e.target.value }))}
        />
        <SelectInput
          label="Jenis alasan"
          value={isian.jenis ?? ''}
          onChange={(e) => setIsian((f) => ({ ...f, jenis: e.target.value as FilterDaftar['jenis'] }))}
        >
          <option value="">Semua</option>
          <option value="medis">Izin medis</option>
          <option value="biasa">Selain izin medis</option>
        </SelectInput>
        <SearchInput
          label="Cari alasan atau member"
          value={isian.q ?? ''}
          onChange={(e) => setIsian((f) => ({ ...f, q: e.target.value }))}
        />
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" variant="secondary">
            Terapkan filter
          </Button>
        </div>
      </form>

      {hasil && <Feedback kind="status">{hasil}</Feedback>}
      {galat && <Feedback kind="error">{galat}</Feedback>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px] text-dd-ink">
          <input
            type="checkbox"
            checked={semuaTerpilih}
            disabled={bisaDipilih.length === 0}
            onChange={() => setTerpilih(semuaTerpilih ? new Set() : new Set(bisaDipilih.map((i) => i.id)))}
            className="size-4"
          />
          Pilih semua yang tampil
        </label>
        <span className="text-[15px] text-dd-muted">{jumlahTerpilih} dipilih</span>
        <Button variant="danger" disabled={jumlahTerpilih === 0} onClick={() => setKonfirmasi('approve')}>
          Setujui terpilih
        </Button>
        <Button variant="secondary" disabled={jumlahTerpilih === 0} onClick={() => setKonfirmasi('reject')}>
          Tolak terpilih
        </Button>
      </div>

      {memuat && items.length === 0 && <Skeleton label="Memuat pengajuan batal" />}
      {!memuat && !galat && items.length === 0 && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">
          Tidak ada pengajuan yang cocok dengan filter ini.
        </p>
      )}
      {items.length > 0 && (
        <ul className="m-0 grid list-none gap-0 rounded-dd-lg border border-dd-line bg-white p-0">
          {items.map((i) => {
            const medis = i.reason.startsWith(PENANDA_MEDIS);
            const hari = hariMenunggu(i.createdAt);
            return (
              <li key={i.id} className="flex gap-3 border-b border-dd-line px-4 py-3 last:border-b-0">
                <input
                  type="checkbox"
                  aria-label={`Pilih ${i.customerName ?? 'member'}`}
                  checked={terpilih.has(i.id)}
                  disabled={!i.canDecide}
                  onChange={() => pilih(i.id)}
                  className="mt-1 size-4 shrink-0"
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="m-0 text-[15px] font-semibold text-dd-ink">
                    {i.customerName ?? 'Member'} · {i.className ?? 'Kelas'} · {waktuWib(i.classStartAt)}
                  </p>
                  <p className="m-0 break-words text-[15px] text-dd-ink">{i.reason}</p>
                  <p className="m-0 text-sm text-dd-muted">
                    {i.branchName ?? '-'} · diajukan {i.requestedByName ?? 'member'} ·{' '}
                    <span className={hari >= 2 ? 'font-semibold text-dd-danger' : undefined}>
                      menunggu {hari === 0 ? 'kurang dari sehari' : `${hari} hari`}
                    </span>
                    {i.sessionCount > 0 ? ` · ${i.sessionCount} sesi kembali bila disetujui` : ''}
                  </p>
                  {i.buktiUrl ? (
                    <a
                      href={i.buktiUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-[15px] font-semibold text-dd-forest underline"
                    >
                      Lihat bukti
                    </a>
                  ) : (
                    medis && <p className="m-0 text-sm font-semibold text-dd-danger">Izin medis tanpa bukti</p>
                  )}
                  {!i.canDecide && (
                    <p className="m-0 text-sm text-dd-muted">Diajukan oleh Anda sendiri; diputus penyetuju lain.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {cursor && (
        <Button variant="ghost" disabled={memuat} onClick={() => void ambil(cursor)}>
          Tampilkan lebih banyak
        </Button>
      )}

      <Modal
        open={konfirmasi !== null}
        title={konfirmasi === 'approve' ? `Setujui ${jumlahTerpilih} pengajuan?` : `Tolak ${jumlahTerpilih} pengajuan?`}
        description={
          konfirmasi === 'approve'
            ? 'Booking dibatalkan, kursinya terbuka, dan sesi yang sudah terpotong dikembalikan ke paket member.'
            : 'Booking tetap seperti semula. Kelas yang sudah lewat langsung tercatat Hadir atau Tidak hadir dan sesinya dipotong.'
        }
        busy={proses !== null}
        onClose={() => setKonfirmasi(null)}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={proses !== null} onClick={() => setKonfirmasi(null)}>
              Kembali
            </Button>
            <Button
              variant={konfirmasi === 'approve' ? 'danger' : 'primary'}
              loading={proses !== null}
              onClick={() => konfirmasi && void jalankan(konfirmasi)}
            >
              {konfirmasi === 'approve' ? 'Setujui semua' : 'Tolak semua'}
            </Button>
          </div>
        }
      >
        <p className="m-0 text-[15px] text-dd-ink">
          {proses
            ? `Memproses ${proses.selesai} dari ${proses.total}…`
            : 'Setiap pengajuan diputus satu per satu dan tercatat di riwayat atas nama Anda.'}
        </p>
      </Modal>
    </main>
  );
}
