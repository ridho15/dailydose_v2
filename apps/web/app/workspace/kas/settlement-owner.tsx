'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  keuanganFailure,
  type KeuanganClient,
  type PorsiCabang,
  type SettlementOwner,
} from '@/api-clients/keuangan-client';
import { Button } from '../../components/actions';
import { Modal } from '../../components/app-feedback';
import { Feedback, Skeleton } from '../../ui';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/**
 * Settlement akhir bulan antar Super Owner: berapa yang dibayar tiap cabang ke tiap Super Owner.
 * Hak = laba cabang × porsinya; reimburse = pengeluaran cabang yang ia bayar dengan uang pribadi.
 */
export function SettlementOwnerSection({
  client,
  periode,
  namaBulan,
}: {
  client: Required<Pick<KeuanganClient, 'settlementOwner' | 'porsiOwner' | 'simpanPorsi'>>;
  periode: string;
  namaBulan: string;
}) {
  const [data, setData] = useState<SettlementOwner | null>(null);
  const [gagal, setGagal] = useState('');
  const [aturPorsi, setAturPorsi] = useState(false);

  const muat = useCallback(() => {
    let batal = false;
    setGagal('');
    client
      .settlementOwner(periode)
      .then((hasil) => !batal && setData(hasil))
      .catch((error) => {
        if (batal) return;
        setData(null);
        setGagal(keuanganFailure(error, 'Settlement belum dapat dihitung. Coba muat ulang.'));
      });
    return () => {
      batal = true;
    };
  }, [client, periode]);

  useEffect(() => {
    setData(null);
    return muat();
  }, [muat]);

  return (
    <section aria-labelledby="settlement-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="settlement-title" className="m-0 text-xl font-semibold">
            Settlement Super Owner · {namaBulan}
          </h2>
          <p className="m-0 mt-0.5 max-w-[68ch] text-[15px] text-dd-muted">
            Yang dibayar cabang ke tiap Super Owner: hak laba sesuai porsi di cabang itu, ditambah
            pengeluaran yang ia bayar dengan uang pribadi. Laba sama dengan Beranda Owner.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setAturPorsi(true)}>
          Atur porsi
        </Button>
      </div>

      {gagal && <Feedback kind="error">{gagal}</Feedback>}
      {!data && !gagal && <Skeleton label="Menghitung settlement" />}

      {data && (
        <div className="grid gap-4">
          {data.labaBelumDibagiRp !== 0 && (
            <Feedback kind="warning">
              Laba {rp(data.labaBelumDibagiRp)} dari cabang yang porsinya belum diatur belum dibagi.
              Tekan Atur porsi.
            </Feedback>
          )}

          {data.owners.length === 0 ? (
            <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-5 text-[15px] text-dd-muted">
              Belum ada yang dibagi pada {namaBulan}. Atur porsi Super Owner per cabang dulu.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
              {data.owners.map((o) => (
                <li key={o.id} className="rounded-dd-lg border border-dd-line bg-white p-5">
                  <p className="m-0 text-sm font-medium text-dd-muted">Dibayar ke {o.nama}</p>
                  <p
                    className={`m-0 mt-1 text-[26px] font-semibold tabular-nums ${o.totalRp < 0 ? 'text-dd-danger' : 'text-dd-forest'}`}
                  >
                    {rp(o.totalRp)}
                  </p>
                  <dl className="m-0 mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
                    <dt className="text-dd-muted">Hak laba</dt>
                    <dd className="m-0 text-right tabular-nums">{rp(o.hakRp)}</dd>
                    <dt className="text-dd-muted">Reimburse pengeluaran</dt>
                    <dd className="m-0 text-right tabular-nums">{rp(o.reimburseRp)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
            <table className="w-full min-w-[640px] text-[15px]">
              <caption className="sr-only">Settlement per cabang {namaBulan}</caption>
              <thead className="text-sm text-dd-muted">
                <tr className="border-b border-dd-line">
                  <th scope="col" className="py-3 pr-4 text-left font-medium">
                    Cabang
                  </th>
                  <th scope="col" className="py-3 pr-4 text-right font-medium">
                    Laba
                  </th>
                  <th scope="col" className="py-3 text-left font-medium">
                    Dibayar cabang ke
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dd-line/70">
                {data.cabang.map((c) => (
                  <tr key={c.branchId} className="align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-semibold">
                      {c.branchName}
                    </th>
                    <td
                      className={`whitespace-nowrap py-3 pr-4 text-right tabular-nums ${c.labaRp < 0 ? 'text-dd-danger' : ''}`}
                    >
                      {rp(c.labaRp)}
                    </td>
                    <td className="py-3">
                      {!c.porsiLengkap && (
                        <span className="block text-sm font-medium text-dd-warning">
                          Porsi belum diatur; laba belum dibagi
                        </span>
                      )}
                      {c.baris.length === 0 && c.porsiLengkap && (
                        <span className="text-dd-muted">Tidak ada</span>
                      )}
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {c.baris.map((b) => (
                          <li key={b.ownerId}>
                            <span className="font-semibold">{b.nama}</span>{' '}
                            <span className="tabular-nums">{rp(b.totalRp)}</span>
                            <span className="block text-sm text-dd-muted">
                              {b.persen > 0 ? `${b.persen}% laba ${rp(b.hakRp)}` : 'Tanpa porsi'}
                              {b.reimburseRp > 0 ? ` + reimburse ${rp(b.reimburseRp)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AturPorsi
        open={aturPorsi}
        client={client}
        onClose={() => setAturPorsi(false)}
        onSaved={() => void muat()}
      />
    </section>
  );
}

function AturPorsi({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: Required<Pick<KeuanganClient, 'porsiOwner' | 'simpanPorsi'>> &
    Pick<KeuanganClient, 'daftarOwner'>;
  onClose(): void;
  onSaved(): void;
}) {
  const [cabang, setCabang] = useState<PorsiCabang[] | null>(null);
  const [owners, setOwners] = useState<{ id: string; nama: string }[]>([]);
  const [isian, setIsian] = useState<Record<string, Record<string, string>>>({});
  const [pesan, setPesan] = useState<Record<string, { kind: 'status' | 'error'; text: string }>>(
    {},
  );
  const [sibuk, setSibuk] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let batal = false;
    Promise.all([client.porsiOwner(), client.daftarOwner?.() ?? Promise.resolve([])])
      .then(([daftar, so]) => {
        if (batal) return;
        setCabang(daftar);
        // Super Owner yang sudah tercatat di porsi tetap tampil walau kini nonaktif.
        const semua = new Map(so.map((o) => [o.id, o.nama]));
        for (const c of daftar)
          for (const p of c.porsi) if (!semua.has(p.ownerId)) semua.set(p.ownerId, p.nama);
        setOwners([...semua].map(([id, nama]) => ({ id, nama })));
        setIsian(
          Object.fromEntries(
            daftar.map((c) => [
              c.branchId,
              Object.fromEntries(c.porsi.map((p) => [p.ownerId, String(p.persen)])),
            ]),
          ),
        );
      })
      .catch(() => !batal && setCabang([]));
    return () => {
      batal = true;
    };
  }, [client, open]);

  const jumlah = (branchId: string) =>
    Object.values(isian[branchId] ?? {}).reduce(
      (a, v) => a + (Number(v.replace(',', '.')) || 0),
      0,
    );

  const simpan = async (branchId: string) => {
    setSibuk(branchId);
    setPesan((p) => ({ ...p, [branchId]: undefined as never }));
    try {
      const porsi = owners
        .map((o) => ({
          ownerId: o.id,
          persen: Number((isian[branchId]?.[o.id] ?? '').replace(',', '.')) || 0,
        }))
        .filter((p) => p.persen > 0);
      await client.simpanPorsi(branchId, porsi);
      setPesan((p) => ({ ...p, [branchId]: { kind: 'status', text: 'Porsi tersimpan.' } }));
      onSaved();
    } catch (error) {
      setPesan((p) => ({
        ...p,
        [branchId]: { kind: 'error', text: keuanganFailure(error, 'Porsi harus berjumlah 100%.') },
      }));
    } finally {
      setSibuk(null);
    }
  };

  return (
    <Modal
      open={open}
      title="Porsi Super Owner per cabang"
      description="Persentase laba tiap cabang untuk tiap Super Owner. Satu cabang berjumlah 100%; kosongkan semua untuk menghapus."
      onClose={onClose}
    >
      {!cabang ? (
        <Skeleton label="Memuat porsi" />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0">
          {cabang.map((c) => {
            const total = jumlah(c.branchId);
            const pas = Math.abs(total - 100) < 0.001 || total === 0;
            return (
              <li key={c.branchId} className="rounded-dd-lg border border-dd-line p-4">
                <fieldset className="m-0 border-0 p-0">
                  <legend className="text-[15px] font-semibold">{c.branchName}</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {owners.map((o) => (
                      <label key={o.id} className="text-sm font-medium text-dd-ink">
                        {o.nama} (%)
                        <input
                          type="text"
                          inputMode="decimal"
                          value={isian[c.branchId]?.[o.id] ?? ''}
                          placeholder="0"
                          onChange={(e) =>
                            setIsian((s) => ({
                              ...s,
                              [c.branchId]: { ...s[c.branchId], [o.id]: e.target.value },
                            }))
                          }
                          className="mt-1 block min-h-11 w-full rounded-dd-lg border border-dd-border-interactive bg-white px-3 text-[15px] text-dd-ink"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-sm tabular-nums ${pas ? 'text-dd-muted' : 'font-semibold text-dd-danger'}`}
                  >
                    Jumlah {total.toLocaleString('id-ID')}%
                  </span>
                  <Button
                    size="sm"
                    disabled={!pas || sibuk !== null}
                    loading={sibuk === c.branchId}
                    onClick={() => void simpan(c.branchId)}
                  >
                    Simpan {c.branchName}
                  </Button>
                </div>
                {pesan[c.branchId] && (
                  <div className="mt-2">
                    <Feedback kind={pesan[c.branchId]!.kind}>{pesan[c.branchId]!.text}</Feedback>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
