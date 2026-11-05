'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, Upload } from 'lucide-react';
import type { CustomerPackageBalance } from '@/api-clients/booking-client';
import type { Adjustment } from '@/api-clients/ledger-client';
import {
  adjustmentEvidenceFailure,
  browserAdjustmentEvidenceClient,
  type AdjustmentEvidenceClient,
  type MemberPilihan,
} from '@/api-clients/adjustment-evidence-client';
import { Button } from '../../components/actions';
import { Feedback } from '../../ui';

export const MIN_ALASAN = 20;
const MAKS_PERUBAHAN = 50;
const JEDA_CARI_MS = 300;

function tanggal(value: Date | string | null | undefined, withTime = false) {
  if (!value) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }).format(new Date(value));
}

/** Paket yang paling masuk akal untuk dikoreksi: aktif dan paling lama berlaku lebih dulu. */
function urutPaket(paket: CustomerPackageBalance[]) {
  const nilai = (p: CustomerPackageBalance) => (p.status === 'ACTIVE' ? 0 : 1);
  return [...paket].sort(
    (a, b) =>
      nilai(a) - nilai(b) || new Date(b.expiryAt).getTime() - new Date(a.expiryAt).getTime(),
  );
}

export function PenyesuaianForm({
  client = browserAdjustmentEvidenceClient,
  awal,
}: {
  client?: AdjustmentEvidenceClient;
  /** Isian dari tautan "Kembalikan sesi" di layar check-in. */
  awal?: { memberId?: string; bookingId?: string; sesi?: number };
}) {
  const [query, setQuery] = useState('');
  const [hasilCari, setHasilCari] = useState<MemberPilihan[]>([]);
  const [member, setMember] = useState<MemberPilihan | null>(null);
  const [paket, setPaket] = useState<CustomerPackageBalance[]>([]);
  const [paketId, setPaketId] = useState('');
  const [jumlah, setJumlah] = useState(awal?.sesi && awal.sesi !== 0 ? awal.sesi : 1);
  const [alasan, setAlasan] = useState('');
  const [bukti, setBukti] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const [terakhir, setTerakhir] = useState<Adjustment[]>([]);
  const inputBukti = useRef<HTMLInputElement>(null);
  const bookingId = awal?.bookingId;

  const muatTerakhir = () =>
    client
      .terakhir()
      .then(setTerakhir)
      .catch(() => setTerakhir([]));

  useEffect(() => {
    void muatTerakhir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Datang dari "Kembalikan sesi": member sudah diketahui, namanya diambil dari paketnya.
  useEffect(() => {
    if (!awal?.memberId) return;
    void client.paketMember(awal.memberId).then((daftar) => {
      const nama = daftar.find((p) => p.customer?.displayName)?.customer?.displayName ?? 'Member';
      setMember({ id: awal.memberId!, displayName: nama });
    });
  }, [awal?.memberId, client]);

  useEffect(() => {
    const kata = query.trim();
    if (member || kata.length < 2) {
      setHasilCari([]);
      return;
    }
    const timer = window.setTimeout(() => {
      client
        .cariMember(kata)
        .then(setHasilCari)
        .catch(() => setHasilCari([]));
    }, JEDA_CARI_MS);
    return () => window.clearTimeout(timer);
  }, [client, member, query]);

  useEffect(() => {
    if (!member) {
      setPaket([]);
      setPaketId('');
      return;
    }
    let batal = false;
    client
      .paketMember(member.id)
      .then((daftar) => {
        if (batal) return;
        const urut = urutPaket(daftar);
        setPaket(urut);
        setPaketId(urut[0]?.id ?? '');
      })
      .catch(() => !batal && setFailure('Paket member belum dapat dimuat.'));
    return () => {
      batal = true;
    };
  }, [client, member]);

  const dipilih = paket.find((p) => p.id === paketId);
  // Saldo buku besar, bukan "tersedia": server menghitung hasil penyesuaian dari saldo ini dan menolak
  // pengurangan yang membuatnya lebih kecil dari sesi yang sedang tertahan booking.
  const sisa = dipilih?.ledgerBalance ?? dipilih?.remainingSessions ?? dipilih?.available ?? 0;
  const tertahan = dipilih?.reserved ?? 0;
  const sesudah = sisa + jumlah;
  const kurangiBerlebih = Boolean(dipilih) && jumlah < 0 && (sesudah < 0 || sesudah < tertahan);
  const panjangAlasan = alasan.trim().length;
  // Alasan tombol belum aktif, supaya tidak perlu menebak syarat mana yang kurang.
  const kendala = [
    !member && 'pilih member',
    member && !dipilih && 'pilih paket member',
    jumlah === 0 && 'jumlah sesi tidak boleh 0',
    kurangiBerlebih && 'pengurangan melebihi sisa sesi',
    panjangAlasan < MIN_ALASAN && `alasan kurang ${MIN_ALASAN - panjangAlasan} karakter`,
    !bukti && 'pilih berkas bukti',
  ].filter((item): item is string => Boolean(item));
  const siap = kendala.length === 0;

  const ubahJumlah = (arah: 1 | -1) =>
    setJumlah((kini) => {
      let next = kini + arah;
      if (next === 0) next += arah; // nol tidak mengubah apa pun, jadi dilewati
      return Math.max(-MAKS_PERUBAHAN, Math.min(MAKS_PERUBAHAN, next));
    });

  const kirim = async () => {
    if (!dipilih || !bukti) return;
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      const hasil = await client.kirim({
        customerPackageId: dipilih.id,
        quantity: jumlah,
        reason: alasan.trim(),
        bookingId,
        evidence: bukti,
      });
      setMessage(
        `${jumlah > 0 ? '+' : ''}${jumlah} sesi untuk ${member?.displayName}. Sisa sekarang ${hasil.resultingBalance} sesi.`,
      );
      setAlasan('');
      setBukti(null);
      if (inputBukti.current) inputBukti.current.value = '';
      setMember(null);
      setQuery('');
      void muatTerakhir();
    } catch (error) {
      setFailure(adjustmentEvidenceFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const daftarTerakhir = useMemo(() => terakhir.slice(0, 5), [terakhir]);

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section
        aria-labelledby="adj-form"
        className="min-w-0 flex-[999_1_480px] space-y-5 rounded-dd-md border border-dd-border-interactive bg-white p-6"
      >
        <h2 id="adj-form" className="m-0 text-[22px] font-semibold text-dd-ink">
          Buat penyesuaian sesi
        </h2>

        {failure && <Feedback kind="error">{failure}</Feedback>}
        {message && <Feedback kind="status">{message}</Feedback>}

        <div>
          <label htmlFor="adj-member" className="mb-2 block text-[15px] font-bold text-dd-ink">
            Member
          </label>
          {member ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-dd-sm border border-dd-forest bg-dd-success-soft px-3.5 py-2.5">
              <span className="text-base font-bold text-dd-ink">{member.displayName}</span>
              <button
                type="button"
                onClick={() => setMember(null)}
                className="min-h-11 text-[15px] font-bold text-dd-forest underline"
              >
                Ganti member
              </button>
            </div>
          ) : (
            <>
              <div className="flex h-12 items-center gap-2.5 rounded-dd-sm border border-dd-border-interactive bg-white px-3 focus-within:border-dd-forest">
                <Search className="size-[18px] shrink-0 text-dd-muted" aria-hidden="true" />
                <input
                  id="adj-member"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ketik nama atau nomor WhatsApp"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-dd-ink outline-none"
                />
              </div>
              {hasilCari.length > 0 && (
                <ul
                  aria-label="Hasil pencarian member"
                  className="m-0 mt-1 list-none rounded-dd-sm border border-dd-border-interactive p-0"
                >
                  {hasilCari.map((m) => (
                    <li key={m.id} className="border-b border-dd-line/60 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setMember(m)}
                        className="flex min-h-12 w-full items-center justify-between px-3 text-left hover:bg-dd-success-soft"
                      >
                        <span className="text-base text-dd-ink">{m.displayName}</span>
                        {m.phoneMasked && (
                          <span className="text-sm text-dd-muted">{m.phoneMasked}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {member && paket.length > 1 && (
            <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Paket yang disesuaikan">
              {paket.map((p) => (
                <label
                  key={p.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] text-dd-ink"
                >
                  <input
                    type="radio"
                    name="adj-paket"
                    checked={paketId === p.id}
                    onChange={() => setPaketId(p.id)}
                    className="size-4 accent-[#0d5132]"
                  />
                  {p.packageName ?? p.name} · sisa {p.ledgerBalance ?? p.remainingSessions ?? p.available} · berakhir{' '}
                  {tanggal(p.expiryAt)}
                </label>
              ))}
            </div>
          )}
          {member && dipilih && paket.length === 1 && (
            <p className="m-0 mt-2 text-[15px] text-dd-muted">
              Terpilih: {member.displayName} · {dipilih.packageName ?? dipilih.name} · sisa {sisa} ·
              berakhir {tanggal(dipilih.expiryAt)}
            </p>
          )}
          {member && paket.length === 0 && (
            <p className="m-0 mt-2 text-[15px] text-dd-muted">
              Tidak ada paket member ini yang bisa Anda sesuaikan. Member belum punya paket, atau
              paketnya dibeli di cabang yang di luar akses akun Anda.
            </p>
          )}
          {bookingId && (
            <p className="m-0 mt-2 text-[15px] text-dd-muted">
              Mengoreksi sesi hangus dari laporan tidak hadir; koreksi ini ditandai di laporan itu.
            </p>
          )}
        </div>

        <div>
          <p className="m-0 mb-2 text-[15px] font-bold text-dd-ink" id="adj-jumlah-label">
            Perubahan
          </p>
          <div className="flex items-center gap-4" aria-labelledby="adj-jumlah-label">
            <button
              type="button"
              aria-label="Kurangi satu sesi"
              onClick={() => ubahJumlah(-1)}
              className="flex size-12 items-center justify-center rounded-dd-sm border border-dd-border-interactive bg-white"
            >
              <Minus className="size-5" aria-hidden="true" />
            </button>
            <output
              aria-live="polite"
              className={`min-w-14 text-center font-display text-[32px] font-semibold ${jumlah > 0 ? 'text-dd-forest' : 'text-dd-danger'}`}
            >
              {jumlah > 0 ? `+${jumlah}` : jumlah}
            </output>
            <button
              type="button"
              aria-label="Tambah satu sesi"
              onClick={() => ubahJumlah(1)}
              className="flex size-12 items-center justify-center rounded-dd-sm border border-dd-border-interactive bg-white"
            >
              <Plus className="size-5" aria-hidden="true" />
            </button>
            {dipilih && (
              <span className="text-base text-dd-ink">
                sesi, menjadi <strong>{sesudah} sesi</strong>
              </span>
            )}
          </div>
          {kurangiBerlebih && (
            <p className="m-0 mt-2 text-sm text-dd-danger">
              Sisa sesi tidak cukup untuk dikurangi sebanyak itu
              {tertahan > 0 ? ` (${tertahan} sesi sedang tertahan booking)` : ''}.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="adj-alasan" className="mb-2 block text-[15px] font-bold text-dd-ink">
            Alasan, wajib diisi
          </label>
          <textarea
            id="adj-alasan"
            rows={3}
            value={alasan}
            maxLength={500}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="Tulis alasan yang bisa dipahami orang lain enam bulan lagi"
            aria-describedby="adj-alasan-hint"
            className="w-full rounded-dd-sm border border-dd-border-interactive p-3 text-base text-dd-ink"
          />
          <p id="adj-alasan-hint" className="m-0 mt-1.5 text-sm text-dd-muted">
            Minimal {MIN_ALASAN} karakter
            {alasan.trim().length > 0 && alasan.trim().length < MIN_ALASAN
              ? ` (kurang ${MIN_ALASAN - alasan.trim().length})`
              : ''}
            . Alasan ini muncul di buku besar sesi dan tidak bisa diubah setelah dikirim.
          </p>
        </div>

        <div>
          <p className="m-0 mb-2 text-[15px] font-bold text-dd-ink">Bukti pendukung, wajib</p>
          <div className="flex flex-col items-center gap-3 rounded-dd-sm border border-dashed border-dd-border-interactive p-6 text-center">
            <Upload className="size-6 text-dd-muted" aria-hidden="true" />
            <p className="m-0 text-[15px] text-dd-ink">
              {bukti
                ? bukti.name
                : 'Tangkapan layar percakapan, surat dokter, atau foto catatan studio'}
            </p>
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-dd-sm border border-dd-border-interactive bg-white px-4 text-[15px] font-bold text-dd-forest focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[#09371f]">
              {bukti ? 'Ganti berkas' : 'Pilih berkas'}
              <input
                ref={inputBukti}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                aria-label="Bukti pendukung"
                onChange={(e) => setBukti(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="m-0 text-sm text-dd-muted">Foto atau PDF, paling besar 8 MB.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-dd-line pt-4">
          <Button disabled={!siap || busy} onClick={() => void kirim()}>
            {busy ? 'Mengirim…' : 'Kirim penyesuaian'}
          </Button>
          <span className="text-[15px] text-dd-muted">
            {kendala.length > 0 && !busy
              ? `Belum bisa dikirim: ${kendala.join(', ')}.`
              : 'Berlaku langsung setelah dikirim.'}
          </span>
        </div>
      </section>

      <aside aria-labelledby="adj-recent" className="min-w-0 flex-[1_1_300px] space-y-3">
        <h2 id="adj-recent" className="m-0 text-[22px] font-semibold text-dd-ink">
          Penyesuaian terakhir
        </h2>
        {daftarTerakhir.length === 0 ? (
          <p className="m-0 rounded-dd-md border border-dd-border-interactive bg-white p-5 text-[15px] text-dd-muted">
            Belum ada penyesuaian.
          </p>
        ) : (
          daftarTerakhir.map((a) => (
            <article
              key={a.id}
              className="rounded-dd-md border border-dd-border-interactive bg-white p-5"
            >
              <p
                className={`m-0 text-base font-bold ${a.quantity > 0 ? 'text-dd-forest' : 'text-dd-danger'}`}
              >
                {a.quantity > 0 ? '+' : ''}
                {a.quantity} sesi · {a.customer?.displayName ?? 'Member'}
              </p>
              {a.decisionNote && (
                <p className="m-0 mt-1 text-[15px] text-dd-ink">{a.decisionNote}</p>
              )}
              <p className="m-0 mt-1.5 text-sm text-dd-muted">
                Oleh {a.decidedBy?.displayName ?? a.requestedBy?.displayName ?? 'staf'} ·{' '}
                {tanggal(a.decidedAt ?? a.createdAt, true)}
              </p>
              {a.status === 'POSTED' && (
                <a
                  href={`/api/v1/session-adjustments/${encodeURIComponent(a.id)}/evidence`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex min-h-11 items-center text-[15px] font-bold text-dd-forest underline"
                >
                  Lihat bukti
                </a>
              )}
            </article>
          ))
        )}
      </aside>
    </div>
  );
}
