'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import {
  browserCheckInDeskClient,
  checkInDeskFailure,
  type BarisTidakHadir,
  type CheckInDeskClient,
  type KelasMeja,
  type MejaCheckIn,
  type TercatatMeja,
} from '@/api-clients/check-in-desk-client';
import {
  browserClassSlotClient,
  classSlotFailure,
  type ClassSlotClient,
} from '@/api-clients/class-slot-client';
import {
  bookingFailure,
  browserBookingClient,
  type BookingClient,
  type CustomerBookingRecord,
} from '@/api-clients/booking-client';
import { resolvePublicImageUrl } from '@/lib/public-image-url';
import { Button } from '../../components/actions';
import { Drawer, useAppFeedback } from '../../components/app-feedback';
import { SelectInput, Textarea } from '../../components/forms';
import { EmptyState, Feedback, Skeleton } from '../../ui';
import { PemindaiMeja } from './pemindai-meja';
import { useSessionContext } from '../../session-context';

/** Lama kartu "sudah check-in" tampil sebelum menutup sendiri, seperti mockup. */
export const DURASI_KARTU_MS = 8_000;
/** Seberapa sering layar menanyakan kehadiran baru ke server. */
const SELANG_PERBARUI_MS = 5_000;
const MIN_ALASAN = 10;

const SELESAI = new Set(['COMPLETED', 'CANCELLED', 'AUTO_CANCELLED']);

