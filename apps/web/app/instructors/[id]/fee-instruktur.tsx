'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  browserMasterClient,
  masterFailureMessage,
  type MasterClient,
  type MasterSetting,
} from '@/api-clients/master-client';
import { Button } from '../../components/actions';
import { Modal } from '../../components/app-feedback';
import { DateInput, SelectInput, TextInput } from '../../components/forms';
import { formatRupiah } from '../../lib/formatters';
import { Feedback, Skeleton } from '../../ui';

type FeeClient = Pick<MasterClient, 'listSettings' | 'createSetting' | 'listClassTypes'>;

const hariIni = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const tanggal = (d: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);

/**
 * Fee instruktur per cabang dan tipe kelas, diatur dari detail instruktur. Hanya dibaca Super
 * Owner (Data Master); admin dan instruktur lain tidak melihat nominal ini. Honor dihitung dari
 * kelas selesai yang presensi instrukturnya tercatat (QR) dikali fee ini.
 */
export function FeeInstruktur({
  instructorId,
  branches,
  canEdit,
  client = browserMasterClient,
}: {
  instructorId: string;
  branches: { id: string; name: string }[];
  canEdit: boolean;
  client?: FeeClient;
}) {
  const [rows, setRows] = useState<MasterSetting[] | null>(null);
  const [gagal, setGagal] = useState('');
  const [form, setForm] = useState(false);

  const muat = useCallback(() => {
    let batal = false;
    setGagal('');
    client
      .listSettings('INSTRUCTOR_FEE')
      .then((semua) => !batal && setRows(semua.filter((r) => r.instructorId === instructorId)))
      .catch(() => !batal && setGagal('Fee instruktur belum dapat dimuat.'));
    return () => {
      batal = true;
    };
  }, [client, instructorId]);

  useEffect(() => muat(), [muat]);

  // Fee yang berlaku hari ini per cabang + tipe kelas, ditambah versi yang dijadwalkan berlaku nanti.
  const tampil = useMemo(() => {
    if (!rows) return [];
    const hari = new Date(`${hariIni()}T00:00:00Z`).getTime();
    const urut = [...rows].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const berlaku = new Map<string, MasterSetting>();
    const nanti: MasterSetting[] = [];
    for (const r of urut) {
      const kunci = `${r.branchId}|${r.classTypeId}`;
      if (r.effectiveFrom.getTime() > hari) nanti.push(r);
      else if (!berlaku.has(kunci)) berlaku.set(kunci, r);
    }
    return [
      ...nanti.map((r) => ({ r, nanti: true })),
      ...[...berlaku.values()].map((r) => ({ r, nanti: false })),
    ];
  }, [rows]);

  const [tipe, setTipe] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let batal = false;
    client
      .listClassTypes(undefined, 'ALL')
      .then((xs) => !batal && setTipe(new Map(xs.map((x) => [x.id, x.name]))))
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [client]);
  const namaCabang = (id: string) => branches.find((b) => b.id === id)?.name ?? 'Cabang lain';

  return (
    <section
      aria-labelledby="fee-instruktur-title"
      className="rounded-dd-lg border border-dd-line bg-white p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="fee-instruktur-title" className="m-0 text-lg font-semibold">
            Fee per sesi
          </h2>
          <p className="m-0 mt-1 max-w-[64ch] text-sm text-dd-muted">
            Dibayar untuk tiap kelas yang selesai dan sudah di-scan QR instruktur. Kelas lebih dari
            satu jam dihitung per jam. Hanya terlihat oleh Super Owner.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setForm(true)} disabled={branches.length === 0}>
            Atur fee
          </Button>
        )}
      </div>

      {gagal && (
        <div className="mt-4">
          <Feedback kind="error">{gagal}</Feedback>
        </div>
      )}
      {!rows && !gagal && <Skeleton label="Memuat fee instruktur" />}
      {rows && tampil.length === 0 && (
        <div className="mt-4">
          <Feedback kind="warning">
            Belum ada fee. Sampai diatur, honor memakai fee bawaan Rp 150.000 per jam.
          </Feedback>
        </div>
      )}
      {tampil.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[15px]">
            <caption className="sr-only">Fee per sesi instruktur</caption>
            <thead className="text-sm text-dd-muted">
              <tr className="border-b border-dd-line">
                <th scope="col" className="py-2.5 pr-4 text-left font-medium">
                  Cabang
                </th>
                <th scope="col" className="py-2.5 pr-4 text-left font-medium">
                  Tipe kelas
                </th>
                <th scope="col" className="py-2.5 pr-4 text-right font-medium">
                  Fee per sesi
                </th>
                <th scope="col" className="py-2.5 text-left font-medium">
                  Berlaku
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dd-line/70">
              {tampil.map(({ r, nanti }) => (
                <tr key={r.id}>
                  <td className="py-2.5 pr-4">{namaCabang(r.branchId)}</td>
                  <td className="py-2.5 pr-4">{tipe.get(r.classTypeId) ?? 'Tipe kelas'}</td>
                  <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">
                    {formatRupiah(Number((r.value as { feeRp?: number }).feeRp ?? 0))}
                  </td>
                  <td
                    className={`py-2.5 text-sm ${nanti ? 'font-medium text-dd-warning' : 'text-dd-muted'}`}
                  >
                    {nanti
                      ? `Mulai ${tanggal(r.effectiveFrom)}`
                      : `Sejak ${tanggal(r.effectiveFrom)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <FormFee
          open={form}
          instructorId={instructorId}
          branches={branches}
          client={client}
          onClose={() => setForm(false)}
          onSaved={() => {
            setForm(false);
            muat();
          }}
        />
      )}
    </section>
  );
}

function FormFee({
  open,
  instructorId,
  branches,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  instructorId: string;
  branches: { id: string; name: string }[];
  client: FeeClient;
  onClose(): void;
  onSaved(): void;
}) {
  const [branchId, setBranchId] = useState('');
  const [tipe, setTipe] = useState<{ id: string; name: string }[]>([]);
  const [classTypeId, setClassTypeId] = useState('');
  const [fee, setFee] = useState('');
  const [mulai, setMulai] = useState(hariIni());
  const [alasan, setAlasan] = useState('');
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBranchId(branches[0]?.id ?? '');
    setFee('');
    setMulai(hariIni());
    setAlasan('');
    setGalat('');
  }, [open, branches]);

  useEffect(() => {
    if (!open || !branchId) return;
    let batal = false;
    client
      .listClassTypes(branchId, 'ACTIVE')
      .then((xs) => {
        if (batal) return;
        setTipe(xs.map((x) => ({ id: x.id, name: x.name })));
        setClassTypeId(xs[0]?.id ?? '');
      })
      .catch(() => !batal && setTipe([]));
    return () => {
      batal = true;
    };
  }, [client, open, branchId]);

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    const nominal = Number(fee.replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(nominal) || nominal <= 0) {
      setGalat('Isi fee per sesi dalam rupiah, lebih dari 0.');
      return;
    }
    setSibuk(true);
    setGalat('');
    try {
      await client.createSetting({
        kind: 'INSTRUCTOR_FEE',
        branchId,
        classTypeId,
        instructorUserId: instructorId,
        value: nominal,
        effectiveFrom: mulai,
        reason: alasan.trim() || undefined,
      });
      onSaved();
    } catch (error) {
      setGalat(masterFailureMessage(error));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Atur fee per sesi"
      description="Fee baru berlaku mulai tanggal yang dipilih; fee lama tetap dipakai untuk kelas sebelumnya."
      busy={sibuk}
      onClose={onClose}
    >
      <form className="grid gap-3" onSubmit={(e) => void kirim(e)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput
            label="Cabang"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Tipe kelas"
            required
            value={classTypeId}
            onChange={(e) => setClassTypeId(e.target.value)}
          >
            {tipe.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Fee per sesi (Rp)"
            required
            inputMode="numeric"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="80.000"
          />
          <DateInput
            label="Berlaku mulai"
            required
            value={mulai}
            onChange={(e) => setMulai(e.target.value)}
          />
        </div>
        <TextInput
          label="Catatan (opsional)"
          maxLength={500}
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="Contoh: kenaikan fee Januari"
        />
        {galat && <Feedback kind="error">{galat}</Feedback>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={sibuk} onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={sibuk} disabled={!classTypeId}>
            Simpan fee
          </Button>
        </div>
      </form>
    </Modal>
  );
}
