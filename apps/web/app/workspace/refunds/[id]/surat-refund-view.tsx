'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { Button } from '../../../components/actions';
import { formatRupiah } from '../../../lib/formatters';
import { Feedback, Skeleton } from '../../../ui';

type Surat = {
  id: string;
  tanggal: string;
  member: { id: string; nama: string; telepon: string | null };
  cabang: string;
  paket: { nama: string; kode: string | null; berlakuSejak: string | null; berlakuSampai: string | null };
  hargaDibayarRp: number;
  totalSesi: number;
  sesiTerpakai: number;
  sisaSesi: number;
  hargaPerSesiRp: number;
  nominalRefundRp: number;
  rekening: { bank: string; nomor: string; nama: string };
  alasan: string;
  petugas: string;
  adaBukti: boolean;
};

const tanggal = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    : '-';

function Baris({ label, nilai, kuat = false }: { label: string; nilai: string; kuat?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dd-line/70 py-2.5 text-sm">
      <span className="text-dd-muted">{label}</span>
      <span className={`text-right ${kuat ? 'font-semibold text-dd-ink' : 'text-dd-ink'}`}>{nilai}</span>
    </div>
  );
}

/** Surat konfirmasi refund paket; tombol Cetak memakai fitur cetak/simpan PDF dari browser. */
export function SuratRefundView({ id }: { id: string }) {
  const [data, setData] = useState<Surat | null>(null);
  const [gagal, setGagal] = useState(false);

  useEffect(() => {
    apiFetch<Surat>(`/refunds/${encodeURIComponent(id)}`, { label: 'Memuat surat refund…' })
      .then(setData)
      .catch(() => setGagal(true));
  }, [id]);

  if (gagal) return <Feedback kind="error">Surat refund tidak ditemukan atau bukan di cabang Anda.</Feedback>;
  if (!data) return <Skeleton label="Memuat surat refund" />;

  return (
    <main className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        {data.adaBukti && (
          <a
            className="inline-flex min-h-10 items-center rounded-dd-md border border-dd-line bg-white px-4 text-sm font-semibold text-dd-forest no-underline"
            href={`/api/v1/refunds/${encodeURIComponent(data.id)}/bukti`}
            target="_blank"
            rel="noreferrer"
          >
            Lihat bukti transfer
          </a>
        )}
        <Button size="sm" onClick={() => window.print()}>
          Cetak / simpan PDF
        </Button>
      </div>

      <article className="overflow-hidden rounded-dd-xl border border-dd-line bg-white shadow-sm print:border-0 print:shadow-none">
        <header className="bg-dd-ink px-6 py-6 text-white">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Daily Dose Pilates</p>
          <h1 className="m-0 mt-1 text-2xl font-semibold">Konfirmasi Refund Paket</h1>
          <p className="m-0 mt-1 text-sm text-white/80">{tanggal(data.tanggal)}</p>
        </header>

        <section className="px-6 pt-5">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-dd-forest">Informasi member</h2>
          <Baris label="Nama member" nilai={data.member.nama} kuat />
          <Baris label="Cabang" nilai={data.cabang} />
          <Baris label="Tanggal refund" nilai={tanggal(data.tanggal)} />
          <Baris label="Nomor refund" nilai={data.id.slice(0, 8).toUpperCase()} />
        </section>

        <section className="px-6 pt-5">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-dd-forest">Paket</h2>
          <Baris label="Nama paket" nilai={data.paket.nama} kuat />
          {data.paket.kode && <Baris label="Kode paket" nilai={data.paket.kode} />}
          <Baris label="Berlaku sejak" nilai={tanggal(data.paket.berlakuSejak)} />
          <Baris label="Total dibayarkan (harga final)" nilai={formatRupiah(data.hargaDibayarRp)} kuat />
          <Baris label="Total sesi" nilai={`${data.totalSesi} sesi`} />
          <Baris label="Sesi terpakai" nilai={`${data.sesiTerpakai} sesi`} />
          <Baris label="Sisa sesi direfund" nilai={`${data.sisaSesi} sesi`} kuat />
        </section>

        <section className="px-6 pt-5">
          <div className="rounded-dd-lg bg-dd-surface-muted p-4 text-sm leading-relaxed text-dd-ink">
            Refund dihitung prorata dari harga final yang dibayarkan: {formatRupiah(data.hargaDibayarRp)} ÷ {data.totalSesi}{' '}
            sesi = {formatRupiah(data.hargaPerSesiRp)} per sesi, dikali {data.sisaSesi} sesi yang belum dipakai.
          </div>
          <Baris label="Harga per sesi" nilai={formatRupiah(data.hargaPerSesiRp)} />
          <Baris label={`Sisa sesi × harga per sesi (${data.sisaSesi} sesi)`} nilai={formatRupiah(data.nominalRefundRp)} />
        </section>

        <section className="px-6 pt-5">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-dd-forest">Rekening tujuan</h2>
          <Baris label="Bank" nilai={data.rekening.bank} />
          <Baris label="Nomor rekening" nilai={data.rekening.nomor} kuat />
          <Baris label="Atas nama" nilai={data.rekening.nama} />
          <Baris label="Alasan" nilai={data.alasan} />
          <Baris label="Diproses oleh" nilai={data.petugas} />
        </section>

        <section className="m-6 flex items-end justify-between gap-4 rounded-dd-xl bg-dd-ink px-6 py-5 text-white">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Total refund</p>
            <p className="m-0 mt-1 text-xs text-white/70">{data.sisaSesi} sesi tersisa</p>
          </div>
          <p className="m-0 text-3xl font-semibold tabular-nums">{formatRupiah(data.nominalRefundRp)}</p>
        </section>
      </article>
    </main>
  );
}
