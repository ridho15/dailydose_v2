'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  browserKeuanganClient,
  keuanganFailure,
  type KeuanganClient,
  type KoreksiJam,
} from '@/api-clients/keuangan-client';
import {
  browserClassSlotClient,
  type ClassSlotClient,
  type ClassWorkspace,
} from '@/api-clients/class-slot-client';
import { formatBranchTime, zonedLocalDateTime } from '../../lib/class-time';
import { useSessionContext } from '../../session-context';
import { Feedback, Skeleton } from '../../ui';

const rp = (n: number) => `${n < 0 ? '−' : '+'}Rp ${Math.abs(n).toLocaleString('id-ID')}`;
const MIN_ALASAN = 20;

/** Tambah atau kurangi setengah jam, melompati nol karena nol tidak mengoreksi apa pun. */
export function geserJam(jam: number, arah: 1 | -1): number {
  const berikut = jam + arah * 0.5;
  if (berikut === 0) return arah * 0.5;
  return Math.max(-8, Math.min(8, berikut));
}

const jamTeks = (jam: number) =>
  `${jam > 0 ? '+' : '−'}${Math.abs(jam).toLocaleString('id-ID')} jam`;

function hariIni(timezone: string, now: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(now));
}

/**
 * Koreksi jam mengajar instruktur, per kelas, dengan alasan dan bukti. Nilai rupiahnya dihitung
 * server dari tarif kelas itu dan masuk ke payroll bulan kelasnya.
 */
