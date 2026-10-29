'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  browserKeuanganClient,
  keuanganFailure,
  type KeuanganClient,
  type TarifModalSesi,
} from '@/api-clients/keuangan-client';
import { Button } from '../components/actions';
import { Modal, useAppFeedback } from '../components/app-feedback';
import { DateInput, SelectInput, TextInput } from '../components/forms';
import { formatRupiah } from '../lib/formatters';
import { Feedback, Skeleton } from '../ui';

type ModalClient = Required<
  Pick<KeuanganClient, 'daftarModalSesi' | 'simpanModalSesi' | 'hapusModalSesi'>
>;
const SEMUA = '';

const hariIni = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const tanggal = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/**
 * Modal per sesi untuk menghitung laba: sesi paket yang dibeli member x modal per sesi tipe
 * kelasnya di cabang itu. Contoh: paket Group 20 sesi Rp4.000.000 di Untar, modal Group Untar
 * Rp50.000, berarti modal Rp1.000.000 dan laba Rp3.000.000 (sebelum pengeluaran). Berbeda dari
 * fee instruktur, yang dibayar per kelas yang di-scan QR.
 */
export function ModalSesiSection({
  branches,
  classTypes,
  canEdit,
  client = browserKeuanganClient as ModalClient,
}: {
  branches: { id: string; name: string }[];
  classTypes: { id: string; name: string }[];
  canEdit: boolean;
  client?: ModalClient;
}) {
  const feedback = useAppFeedback();
  const [rows, setRows] = useState<TarifModalSesi[] | null>(null);
  const [gagal, setGagal] = useState('');
  const [form, setForm] = useState(false);

  const muat = useCallback(() => {
    let batal = false;
    setGagal('');
    client
      .daftarModalSesi()
      .then((xs) => !batal && setRows(xs))
      .catch((e) => !batal && setGagal(keuanganFailure(e, 'Modal per sesi belum dapat dimuat.')));
    return () => {
      batal = true;
    };
  }, [client]);
  useEffect(() => muat(), [muat]);

  const namaCabang = (id: string) => branches.find((b) => b.id === id)?.name ?? 'Cabang';
  const namaTipe = (id: string | null) =>
    id ? (classTypes.find((t) => t.id === id)?.name ?? 'Tipe kelas') : 'Semua tipe kelas';

  // Per cabang + tipe kelas: tarif yang berlaku hari ini dan yang dijadwalkan.
  const tampil = useMemo(() => {
    if (!rows) return [];
    const hari = hariIni();
    const berlaku = new Map<string, TarifModalSesi>();
    const nanti: TarifModalSesi[] = [];
    for (const r of rows) {
      const kunci = `${r.branchId}|${r.classTypeId ?? ''}`;
      if (r.effectiveDate > hari) nanti.push(r);
      else if (!berlaku.has(kunci)) berlaku.set(kunci, r);
    }
    return [
      ...nanti.map((r) => ({ r, nanti: true })),
      ...[...berlaku.values()].map((r) => ({ r, nanti: false })),
    ].sort(
      (a, b) =>
        namaCabang(a.r.branchId).localeCompare(namaCabang(b.r.branchId), 'id') ||
        namaTipe(a.r.classTypeId).localeCompare(namaTipe(b.r.classTypeId), 'id'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branches, classTypes]);

  const hapus = async (r: TarifModalSesi) => {
    const yakin = await feedback.confirm({
      tone: 'danger',
      title: 'Hapus modal per sesi ini?',
      message: `${namaCabang(r.branchId)}, ${namaTipe(r.classTypeId)}: ${formatRupiah(r.modalPerSesiRp)} mulai ${tanggal(r.effectiveDate)}. Laba bulan terkait dihitung ulang memakai tarif sebelumnya.`,
      confirmLabel: 'Hapus',
    });
    if (!yakin) return;
    try {
      await client.hapusModalSesi(r.id);
      muat();
    } catch (e) {
      feedback.showAlert({
        tone: 'danger',
        title: 'Belum terhapus',
        message: keuanganFailure(e, 'Modal per sesi belum dapat dihapus.'),
      });
    }
  };

  return (
    <section aria-labelledby="modal-sesi-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="modal-sesi-title" className="m-0 text-xl font-semibold">
            Modal per sesi
          </h2>
          <p className="m-0 mt-1 max-w-[70ch] text-[15px] text-dd-muted">
            Dipakai untuk laba bulanan: sesi paket yang dibeli member dikali modal per sesi tipe
            kelasnya di cabang itu. Contoh: paket Group 20 sesi Rp4.000.000, modal Rp50.000 per
            sesi, maka modal Rp1.000.000 dan laba Rp3.000.000. Fee instruktur (yang dibayar per
            kelas ter-scan QR) diatur terpisah di detail instruktur.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setForm(true)} disabled={branches.length === 0}>
            Atur modal
          </Button>
        )}
      </div>

      {gagal && <Feedback kind="error">{gagal}</Feedback>}
      {!rows && !gagal && <Skeleton label="Memuat modal per sesi" />}
      {rows && tampil.length === 0 && (
        <Feedback kind="warning">
          Belum ada modal per sesi. Sampai diatur, modal dihitung Rp0 dan laba terlihat sama dengan
          omzet dikurangi pengeluaran.
        </Feedback>
      )}
      {tampil.length > 0 && (
        <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
          <table className="w-full min-w-[560px] text-[15px]">
            <caption className="sr-only">Modal per sesi per cabang dan tipe kelas</caption>
            <thead className="text-sm text-dd-muted">
              <tr className="border-b border-dd-line">
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Cabang
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Tipe kelas
                </th>
                <th scope="col" className="py-3 pr-4 text-right font-medium">
                  Modal per sesi
                </th>
                <th scope="col" className="py-3 pr-4 text-left font-medium">
                  Berlaku
                </th>
                {canEdit && (
                  <th scope="col" className="py-3 text-right font-medium">
                    <span className="sr-only">Aksi</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-dd-line/70">
              {tampil.map(({ r, nanti }) => (
                <tr key={r.id}>
                  <td className="py-3 pr-4">{namaCabang(r.branchId)}</td>
                  <td className="py-3 pr-4">{namaTipe(r.classTypeId)}</td>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                    {formatRupiah(r.modalPerSesiRp)}
                  </td>
                  <td
                    className={`py-3 pr-4 text-sm ${nanti ? 'font-medium text-dd-warning' : 'text-dd-muted'}`}
                  >
                    {nanti
                      ? `Mulai ${tanggal(r.effectiveDate)}`
                      : `Sejak ${tanggal(r.effectiveDate)}`}
                  </td>
                  {canEdit && (
                    <td className="py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => void hapus(r)}>
                        Hapus
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <FormModal
          open={form}
          branches={branches}
          classTypes={classTypes}
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

function FormModal({
  open,
  branches,
  classTypes,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  branches: { id: string; name: string }[];
  classTypes: { id: string; name: string }[];
  client: ModalClient;
  onClose(): void;
  onSaved(): void;
}) {
  const [branchId, setBranchId] = useState('');
  const [classTypeId, setClassTypeId] = useState(SEMUA);
  const [nominal, setNominal] = useState('');
  const [mulai, setMulai] = useState(hariIni());
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBranchId(branches[0]?.id ?? '');
    setClassTypeId(classTypes[0]?.id ?? SEMUA);
    setNominal('');
    setMulai(hariIni());
    setGalat('');
  }, [open, branches, classTypes]);

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    const angka = Number(nominal.replace(/[^\d]/g, ''));
    if (!nominal.trim() || !Number.isSafeInteger(angka)) {
      setGalat('Isi modal per sesi dalam rupiah.');
      return;
    }
    setSibuk(true);
    setGalat('');
    try {
      await client.simpanModalSesi({
        branchId,
        classTypeId: classTypeId || null,
        modalPerSesiRp: angka,
        effectiveDate: mulai,
      });
      onSaved();
    } catch (e) {
      setGalat(keuanganFailure(e, 'Modal per sesi belum tersimpan. Periksa isiannya.'));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Atur modal per sesi"
      description="Berlaku untuk paket yang lunas mulai tanggal yang dipilih; paket sebelumnya tetap memakai modal lama."
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
            value={classTypeId}
            onChange={(e) => setClassTypeId(e.target.value)}
          >
            {classTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={SEMUA}>Semua tipe kelas (paket umum)</option>
          </SelectInput>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Modal per sesi (Rp)"
            required
            inputMode="numeric"
            value={nominal}
            onChange={(e) => setNominal(e.target.value)}
            placeholder="50.000"
          />
          <DateInput
            label="Berlaku mulai"
            required
            value={mulai}
            onChange={(e) => setMulai(e.target.value)}
          />
        </div>
        {galat && <Feedback kind="error">{galat}</Feedback>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={sibuk} onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={sibuk} disabled={!branchId}>
            Simpan modal
          </Button>
        </div>
      </form>
    </Modal>
  );
}