function jam(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/**
 * Kartu check-in yang muncul untuk orang yang baru tercatat.
 *
 * Isi pertama yang dimuat tidak memunculkan kartu: kehadiran yang sudah tercatat sebelum layar
 * dibuka bukan "baru", dan memunculkannya akan membuat staf mencocokkan wajah orang yang sudah
 * lama masuk. Hanya yang muncul sesudahnya yang dianggap baru.
 */
export function pilihKartuBaru(
  tercatat: readonly TercatatMeja[],
  sudahTerlihat: ReadonlySet<string>,
): TercatatMeja | null {
  return tercatat.find((item) => item.jenis === 'MEMBER' && !sudahTerlihat.has(item.id)) ?? null;
}

export function CheckInDeskView({
  client = browserCheckInDeskClient,
  classClient = browserClassSlotClient,
  bookingClient = browserBookingClient,
  branchIdOverride,
}: {
  client?: CheckInDeskClient;
  classClient?: Pick<ClassSlotClient, 'cancel' | 'completionControl' | 'complete'>;
  bookingClient?: Pick<BookingClient, 'list' | 'backfillAttendance'>;
  branchIdOverride?: string;
}) {
  const session = useSessionContext();
  const feedback = useAppFeedback();
  const branchId = branchIdOverride ?? session?.activeBranchId ?? '';

  const [meja, setMeja] = useState<MejaCheckIn | null>(null);
  const [tidakHadir, setTidakHadir] = useState<BarisTidakHadir[]>([]);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const [kartu, setKartu] = useState<TercatatMeja | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const terlihat = useRef<Set<string> | null>(null);
  const timerKartu = useRef<number | undefined>(undefined);

  const tutupKartu = useCallback(() => {
    window.clearTimeout(timerKartu.current);
    setKartu(null);
  }, []);

  const muat = useCallback(async () => {
    if (!branchId) return;
    try {
      const data = await client.meja(branchId);
      setMeja(data);
      setFailure('');
      if (terlihat.current === null) {
        terlihat.current = new Set(data.tercatat.map((item) => item.id));
      } else {
        const baru = pilihKartuBaru(data.tercatat, terlihat.current);
        data.tercatat.forEach((item) => terlihat.current!.add(item.id));
        if (baru) {
          window.clearTimeout(timerKartu.current);
          setKartu(baru);
          timerKartu.current = window.setTimeout(() => setKartu(null), DURASI_KARTU_MS);
        }
      }
      client
        .tidakHadir(branchId, data.tanggal)
        .then(setTidakHadir)
        .catch(() => setTidakHadir([]));
    } catch (error) {
      setFailure(
        checkInDeskFailure(
          error,
          'Data check-in tidak dapat dimuat. Periksa koneksi lalu muat ulang.',
        ),
      );
    }
  }, [branchId, client]);

  useEffect(() => {
    terlihat.current = null;
    setMeja(null);
    tutupKartu();
    void muat();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void muat();
    }, SELANG_PERBARUI_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timerKartu.current);
    };
  }, [muat, tutupKartu]);

  if (!branchId) {
    return (
      <section aria-labelledby="ci-title" className="space-y-4">
        <h1 id="ci-title" className="m-0 text-[28px] font-semibold text-dd-ink">
          Check-in
        </h1>
        <EmptyState
          title="Pilih cabang dulu"
          description="Layar check-in menampilkan satu studio. Pilih cabang di bilah atas."
        />
      </section>
    );
  }

  const tz = meja?.timezone ?? 'Asia/Jakarta';
  const now = Date.now();
  const kelasAktif = (meja?.kelas ?? []).filter(
    (k) => !SELESAI.has(k.status) && !k.perluDitutup && new Date(k.endAt).getTime() > now,
  );
  const perluDitutup = (meja?.kelas ?? []).filter((k) => k.perluDitutup);

  const tetapJalan = async (kelas: KelasMeja, alasan: string) => {
    setBusyId(kelas.id);
    setMessage('');
    try {
      await client.tetapJalan(kelas.id, alasan);
      setMessage(
        `${kelas.namaKelas} ${jam(kelas.startAt, tz)} tetap berjalan. Keputusan sudah dilaporkan ke Super Owner.`,
      );
      await muat();
    } catch (error) {
      setFailure(checkInDeskFailure(error, 'Keputusan belum tercatat. Coba lagi.'));
    } finally {
      setBusyId(null);
    }
  };

  const batalkan = async (kelas: KelasMeja) => {
    const setuju = await feedback.confirm({
      tone: 'danger',
      title: `Batalkan ${kelas.namaKelas} ${jam(kelas.startAt, tz)}?`,
      message: `${kelas.terdaftar} peserta mendapatkan sesinya kembali utuh. Kelas tidak bisa diaktifkan lagi dari layar ini.`,
      confirmLabel: 'Batalkan kelas',
    });
    if (!setuju) return;
    setBusyId(kelas.id);
    setMessage('');
    try {
      await classClient.cancel(
        kelas.id,
        'OTHER_REVIEW_REQUIRED',
        kelas.version,
        `Di bawah kuota minimum saat check-in: ${kelas.hadir} hadir dari minimum ${kelas.kuota.minimum}.`,
      );
      setMessage(
        `${kelas.namaKelas} ${jam(kelas.startAt, tz)} dibatalkan dan sesi peserta dikembalikan.`,
      );
      await muat();
    } catch (error) {
      setFailure(classSlotFailure(error) ?? 'Perubahan kelas belum tersimpan. Coba lagi.');
    } finally {
      setBusyId(null);
    }
  };

  const tutupKelas = async (kelas: KelasMeja) => {
    setBusyId(kelas.id);
    setMessage('');
    try {
      const kontrol = await classClient.completionControl(kelas.id);
      const setuju = await feedback.confirm({
        tone: 'warning',
        title: `Tutup kelas ${jam(kelas.startAt, tz)}?`,
        message: `${kontrol.attendanceCount} peserta hadir dan sesinya terpotong. ${kontrol.noShowCount} peserta tidak hadir, sesinya hangus dan masuk laporan di bawah.`,
        confirmLabel: 'Tutup kelas',
      });
      if (!setuju) return;
      await classClient.complete(
        kelas.id,
        kontrol.expectedVersion,
        kontrol.controlHash,
        'Ditutup dari layar check-in meja depan',
      );
      setMessage(`Kelas ${jam(kelas.startAt, tz)} ditutup.`);
      await muat();
    } catch (error) {
      setFailure(classSlotFailure(error) ?? 'Perubahan kelas belum tersimpan. Coba lagi.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="ci-title" className="space-y-[22px]">
      <h1 id="ci-title" className="sr-only">
        Check-in hari ini{meja ? ` di ${meja.namaCabang}` : ''}
      </h1>

      <PemindaiMeja
        pindai={(pass) => client.pindai(branchId, pass)}
        onTercatat={() => void muat()}
      />

      {kartu ? (
        <KartuCheckIn kartu={kartu} timezone={tz} onClose={tutupKartu} />
      ) : (
        <section
          aria-live="polite"
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-dd-border-interactive bg-white p-6"
        >
          <p className="m-0 text-[17px] text-dd-muted">
            Belum ada check-in baru. Kartu besar dengan foto selfie member muncul di sini begitu
            QR-nya dipindai, supaya wajahnya bisa dicocokkan.
          </p>
        </section>
      )}
      {kartu && (
        <p className="-mt-3 m-0 text-[15px] text-dd-muted">
          Kartu ini menutup sendiri setelah 8 detik, atau tekan Tutup sekarang untuk langsung
          memindai orang berikutnya.
        </p>
      )}

      {failure && <Feedback kind="error">{failure}</Feedback>}
      {message && <Feedback kind="status">{message}</Feedback>}
      {!meja && !failure && <Skeleton label="Memuat check-in hari ini" />}

      {meja && (
        <div className="flex flex-wrap items-start gap-5">
          <section
            aria-labelledby="ci-classes"
            className="flex min-w-0 flex-[999_1_420px] flex-col gap-3.5"
          >
            <h2 id="ci-classes" className="m-0 text-[22px] font-semibold text-dd-ink">
              Kelas hari ini
            </h2>
            {kelasAktif.length === 0 ? (
              <p className="m-0 rounded-dd-md border border-dd-border-interactive bg-white p-5 text-[15px] text-dd-muted">
                Tidak ada kelas lagi hari ini di {meja.namaCabang}.
              </p>
            ) : (
              kelasAktif.map((kelas) => (
                <KartuKelas
                  key={kelas.id}
                  kelas={kelas}
                  timezone={tz}
                  busy={busyId === kelas.id}
                  onTetapJalan={(alasan) => void tetapJalan(kelas, alasan)}
                  onBatalkan={() => void batalkan(kelas)}
                />
              ))
            )}
          </section>

          <aside
            className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5"
            aria-labelledby="ci-log"
          >
            <h2 id="ci-log" className="m-0 text-[22px] font-semibold text-dd-ink">
              Tercatat hari ini
            </h2>
            <div className="rounded-dd-md border border-dd-border-interactive bg-white p-5">
              {meja.tercatat.length === 0 ? (
                <p className="m-0 text-[15px] text-dd-muted">Belum ada yang tercatat hari ini.</p>
              ) : (
                <ul className="m-0 list-none p-0" aria-label="Kehadiran tercatat hari ini">
                  {meja.tercatat.slice(0, 8).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-3 border-b border-dd-line/70 py-2.5 first:pt-0 last:border-b-0"
                    >
                      <span className="min-w-0">
                        <span className="block text-base font-bold text-dd-ink">{item.nama}</span>
                        <span
                          className={`block text-sm ${item.manual ? 'text-dd-warning' : 'text-dd-muted'}`}
                        >
                          {item.manual
                            ? `Dicatat manual${item.dicatatOleh ? ` oleh ${item.dicatatOleh}` : ''}`
                            : item.jenis === 'INSTRUKTUR'
                              ? 'Pindai QR · instruktur'
                              : `Pindai QR · ${item.namaKelas} ${jam(item.mulaiKelas, tz)}`}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-base font-bold ${item.manual ? 'text-dd-warning' : 'text-dd-forest'}`}
                      >
                        {jam(item.tercatatPada, tz)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="secondary"
                fullWidth
                className="mt-3"
                onClick={() => setManualOpen(true)}
                disabled={!bookingClient.backfillAttendance}
              >
                Catat kehadiran manual
              </Button>
              <p className="m-0 mt-2.5 text-sm text-dd-muted">
                Dipakai saat QR member tidak terbaca. Nama staf pencatat ikut tersimpan.
              </p>
            </div>

            {perluDitutup.map((kelas) => (
              <div
                key={kelas.id}
                className="rounded-dd-md border border-dd-border-interactive bg-white p-5"
              >
                <h3 className="m-0 font-sans text-lg font-bold text-dd-ink">
                  Tutup kelas {jam(kelas.startAt, tz)}
                </h3>
                <p className="m-0 mt-1 text-[15px] text-dd-muted">
                  Kelas sudah selesai. Menutup kelas memotong sesi peserta yang hadir dan mencatat
                  sisanya sebagai tidak hadir.
                </p>
                <Button
                  fullWidth
                  className="mt-3"
                  disabled={busyId === kelas.id}
                  onClick={() => void tutupKelas(kelas)}
                >
                  {busyId === kelas.id ? 'Menutup…' : `Tutup kelas ${jam(kelas.startAt, tz)}`}
                </Button>
              </div>
            ))}
          </aside>
        </div>
      )}

      {meja && <TabelTidakHadir baris={tidakHadir} timezone={tz} />}

      {meja && manualOpen && bookingClient.backfillAttendance && (
        <CatatManual
          open={manualOpen}
          kelas={meja.kelas.filter(
            (k) =>
              !['CANCELLED', 'AUTO_CANCELLED'].includes(k.status) &&
              new Date(k.startAt).getTime() <= now,
          )}
          timezone={tz}
          bookingClient={bookingClient as Required<typeof bookingClient>}
          onClose={() => setManualOpen(false)}
          onDone={(nama) => {
            setManualOpen(false);
            setMessage(`Kehadiran ${nama} dicatat manual.`);
            void muat();
          }}
        />
      )}
    </section>
  );
}

function KartuCheckIn({
  kartu,
  timezone,
  onClose,
}: {
  kartu: TercatatMeja;
  timezone: string;
  onClose(): void;
}) {
  return (
    <section
      aria-live="polite"
      aria-labelledby="ci-ok"
      className="flex flex-wrap items-center gap-[26px] rounded-2xl bg-dd-forest p-8"
    >
      <span className="relative block shrink-0">
        {kartu.fotoUrl ? (
          <img
            src={resolvePublicImageUrl(kartu.fotoUrl)}
            alt={`Foto ${kartu.nama} saat mendaftar`}
            className="size-32 rounded-[14px] border-2 border-[#bfe3cd] object-cover"
          />
        ) : (
          <span className="flex size-32 items-center justify-center rounded-[14px] border-2 border-[#bfe3cd] bg-[#1a3a28] p-2 text-center text-[15px] leading-snug text-[#bfe3cd]">
            Belum ada foto selfie
          </span>
        )}
        <span className="absolute -bottom-2.5 -right-2.5 flex size-[46px] items-center justify-center rounded-full border-[3px] border-dd-forest bg-[#6ee7a8]">
          <Check className="size-6 text-[#0b2817]" strokeWidth={3} aria-hidden="true" />
        </span>
      </span>
      <div className="min-w-0 flex-[999_1_300px]">
        <h2
          id="ci-ok"
          className="m-0 mb-2 text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-white"
        >
          {kartu.nama} sudah check-in
        </h2>
        <p className="m-0 mb-1.5 text-xl text-white">
          {[
            kartu.namaKelas,
            `${jam(kartu.mulaiKelas, timezone)} sampai ${jam(kartu.selesaiKelas, timezone)}`,
            kartu.namaStudio,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="m-0 mb-2.5 text-lg text-[#bfe3cd]">
          Tercatat pukul {jam(kartu.tercatatPada, timezone)}. Terima kasih, selamat berlatih.
        </p>
        <p className="m-0 text-base text-[#bfe3cd]">
          {kartu.fotoUrl
            ? 'Cocokkan foto di samping dengan orang di depan Anda. Jika berbeda, tekan Tutup sekarang dan catat manual.'
            : 'Member ini belum mengunggah selfie, jadi wajahnya belum bisa dicocokkan. Minta dia melengkapinya di menu Akun.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="min-h-[52px] shrink-0 rounded-[10px] border border-[#bfe3cd] bg-transparent px-[22px] text-[17px] font-bold text-white transition hover:bg-white/10"
      >
        Tutup sekarang
      </button>
    </section>
  );
}

function BilahHadir({ hadir, dari, kurang }: { hadir: number; dari: number; kurang: boolean }) {
  const persen = dari > 0 ? Math.min(100, Math.round((hadir / dari) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={dari}
      aria-valuenow={hadir}
      aria-label={`${hadir} hadir dari ${dari}`}
      className="mt-3 h-3.5 overflow-hidden rounded-full border border-dd-border-interactive bg-[#c9ced6]"
    >
      <div
        className={`h-full rounded-full ${kurang ? 'bg-dd-warning' : 'bg-dd-forest'}`}
        style={{ width: `${persen}%` }}
      />
    </div>
  );
}

function KartuKelas({
  kelas,
  timezone,
  busy,
  onTetapJalan,
  onBatalkan,
}: {
  kelas: KelasMeja;
  timezone: string;
  busy: boolean;
  onTetapJalan(alasan: string): void;
  onBatalkan(): void;
}) {
  const [menulisAlasan, setMenulisAlasan] = useState(false);
  const [alasan, setAlasan] = useState('');
  const { kuota } = kelas;
  const butuhKeputusan = kuota.perluKeputusan && !kelas.keputusan;
  const kurang = kuota.status === 'KURANG' || kuota.status === 'KURANG_LEWAT_BATAS';
  const batas = new Date(new Date(kelas.startAt).getTime() - 5 * 60_000).toISOString();
  const belumPindai = kelas.terdaftar - kelas.hadir;

  const judul = `${jam(kelas.startAt, timezone)} · ${kelas.namaKelas}`;
  const lencana = butuhKeputusan ? (
    <span className="shrink-0 rounded-[7px] bg-dd-warning px-2.5 py-1 text-sm font-bold text-white">
      Kurang {kuota.kurang} orang
    </span>
  ) : kelas.berjalan ? (
    <span className="shrink-0 rounded-[7px] border border-dd-forest bg-dd-success-soft px-2.5 py-1 text-sm font-bold text-dd-forest">
      Berjalan
    </span>
  ) : null;

  return (
    <article
      aria-label={judul}
      className={`rounded-dd-md border p-5 ${
        butuhKeputusan
          ? 'border-dd-warning-line bg-dd-warning-soft'
          : 'border-dd-border-interactive bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 text-xl font-semibold text-dd-ink">{judul}</h3>
        {lencana}
      </div>

      {butuhKeputusan ? (
        <p className="m-0 mt-2 text-base text-dd-warning">
          <strong>
            {kuota.hadir} hadir dari minimum {kuota.minimum}.
          </strong>{' '}
          Batas keputusan {Math.max(0, kuota.menitTersisa ?? 0)} menit lagi, pukul{' '}
          {jam(batas, timezone)}.
        </p>
      ) : (
        <p className="m-0 mt-2 text-base text-dd-ink">
          {kelas.hadir} hadir dari {kelas.terdaftar} terdaftar
          {kuota.minimum !== null &&
            (kuota.status === 'TERPENUHI'
              ? ` · minimum ${kuota.minimum} terpenuhi`
              : ` · minimum ${kuota.minimum}`)}
        </p>
      )}

      <BilahHadir
        hadir={kelas.hadir}
        dari={butuhKeputusan ? (kuota.minimum ?? kelas.terdaftar) : kelas.terdaftar}
        kurang={kurang}
      />

      {kelas.keputusan && (
        <p className="m-0 mt-3 text-[15px] text-dd-ink">
          Tetap dijalankan, diputuskan {kelas.keputusan.oleh ?? 'staf'} pukul{' '}
          {jam(kelas.keputusan.pada, timezone)}. Sudah dilaporkan ke Super Owner.
        </p>
      )}

      {!butuhKeputusan && kelas.berjalan && belumPindai > 0 && (
        <p className="m-0 mt-3 text-[15px] text-dd-muted">
          {belumPindai === 1 ? 'Satu' : belumPindai} peserta belum memindai QR. Jika sampai kelas
          selesai tetap tidak memindai, mereka masuk laporan tidak hadir.
        </p>
      )}

      {kuota.status === 'KURANG_LEWAT_BATAS' && !kelas.keputusan && (
        <p className="m-0 mt-3 text-[15px] text-dd-warning">
          Batas keputusan sudah lewat. Kelas tetap berjalan dan kekurangannya dicatat.
        </p>
      )}

      {butuhKeputusan && (
        <>
          {menulisAlasan ? (
            <div className="mt-4 space-y-2.5">
              <Textarea
                label="Alasan tetap menjalankan kelas"
                description={`Minimal ${MIN_ALASAN} karakter, mis. "Dua peserta sudah di studio".`}
                value={alasan}
                rows={2}
                onChange={(event) => setAlasan(event.target.value)}
              />
              <div className="flex flex-wrap gap-2.5">
                <Button
                  disabled={busy || alasan.trim().length < MIN_ALASAN}
                  onClick={() => onTetapJalan(alasan.trim())}
                >
                  {busy ? 'Mencatat…' : 'Kirim, tetap jalankan'}
                </Button>
                <Button variant="secondary" onClick={() => setMenulisAlasan(false)}>
                  Kembali
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button disabled={busy} onClick={() => setMenulisAlasan(true)}>
                Tetap jalankan kelas
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={onBatalkan}
                className="min-h-11 rounded-dd-sm border border-dd-danger bg-white px-4 text-[15px] font-bold text-dd-danger transition hover:bg-dd-danger-soft disabled:opacity-60"
              >
                Batalkan, kembalikan sesi
              </button>
            </div>
          )}
          <div className="mt-4 flex gap-3 rounded-dd-sm border border-dd-warning-line bg-white p-4 text-[15px] text-dd-warning">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="m-0">
              <strong>Menjalankan kelas di bawah kuota dilaporkan ke Super Owner.</strong> Honor
              instruktur tetap penuh sementara peserta kurang, jadi selisihnya tercatat sebagai
              beban cabang. Nama Anda dan alasannya ikut tersimpan.
            </p>
          </div>
          <p className="m-0 mt-3 text-[15px] text-dd-warning">
            Sistem tidak membatalkan sendiri saat peserta sudah berada di studio. Tanpa keputusan
            sampai batas waktu, kelas tetap berjalan dan kekurangannya dicatat.
          </p>
        </>
      )}
    </article>
  );
}

function TabelTidakHadir({ baris, timezone }: { baris: BarisTidakHadir[]; timezone: string }) {
  return (
    <section aria-labelledby="ci-noshow" className="space-y-3">
      <h2 id="ci-noshow" className="m-0 text-[22px] font-semibold text-dd-ink">
        Tidak hadir, sesi hangus
      </h2>
      <p className="m-0 max-w-4xl text-base text-dd-muted">
        Peserta terdaftar yang tidak memindai QR sampai kelas ditutup. Sesinya terpotong sesuai
        aturan, dan tercatat di sini supaya bisa dikoreksi kalau ternyata kesalahan studio.
      </p>
      {baris.length === 0 ? (
        <p className="m-0 rounded-dd-md border border-dd-border-interactive bg-white p-5 text-[15px] text-dd-muted">
          Belum ada peserta yang tidak hadir hari ini.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-dd-md border border-dd-border-interactive bg-white">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-dd-line text-[15px] font-bold text-dd-muted">
                <th className="px-5 py-3.5 font-bold">Member</th>
                <th className="px-5 py-3.5 font-bold">Kelas</th>
                <th className="px-5 py-3.5 font-bold">Sesi</th>
                <th className="px-5 py-3.5 text-right font-bold">Kalau ini salah kami</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((row) => (
                <tr key={row.bookingId} className="border-b border-dd-line/70 last:border-b-0">
                  <td className="px-5 py-3.5">
                    <span className="block text-base font-bold text-dd-ink">{row.nama}</span>
                    {row.sisaSesi !== null && (
                      <span className="block text-[15px] text-dd-muted">
                        Sisa {row.sisaSesi} sesi
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-base text-dd-ink">
                    {jam(row.mulai, timezone)} {row.namaKelas ?? 'Kelas'}
                  </td>
                  <td className="px-5 py-3.5 text-base font-bold">
                    {row.sudahDikoreksi ? (
                      <span className="text-dd-forest">Sudah dikembalikan</span>
                    ) : (
                      <span className="text-dd-danger">Hangus, 1 sesi</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {!row.sudahDikoreksi && (
                      <Link
                        href={`/ledger/adjustments?${new URLSearchParams({
                          member: row.userId,
                          booking: row.bookingId,
                          sesi: '1',
                        }).toString()}`}
                        className="inline-flex min-h-11 items-center rounded-dd-sm border border-dd-border-interactive bg-white px-4 text-[15px] font-bold text-dd-forest no-underline transition hover:border-dd-forest"
                      >
                        Kembalikan sesi
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 max-w-4xl text-[15px] text-dd-muted">
        Tombol Kembalikan sesi membuka halaman Penyesuaian dengan member, kelas, dan jumlah sesi
        sudah terisi. Yang perlu ditambahkan hanya alasan dan buktinya. Hanya Super Owner dan Studio
        Manager yang dapat menyelesaikannya.
      </p>
    </section>
  );
}

/** Catat hadir untuk orang yang QR-nya tidak terbaca: pilih kelas, pilih orang, tulis alasan. */
function CatatManual({
  open,
  kelas,
  timezone,
  bookingClient,
  onClose,
  onDone,
}: {
  open: boolean;
  kelas: KelasMeja[];
  timezone: string;
  bookingClient: Required<Pick<BookingClient, 'list' | 'backfillAttendance'>>;
  onClose(): void;
  onDone(nama: string): void;
}) {
  const [kelasId, setKelasId] = useState(kelas[0]?.id ?? '');
  const [peserta, setPeserta] = useState<CustomerBookingRecord[]>([]);
  const [bookingId, setBookingId] = useState('');
  const [alasan, setAlasan] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const kunci = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!kelasId) return;
    let batal = false;
    setBookingId('');
    bookingClient
      .list({ classSlotId: kelasId, status: 'BOOKED', limit: 50 })
      .then((page) => {
        if (!batal) setPeserta(page.items.filter((item) => !item.attendance));
      })
      .catch(async (error) => {
        if (!batal) setFailure(await bookingFailure(error));
      });
    return () => {
      batal = true;
    };
  }, [bookingClient, kelasId]);

  const dipilih = peserta.find((item) => item.id === bookingId);

  const simpan = async () => {
    if (!dipilih) return;
    setBusy(true);
    setFailure('');
    try {
      await bookingClient.backfillAttendance(
        dipilih.id,
        alasan.trim(),
        dipilih.version,
        kunci.current,
      );
      onDone(dipilih.customer?.displayName ?? 'peserta');
    } catch (error) {
      const pesan = await bookingFailure(error);
      setFailure(
        /TOO_EARLY|terlalu awal|belum dimulai/i.test(pesan)
          ? 'Pencatatan manual baru bisa dilakukan setelah kelas mulai.'
          : pesan,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Catat kehadiran manual"
      description="Untuk member yang QR-nya tidak terbaca. Nama Anda tersimpan sebagai pencatat."
      onClose={onClose}
    >
      <div className="space-y-4">
        {failure && <Feedback kind="error">{failure}</Feedback>}
        {kelas.length === 0 ? (
          <p className="m-0 text-[15px] text-dd-muted">
            Belum ada kelas yang sudah mulai hari ini. Pencatatan manual baru bisa setelah kelas
            mulai.
          </p>
        ) : (
          <>
            <SelectInput label="Kelas" value={kelasId} onChange={(e) => setKelasId(e.target.value)}>
              {kelas.map((k) => (
                <option key={k.id} value={k.id}>
                  {jam(k.startAt, timezone)} · {k.namaKelas}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Member"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              disabled={peserta.length === 0}
            >
              <option value="">
                {peserta.length === 0 ? 'Semua peserta sudah tercatat' : 'Pilih member'}
              </option>
              {peserta.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customer?.displayName ?? 'Member'}
                </option>
              ))}
            </SelectInput>
            <Textarea
              label="Alasan"
              description="Mis. kamera tablet tidak membaca QR. Minimal 3 karakter."
              value={alasan}
              rows={2}
              onChange={(e) => setAlasan(e.target.value)}
            />
            <Button
              fullWidth
              disabled={busy || !dipilih || alasan.trim().length < 3}
              onClick={() => void simpan()}
            >
              {busy ? 'Mencatat…' : 'Catat hadir'}
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}