export function KoreksiJamView({
  client = browserKeuanganClient,
  slotClient = browserClassSlotClient,
  now = Date.now(),
}: {
  client?: KeuanganClient;
  slotClient?: ClassSlotClient;
  now?: number;
}) {
  const context = useSessionContext();
  const branch = context?.activeBranch;
  const timezone = branch?.timezone ?? 'Asia/Jakarta';
  const [tanggal, setTanggal] = useState(() => hariIni(timezone, now));
  const [workspace, setWorkspace] = useState<ClassWorkspace | null>(null);
  const [slotId, setSlotId] = useState('');
  const [pengganti, setPengganti] = useState('');
  const [jam, setJam] = useState(1);
  const [alasan, setAlasan] = useState('');
  const [bukti, setBukti] = useState<File | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ kind: 'status' | 'error'; text: string } | null>(null);
  const [terakhir, setTerakhir] = useState<KoreksiJam[] | null>(null);

  useEffect(() => {
    if (!branch?.id) return;
    let batal = false;
    setWorkspace(null);
    setSlotId('');
    slotClient
      .discover({
        branchId: branch.id,
        branches: [{ id: branch.id, timezone }],
        timezone,
        from: zonedLocalDateTime(tanggal, '00:00', timezone),
        until: zonedLocalDateTime(tanggal, '23:59', timezone),
      })
      .then((w) => !batal && setWorkspace(w))
      .catch(
        () => !batal && setWorkspace({ slots: [], classTypes: [], instructors: [], studios: [] }),
      );
    return () => {
      batal = true;
    };
  }, [branch?.id, slotClient, tanggal, timezone]);

  const muatTerakhir = useCallback(() => {
    client
      .daftarKoreksiJam(branch?.id)
      .then((r) => setTerakhir(r.items))
      .catch(() => setTerakhir([]));
  }, [branch?.id, client]);
  useEffect(() => muatTerakhir(), [muatTerakhir]);

  if (!branch) {
    return (
      <Feedback kind="info">Pilih cabang di bagian atas untuk mengoreksi jam instruktur.</Feedback>
    );
  }

  const namaKelas = (classTypeId: string) =>
    workspace?.classTypes.find((t) => t.id === classTypeId)?.name ?? 'Kelas';
  const namaInstruktur = (id: string | null | undefined) =>
    workspace?.instructors.find((i) => i.id === id)?.displayName ?? 'Belum ada instruktur';
  const slots = [...(workspace?.slots ?? [])].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  const terpilih = slots.find((s) => s.id === slotId);
  const instrukturDipakai = pengganti || terpilih?.instructorUserId || '';
  const siap = Boolean(
    terpilih && instrukturDipakai && alasan.trim().length >= MIN_ALASAN && bukti,
  );

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (!siap || !terpilih || !bukti) return;
    setSibuk(true);
    setPesan(null);
    try {
      const hasil = await client.kirimKoreksiJam({
        classSlotId: terpilih.id,
        instructorId: pengganti || undefined,
        hours: jam,
        reason: alasan.trim(),
        evidence: bukti,
      });
      setPesan({
        kind: 'status',
        text: `Koreksi ${jamTeks(hasil.hours)} untuk ${hasil.instructorName ?? 'instruktur'} tercatat${hasil.amountRp === null ? '' : `: ${rp(hasil.amountRp)}`} pada payroll bulan kelasnya.`,
      });
      setAlasan('');
      setBukti(null);
      setJam(1);
      muatTerakhir();
    } catch (error) {
      setPesan({
        kind: 'error',
        text: keuanganFailure(error, 'Koreksi belum tersimpan. Coba lagi.'),
      });
    } finally {
      setSibuk(false);
    }
  };

  const kontrol =
    'mt-1 block min-h-11 w-full rounded-dd-lg border border-dd-border-interactive bg-white px-3 text-[15px] text-dd-ink';

  return (
    <section aria-labelledby="koreksi-title" className="space-y-6 font-sans text-dd-ink">
      <header>
        <h1
          id="koreksi-title"
          className="m-0 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]"
        >
          Koreksi jam instruktur
        </h1>
        <p className="m-0 mt-1 text-[17px] text-dd-muted">
          Untuk honor yang keliru: QR instruktur tidak terpindai, kelas salah ditandai batal, atau
          instruktur pengganti. Wajib alasan dan bukti; nilainya mengikuti tarif kelas itu.
        </p>
      </header>

      <form
        onSubmit={kirim}
        className="space-y-5 rounded-dd-lg border border-dd-line bg-white p-5"
        aria-label="Formulir koreksi jam"
      >
        <label className="block max-w-xs text-sm font-medium">
          Tanggal kelas
          <input
            type="date"
            value={tanggal}
            max={hariIni(timezone, now)}
            onChange={(e) => setTanggal(e.target.value)}
            className={kontrol}
          />
        </label>

        <fieldset className="m-0 border-0 p-0">
          <legend className="text-sm font-medium">Kelas</legend>
          {!workspace ? (
            <Skeleton label="Memuat kelas" />
          ) : slots.length === 0 ? (
            <p className="m-0 mt-1 text-[15px] text-dd-muted">
              Tidak ada kelas di {branch.name} pada tanggal ini.
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {slots.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-dd-lg border p-3 ${
                    slotId === s.id ? 'border-dd-forest bg-dd-success-soft' : 'border-dd-line'
                  }`}
                >
                  <input
                    type="radio"
                    name="kelas"
                    value={s.id}
                    checked={slotId === s.id}
                    onChange={() => {
                      setSlotId(s.id);
                      setPengganti('');
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-semibold tabular-nums">
                      {formatBranchTime(s.startAt, timezone)} –{' '}
                      {formatBranchTime(s.endAt, timezone)} · {namaKelas(s.classTypeId)}
                    </span>
                    <span className="block text-sm text-dd-muted">
                      {namaInstruktur(s.instructorUserId)}
                      {s.status === 'CANCELLED' ? ' · dibatalkan' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {terpilih && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Instruktur yang dikoreksi
              <select
                value={pengganti}
                onChange={(e) => setPengganti(e.target.value)}
                className={kontrol}
              >
                <option value="">{namaInstruktur(terpilih.instructorUserId)} (tercatat)</option>
                {(workspace?.instructors ?? [])
                  .filter((i) => i.id !== terpilih.instructorUserId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.displayName} (pengganti)
                    </option>
                  ))}
              </select>
            </label>
            <div className="text-sm font-medium">
              <span id="jam-label">Jam</span>
              <div
                className="mt-1 flex items-center gap-2"
                role="group"
                aria-labelledby="jam-label"
              >
                <button
                  type="button"
                  onClick={() => setJam((j) => geserJam(j, -1))}
                  aria-label="Kurangi setengah jam"
                  className="grid size-11 place-items-center rounded-dd-lg border border-dd-border-interactive bg-white text-xl"
                >
                  −
                </button>
                <output
                  aria-live="polite"
                  className={`min-w-28 text-center text-lg font-semibold tabular-nums ${jam < 0 ? 'text-dd-danger' : 'text-dd-forest'}`}
                >
                  {jamTeks(jam)}
                </output>
                <button
                  type="button"
                  onClick={() => setJam((j) => geserJam(j, 1))}
                  aria-label="Tambah setengah jam"
                  className="grid size-11 place-items-center rounded-dd-lg border border-dd-border-interactive bg-white text-xl"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        )}

        <label className="block text-sm font-medium">
          Alasan, wajib diisi
          <textarea
            value={alasan}
            maxLength={500}
            rows={3}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="Contoh: QR instruktur tidak terpindai, kelas berjalan penuh dan dihadiri 6 peserta."
            className={`${kontrol} py-2`}
          />
          <span className="mt-1 block text-xs font-normal text-dd-muted">
            {alasan.trim().length < MIN_ALASAN
              ? `Minimal ${MIN_ALASAN} karakter (${alasan.trim().length}/${MIN_ALASAN}).`
              : 'Cukup.'}
          </span>
        </label>

        <label className="block text-sm font-medium">
          Bukti pendukung
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setBukti(e.target.files?.[0] ?? null)}
            className="mt-1 block text-[15px]"
          />
          <span className="mt-1 block text-xs font-normal text-dd-muted">
            Foto atau PDF, maksimal 8 MB: tangkapan layar jadwal, chat, atau catatan studio.
          </span>
        </label>

        <button
          type="submit"
          disabled={!siap || sibuk}
          className="min-h-11 rounded-dd-lg bg-dd-forest px-6 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sibuk ? 'Menyimpan…' : 'Simpan koreksi'}
        </button>
        {pesan && <Feedback kind={pesan.kind}>{pesan.text}</Feedback>}
      </form>

      <section aria-labelledby="terakhir-title" className="space-y-3">
        <h2 id="terakhir-title" className="m-0 text-xl font-semibold">
          Koreksi terakhir
        </h2>
        {terakhir === null ? (
          <Skeleton label="Memuat koreksi" />
        ) : terakhir.length === 0 ? (
          <p className="m-0 text-[15px] text-dd-muted">Belum ada koreksi jam di cabang ini.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-dd-line/70 rounded-dd-lg border border-dd-line bg-white px-5 py-1">
            {terakhir.map((k) => (
              <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {jamTeks(k.hours)} · {k.instructorName ?? 'Instruktur'}
                  </span>
                  <span className="block text-sm text-dd-muted">
                    {k.className ?? 'Kelas'},{' '}
                    {new Date(k.classStartAt).toLocaleString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: timezone,
                    })}
                    {k.decidedByName ? ` · oleh ${k.decidedByName}` : ''}
                  </span>
                  <span className="block text-sm text-dd-ink">{k.reason}</span>
                </span>
                <span className="text-right">
                  {k.amountRp === null ? (
                    <span className="block font-semibold tabular-nums text-dd-ink">
                      {jamTeks(k.hours)}
                    </span>
                  ) : (
                    <span
                      className={`block font-semibold tabular-nums ${k.amountRp < 0 ? 'text-dd-danger' : 'text-dd-forest'}`}
                    >
                      {rp(k.amountRp)}
                    </span>
                  )}
                  <a
                    href={k.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-dd-forest"
                  >
                    Lihat bukti
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
