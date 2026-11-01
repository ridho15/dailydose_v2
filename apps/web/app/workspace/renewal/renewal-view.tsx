'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  browserRetentionClient,
  type ExpiryCohort,
  type RetentionClient,
  type RetentionRow,
  type TrendCohort,
} from '@/api-clients/retention-client';
import { EmptyState, Feedback, Skeleton } from '../../ui';
import { Pagination } from '../../components/admin/admin-ui';
import { ADMIN_PAGE_SIZE } from '../../lib/pagination';
import { useSessionContext } from '../../session-context';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function namaBulan(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

function tanggal(iso: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

function hariLalu(iso: string, now: number) {
  const hari = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
  return hari === 0 ? 'hari ini' : `${hari} hari lalu`;
}

/** Nomor lokal 08xx menjadi 628xx untuk tautan wa.me; `null` bila nomornya tidak bisa dipakai. */
export function nomorWhatsApp(phone: string | null): string | null {
  const angka = (phone ?? '').replace(/\D/g, '');
  if (angka.length < 9) return null;
  if (angka.startsWith('62')) return angka;
  if (angka.startsWith('0')) return `62${angka.slice(1)}`;
  if (angka.startsWith('8')) return `62${angka}`;
  return null;
}

/** HOT lebih dulu (paling besar peluangnya), lalu yang belum renew, lalu yang paling lama menunggu. */
export function urutDaftar(rows: readonly RetentionRow[]) {
  return [...rows].sort(
    (a, b) =>
      Number(a.renewed) - Number(b.renewed) ||
      Number(a.endReason !== 'HOT') - Number(b.endReason !== 'HOT') ||
      a.validUntil.localeCompare(b.validUntil),
  );
}

/** Nilai yang belum kembali per alasan berhenti, dihitung dari baris yang belum renew. */
export function belumKembaliPer(rows: readonly RetentionRow[], alasan: RetentionRow['endReason']) {
  return rows
    .filter((r) => r.endReason === alasan && !r.renewed)
    .reduce((jumlah, r) => jumlah + (r.paidRp ?? 0), 0);
}

export function RenewalView({
  client = browserRetentionClient,
  now = Date.now(),
}: {
  client?: RetentionClient;
  now?: number;
}) {
  const branchId = useSessionContext()?.activeBranchId || undefined;
  const [tren, setTren] = useState<TrendCohort[]>([]);
  const [periode, setPeriode] = useState(() => new Date(now).toISOString().slice(0, 7));
  const [kohort, setKohort] = useState<ExpiryCohort | null>(null);
  const [failure, setFailure] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    client
      .trend(branchId)
      .then((t) => setTren(t.cohorts))
      .catch(() => setTren([]));
  }, [branchId, client]);

  useEffect(() => {
    let batal = false;
    setKohort(null);
    setFailure('');
    client
      .cohort(periode, branchId)
      .then((k) => !batal && setKohort(k))
      .catch(
        () => !batal && setFailure('Data paket habis belum dapat dimuat. Coba muat ulang halaman.'),
      );
    return () => {
      batal = true;
    };
  }, [branchId, client, periode]);

  useEffect(() => {
    setPage(1);
  }, [periode, branchId]);

  const daftar = useMemo(() => (kohort ? urutDaftar(kohort.rows) : []), [kohort]);
  const totalPages = Math.ceil(daftar.length / ADMIN_PAGE_SIZE) || 1;
  const pagedDaftar = useMemo(() => {
    const start = (page - 1) * ADMIN_PAGE_SIZE;
    return daftar.slice(start, start + ADMIN_PAGE_SIZE);
  }, [daftar, page]);

  const bulanIni = new Date(now).toISOString().slice(0, 7);
  const tigaBulanBelumKembali = tren.reduce((n, t) => n + t.potentialLoss.paidRp, 0);
  const tigaBulanMember = tren.reduce((n, t) => n + t.potentialLoss.customers, 0);

  return (
    <section aria-labelledby="renewal-title" className="space-y-6">
      <header>
        <h1
          id="renewal-title"
          className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-dd-ink sm:text-[32px]"
        >
          Paket habis &amp; renewal
        </h1>
        <p className="m-0 mt-1 text-[17px] text-dd-muted">
          Member dihitung memperpanjang jika membeli paket lagi dalam{' '}
          {kohort?.renewalWindowDays ?? 60} hari setelah paketnya habis, di cabang mana pun.
        </p>
      </header>

      {tren.length > 0 && (
        <div role="group" aria-label="Pilih bulan" className="flex flex-wrap gap-2">
          {tren.map((t) => (
            <button
              key={t.period}
              type="button"
              aria-pressed={periode === t.period}
              onClick={() => setPeriode(t.period)}
              className={`min-h-11 rounded-[9px] px-4 text-[15px] transition ${
                periode === t.period
                  ? 'bg-dd-forest font-bold text-white'
                  : 'border border-dd-border-interactive bg-white font-medium text-dd-ink hover:border-dd-forest'
              }`}
            >
              {namaBulan(t.period)}
            </button>
          ))}
        </div>
      )}

      {failure && <Feedback kind="error">{failure}</Feedback>}
      {!kohort && !failure && <Skeleton label="Memuat paket habis" />}

      {kohort && kohort.total.customers === 0 && (
        <EmptyState
          title={`Tidak ada paket yang habis pada ${namaBulan(periode)}`}
          description="Pilih bulan lain untuk melihat siapa yang perlu dihubungi."
        />
      )}

      {kohort && kohort.total.customers > 0 && (
        <>
          <div className="flex flex-wrap gap-4">
            <section
              aria-labelledby="renewal-loss"
              className="min-w-0 flex-[999_1_420px] rounded-2xl bg-dd-forest p-7 text-white"
            >
              <p id="renewal-loss" className="m-0 text-[15px] font-bold text-[#bfe3cd]">
                Belum kembali dari {namaBulan(periode)}
              </p>
              <p className="m-0 mt-1 font-display text-[clamp(40px,6vw,64px)] font-semibold leading-[1.05]">
                {rp(kohort.potentialLoss.paidRp)}
              </p>
              <p className="m-0 mt-3 max-w-2xl text-[16px] leading-relaxed text-[#d1fae5]">
                Nilai yang dulu dibayar {kohort.potentialLoss.customers} member yang sampai sekarang
                belum memperpanjang. Angka ini bukan proyeksi harga baru, melainkan yang benar-benar
                pernah masuk.
                {kohort.potentialLoss.packagesWithoutValue > 0 &&
                  ` ${kohort.potentialLoss.packagesWithoutValue} paket tanpa pembelian tercatat tidak ikut dihitung.`}
              </p>
            </section>
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-4">
              <div className="rounded-dd-md border border-dd-border-interactive bg-white p-5">
                <p className="m-0 text-[15px] font-bold text-dd-muted">Sudah kembali</p>
                <p className="m-0 mt-1 font-display text-[26px] font-semibold text-dd-ink">
                  {rp(kohort.renewed.paidRp)}
                </p>
                <p className="m-0 mt-1 text-sm text-dd-muted">
                  Dari {kohort.renewed.customers} member yang memperpanjang
                </p>
              </div>
              <div className="rounded-dd-md border border-dd-border-interactive bg-white p-5">
                <p className="m-0 text-[15px] font-bold text-dd-muted">Rata-rata per member</p>
                <p className="m-0 mt-1 font-display text-[26px] font-semibold text-dd-ink">
                  {kohort.potentialLoss.paidPerCustomerRp === null
                    ? '—'
                    : rp(kohort.potentialLoss.paidPerCustomerRp)}
                </p>
                <p className="m-0 mt-1 text-sm text-dd-muted">
                  Nilai satu member kalau berhasil kembali
                </p>
              </div>
            </div>
          </div>

          <BagianKembali kohort={kohort} periode={periode} />

          {tigaBulanMember > 0 && (
            <p className="m-0 text-[15px] text-dd-ink">
              {tren.length} bulan terakhir digabung, nilai yang belum kembali{' '}
              <strong>{rp(tigaBulanBelumKembali)}</strong> dari {tigaBulanMember} member.
            </p>
          )}

          <section aria-labelledby="renewal-reasons" className="space-y-3">
            <h2 id="renewal-reasons" className="m-0 text-[22px] font-semibold text-dd-ink">
              Dua alasan paket berhenti terpakai
            </h2>
            <div className="flex flex-wrap gap-4">
              <KartuAlasan
                lencana="HOT"
                tegas
                ringkas={kohort.segments.hot}
                belumKembali={belumKembaliPer(kohort.rows, 'HOT') }
                keterangan="Sesi habis lebih cepat dari masa berlaku. Member paling rajin latihan, peluang renewal paling besar. Hubungi duluan."
              />
              <KartuAlasan
                lencana="Lewat tanggal"
                ringkas={kohort.segments.expired}
                belumKembali={belumKembaliPer(kohort.rows, 'EXPIRED')}
                keterangan="Masa berlaku habis, sesi masih tersisa. Biasanya sudah lama tidak datang, perlu alasan untuk kembali."
              />
            </div>
          </section>

          <section aria-labelledby="renewal-list" className="space-y-3">
            <h2 id="renewal-list" className="m-0 text-[22px] font-semibold text-dd-ink">
              Daftar member, HOT lebih dulu
            </h2>
            <div className="overflow-x-auto rounded-dd-md border border-dd-border-interactive bg-white">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-dd-line text-[15px] font-bold text-dd-muted">
                    <th className="px-4 py-3 font-bold">Member</th>
                    <th className="px-4 py-3 font-bold">Segmen</th>
                    <th className="px-4 py-3 font-bold">Habis</th>
                    <th className="px-4 py-3 text-right font-bold">Dibayar</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 text-right font-bold">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDaftar.map((r) => {
                    const wa = nomorWhatsApp(r.phone);
                    const pesan = `Halo ${r.customerName ?? ''}, paket ${r.packageName ?? 'Anda'} di Daily Dose sudah habis. Mau kami bantu perpanjang?`;
                    return (
                      <tr
                        key={r.customerPackageId}
                        className="border-b border-dd-line/70 last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <span className="block text-base font-bold text-dd-ink">
                            {r.customerName ?? 'Member'}
                          </span>
                          <span className="block text-sm text-dd-muted">{r.packageName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-[6px] px-2 py-0.5 text-[13px] font-bold ${
                              r.endReason === 'HOT'
                                ? 'bg-dd-forest text-white'
                                : 'border border-dd-border-interactive text-dd-ink'
                            }`}
                          >
                            {r.endReason === 'HOT' ? 'HOT' : 'Lewat tanggal'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-base text-dd-ink">
                            {tanggal(r.validUntil)}
                          </span>
                          <span className="block text-sm text-dd-muted">
                            {hariLalu(r.validUntil, now)}
                            {r.endReason === 'EXPIRED' && r.remainingSessions > 0
                              ? ` · sisa ${r.remainingSessions} sesi`
                              : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-base text-dd-ink">
                          {r.paidRp === null ? '—' : rp(r.paidRp)}
                        </td>
                        <td className="px-4 py-3 text-[15px] font-bold">
                          {r.renewed ? (
                            <span className="text-dd-forest">
                              Sudah renew{r.renewedAt ? ` ${tanggal(r.renewedAt)}` : ''}
                            </span>
                          ) : (
                            <span className="text-dd-danger">Belum renew</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.renewed ? (
                            <span className="text-[15px] text-dd-muted">Selesai</span>
                          ) : wa ? (
                            <a
                              href={`https://wa.me/${wa}?text=${encodeURIComponent(pesan)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-11 items-center rounded-dd-sm bg-dd-forest px-4 text-[15px] font-bold text-white no-underline hover:bg-dd-forest-dark"
                            >
                              WhatsApp
                            </a>
                          ) : (
                            <span className="text-sm text-dd-muted">Nomor belum ada</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {daftar.length > ADMIN_PAGE_SIZE && (
              <div className="pt-2">
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  totalItems={daftar.length}
                  pageSize={ADMIN_PAGE_SIZE}
                  hasPrevious={page > 1}
                  hasNext={page < totalPages}
                  onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                  onPageChange={(targetPage) => setPage(targetPage)}
                />
              </div>
            )}
            <p className="m-0 text-sm text-dd-muted">
              Paket yang dibekukan tidak dihitung karena masa berlakunya masih ditambah saat dibuka.
            </p>
          </section>

          {tren.length > 1 && (
            <section aria-labelledby="renewal-trend" className="space-y-3">
              <h2 id="renewal-trend" className="m-0 text-[22px] font-semibold text-dd-ink">
                {tren.length} bulan terakhir
              </h2>
              <div className="flex flex-wrap gap-4">
                {tren.map((t) => (
                  <div
                    key={t.period}
                    className={`min-w-0 flex-[1_1_220px] rounded-dd-md border bg-white p-5 ${
                      t.period === bulanIni
                        ? 'border-2 border-dd-forest'
                        : 'border-dd-border-interactive'
                    }`}
                  >
                    <p
                      className={`m-0 text-[15px] font-bold ${t.period === bulanIni ? 'text-dd-forest' : 'text-dd-muted'}`}
                    >
                      {namaBulan(t.period)}
                      {t.period === bulanIni ? ', berjalan' : ''}
                    </p>
                    <p className="m-0 mt-1 font-display text-[28px] font-semibold text-dd-ink">
                      {t.renewalRatePct === null ? '—' : `${Math.round(t.renewalRatePct)}%`}
                    </p>
                    <p className="m-0 text-sm text-dd-muted">
                      {t.renewed.customers} dari {t.total.customers} member
                      {t.period === bulanIni
                        ? `, jendela ${kohort.renewalWindowDays} hari belum tutup`
                        : ''}
                    </p>
                    {t.potentialLoss.paidRp > 0 && (
                      <p className="m-0 mt-1 text-sm font-bold text-dd-danger">
                        Belum kembali {rp(t.potentialLoss.paidRp)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function BagianKembali({ kohort, periode }: { kohort: ExpiryCohort; periode: string }) {
  const total = kohort.total.paidRp;
  const kembali = kohort.renewed.paidRp;
  const persen = total > 0 ? Math.round((kembali / total) * 100) : 0;
  return (
    <section
      aria-labelledby="renewal-share"
      className="rounded-dd-md border border-dd-border-interactive bg-white p-5"
    >
      <h2 id="renewal-share" className="m-0 font-sans text-lg font-bold text-dd-ink">
        Berapa bagian yang sudah kembali
      </h2>
      <p className="m-0 mt-1 text-[15px] text-dd-muted">
        Dari total {rp(total)} nilai paket yang habis pada {namaBulan(periode)}.
      </p>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={persen}
        aria-label={`${persen}% nilai sudah kembali`}
        className="mt-4 h-4 overflow-hidden rounded-full border border-dd-border-interactive bg-[#c9ced6]"
      >
        <div className="h-full bg-dd-forest" style={{ width: `${persen}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-6 text-[15px]">
        <span>
          <strong className="text-dd-ink">Sudah kembali, {persen}%</strong>
          <span className="block text-sm text-dd-muted">
            {rp(kembali)} dari {kohort.renewed.customers} member
          </span>
        </span>
        <span>
          <strong className="text-dd-danger">Belum kembali, {100 - persen}%</strong>
          <span className="block text-sm text-dd-muted">
            {rp(kohort.potentialLoss.paidRp)} dari {kohort.potentialLoss.customers} member
          </span>
        </span>
      </div>
    </section>
  );
}

function KartuAlasan({
  lencana,
  tegas = false,
  ringkas,
  belumKembali,
  keterangan,
}: {
  lencana: string;
  tegas?: boolean;
  ringkas: { customers: number; paidRp: number };
  belumKembali: number;
  keterangan: string;
}) {
  return (
    <div
      className={`min-w-0 flex-[1_1_300px] rounded-dd-md border p-5 ${
        tegas ? 'border-dd-forest bg-dd-success-soft' : 'border-dd-border-interactive bg-white'
      }`}
    >
      <span
        className={`inline-block rounded-[6px] px-2 py-0.5 text-[13px] font-bold ${
          tegas ? 'bg-dd-forest text-white' : 'border border-dd-border-interactive text-dd-ink'
        }`}
      >
        {lencana}
      </span>
      <p className="m-0 mt-3 font-display text-2xl font-semibold text-dd-ink">
        {ringkas.customers} member · {rp(ringkas.paidRp)}
      </p>
      <p className="m-0 mt-1 font-display text-xl font-semibold text-dd-danger">
        {rp(belumKembali)} belum kembali
      </p>
      <p className="m-0 mt-2 text-[15px] text-dd-ink">{keterangan}</p>
    </div>
  );
}
