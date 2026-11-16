import type { KasPayrollSimpanan } from '../api-clients/keuangan-client';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/** Ringkasan satu baris untuk kartu: saldo awal, masuk, keluar. */
export function catatanKasPayroll(kas: KasPayrollSimpanan): string {
  const keluar = kas.total.keluarPayrollRp + kas.total.keluarBalikRp;
  return `Saldo awal ${rp(kas.total.saldoAwalRp)} · masuk ${rp(kas.total.masukRp)} · keluar ${rp(keluar)}`;
}

/**
 * Kas payroll simpanan per cabang satu bulan. Masuk dari modal paket terjual; keluar untuk payroll
 * instruktur dan pembalikan modal (pembelian dibatalkan atau di-refund). Payroll tidak mengurangi
 * laba, hanya saldo kas ini.
 */
export function KasPayrollSimpananTabel({
  kas,
  judul = 'Kas payroll simpanan',
  judulId = 'kas-payroll-title',
}: {
  kas: KasPayrollSimpanan;
  judul?: string;
  judulId?: string;
}) {
  if (!kas.berlaku) return null;
  const adaBalik = kas.total.keluarBalikRp > 0;
  const baris = kas.cabang.length > 1 ? [...kas.cabang, { ...kas.total, branchId: 'total', branchName: 'Total' }] : kas.cabang;
  return (
    <section aria-labelledby={judulId} className="space-y-2">
      <h3 id={judulId} className="m-0 text-lg font-semibold">
        {judul}
      </h3>
      <p className="m-0 text-sm text-dd-muted">
        Masuk dari modal paket terjual. Payroll instruktur dibayar dari kas ini dan tidak mengurangi laba.
      </p>
      <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
        <table className="w-full min-w-[640px] text-[15px]">
          <thead className="text-sm text-dd-muted">
            <tr className="border-b border-dd-line">
              <th scope="col" className="py-3 pr-4 text-left font-medium">
                Cabang
              </th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">
                Saldo awal
              </th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">
                Masuk
              </th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">
                Keluar (payroll)
              </th>
              {adaBalik && (
                <th scope="col" className="py-3 pr-4 text-right font-medium">
                  Keluar (pembatalan/refund)
                </th>
              )}
              <th scope="col" className="py-3 text-right font-medium">
                Saldo akhir
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dd-line/70">
            {baris.map((c) => (
              <tr key={c.branchId} className={c.branchId === 'total' ? 'border-t-2 border-dd-line font-semibold' : ''}>
                <th scope="row" className="py-3 pr-4 text-left font-semibold text-dd-ink">
                  {c.branchName}
                </th>
                <td className="py-3 pr-4 text-right tabular-nums">{rp(c.saldoAwalRp)}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{rp(c.masukRp)}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{rp(c.keluarPayrollRp)}</td>
                {adaBalik && <td className="py-3 pr-4 text-right tabular-nums">{rp(c.keluarBalikRp)}</td>}
                <td
                  className={`py-3 text-right font-semibold tabular-nums ${c.saldoAkhirRp < 0 ? 'text-dd-danger' : 'text-dd-ink'}`}
                >
                  {rp(c.saldoAkhirRp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
