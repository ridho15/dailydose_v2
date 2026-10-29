'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Download } from 'lucide-react';
import {
  keuanganFailure,
  type BarisTransfer,
  type KeuanganClient,
  type RingkasanTransfer,
} from '@/api-clients/keuangan-client';
import { Button } from '../../components/actions';
import { Modal } from '../../components/app-feedback';
import { SelectInput, TextInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';

const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`;

/** Bank tujuan yang umum beserta kode SWIFT-nya; selain BCA dikirim lewat LLG. */
export const BANK_TUJUAN = [
  { nama: 'BCA', swift: 'CENAIDJA' },
  { nama: 'Mandiri', swift: 'BMRIIDJA' },
  { nama: 'BNI', swift: 'BNINIDJA' },
  { nama: 'BRI', swift: 'BRINIDJA' },
  { nama: 'CIMB Niaga', swift: 'BNIAIDJA' },
  { nama: 'Permata', swift: 'BBBAIDJA' },
  { nama: 'Danamon', swift: 'BDINIDJA' },
  { nama: 'BSI', swift: 'BSMDIDJA' },
  { nama: 'BTN', swift: 'BTANIDJA' },
  { nama: 'OCBC', swift: 'NISPIDJA' },
  { nama: 'Maybank', swift: 'IBBKIDJA' },
  { nama: 'Panin', swift: 'PINBIDJA' },
] as const;
const LAINNYA = 'LAINNYA';

const tanggal = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

function simpanBerkas(nama: string, base64: string) {
  const biner = atob(base64);
  const bytes = new Uint8Array(biner.length);
  for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = nama;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ClientTransfer = Required<
  Pick<KeuanganClient, 'transferHonor' | 'unduhTransferHonor' | 'simpanRekeningInstruktur'>
>;

/**
 * Honor instruktur yang akan ditransfer, dari tanggal 1 sampai hari ini (pada tanggal 1: bulan
 * lalu penuh), dan unduhan berkas Excel Multi Payroll untuk KlikBCA Bisnis.
 */
export function TransferHonorSection({ client }: { client: ClientTransfer }) {
  const [data, setData] = useState<RingkasanTransfer | null>(null);
  const [gagal, setGagal] = useState('');
  const [unduh, setUnduh] = useState<{ kind: 'status' | 'error'; text: string } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [ubah, setUbah] = useState<BarisTransfer | null>(null);

  const muat = useCallback(() => {
    let batal = false;
    setGagal('');
    client
      .transferHonor()
      .then((hasil) => !batal && setData(hasil))
      .catch((error) => {
        if (batal) return;
        setData(null);
        setGagal(keuanganFailure(error, 'Honor instruktur belum dapat dihitung. Coba muat ulang.'));
      });
    return () => {
      batal = true;
    };
  }, [client]);

  useEffect(() => muat(), [muat]);

  const unduhBerkas = async () => {
    setSibuk(true);
    setUnduh(null);
    try {
      const berkas = await client.unduhTransferHonor();
      simpanBerkas(berkas.fileName, berkas.base64);
      setUnduh({
        kind: 'status',
        text: `${berkas.fileName} terunduh: ${berkas.jumlahBaris} instruktur, ${rp(berkas.totalRp)}.`,
      });
    } catch (error) {
      setUnduh({ kind: 'error', text: keuanganFailure(error, 'Berkas belum dapat dibuat.') });
    } finally {
      setSibuk(false);
    }
  };

  const tampil =
    data?.baris.filter((b) => b.totalRp !== 0 || b.belumTerverifikasiRp > 0 || !b.rekening) ?? [];

  return (
    <section aria-labelledby="transfer-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="transfer-title" className="m-0 text-xl font-semibold">
            Transfer honor instruktur
          </h2>
          <p className="m-0 mt-0.5 max-w-[68ch] text-[15px] text-dd-muted">
            {data ? `${tanggal(data.from)} sampai ${tanggal(data.until)}. ` : ''}
            Dihitung dari tanggal 1 sampai hari ini; pada tanggal 1, bulan lalu penuh. Yang dibayar:
            kelas dengan presensi instruktur ditambah koreksi jam.
          </p>
        </div>
        <Button
          leadingIcon={<Download className="size-4" aria-hidden="true" />}
          loading={sibuk}
          disabled={!data || data.jumlahSiap === 0}
          onClick={() => void unduhBerkas()}
        >
          Unduh Excel KlikBCA
        </Button>
      </div>

      {gagal && <Feedback kind="error">{gagal}</Feedback>}
      {unduh && <Feedback kind={unduh.kind}>{unduh.text}</Feedback>}
      {!data && !gagal && <Skeleton label="Menghitung honor instruktur" />}

      {data && (
        <div className="grid gap-4">
          <div className="rounded-dd-lg border border-dd-line bg-white p-5">
            <p className="m-0 text-sm font-medium text-dd-muted">Masuk berkas</p>
            <p className="m-0 mt-1 text-[26px] font-semibold tabular-nums text-dd-forest">
              {rp(data.siapRp)}
            </p>
            <p className="m-0 mt-0.5 text-sm text-dd-muted">{data.jumlahSiap} instruktur</p>
          </div>

          {data.tanpaRekening > 0 && (
            <Feedback kind="warning">
              {data.tanpaRekening} instruktur berhonor belum punya rekening dan tidak masuk berkas.
              Tekan Isi rekening.
            </Feedback>
          )}
          {data.kelasBelumTerverifikasi > 0 && (
            <Feedback kind="warning">
              {data.kelasBelumTerverifikasi} kelas selesai belum ada presensi instruktur, jadi
              honornya belum dibayar. Verifikasi presensi atau catat koreksi jam dulu bila perlu.
            </Feedback>
          )}

          {tampil.length === 0 ? (
            <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-5 text-[15px] text-dd-muted">
              Belum ada honor instruktur pada periode ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-dd-lg border border-dd-line bg-white px-5">
              <table className="w-full min-w-[640px] text-[15px]">
                <caption className="sr-only">Honor instruktur yang akan ditransfer</caption>
                <thead className="text-sm text-dd-muted">
                  <tr className="border-b border-dd-line">
                    <th scope="col" className="py-3 pr-4 text-left font-medium">
                      Instruktur
                    </th>
                    <th scope="col" className="py-3 pr-4 text-right font-medium">
                      Ditransfer
                    </th>
                    <th scope="col" className="py-3 pr-4 text-left font-medium">
                      Rekening
                    </th>
                    <th scope="col" className="py-3 text-right font-medium">
                      <span className="sr-only">Aksi</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dd-line/70">
                  {tampil.map((b) => (
                    <tr key={b.instructorId} className="align-top">
                      <th scope="row" className="py-3 pr-4 text-left font-semibold">
                        {b.nama}
                        <span className="block text-sm font-normal text-dd-muted">
                          {b.kelasTerverifikasi} kelas
                          {b.koreksiRp !== 0 ? ` · koreksi ${rp(b.koreksiRp)}` : ''}
                        </span>
                        {b.kelasBelumTerverifikasi > 0 && (
                          <span className="block text-sm font-medium text-dd-warning">
                            {b.kelasBelumTerverifikasi} kelas belum terverifikasi (
                            {rp(b.belumTerverifikasiRp)})
                          </span>
                        )}
                      </th>
                      <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums">
                        {rp(b.totalRp)}
                      </td>
                      <td className="py-3 pr-4">
                        {b.rekening ? (
                          <>
                            <span className="block">
                              {b.rekening.bankName} {b.rekening.accountNumber}
                            </span>
                            <span className="block text-sm text-dd-muted">
                              a.n. {b.rekening.accountName}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm font-medium text-dd-warning">Belum ada</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => setUbah(b)}>
                          {b.rekening ? 'Ubah' : 'Isi rekening'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="rounded-dd-lg border border-dd-line bg-white p-5 text-[15px]">
            <summary className="cursor-pointer font-semibold">
              Cara upload ke KlikBCA Bisnis
            </summary>
            <ol className="m-0 mt-3 grid gap-1.5 pl-5 text-dd-muted">
              <li>
                Buka Converter Multi Transaksi, pilih Multi Payroll, Input File berkas Excel ini,
                Sheet Name <strong className="text-dd-ink">Data</strong>, centang Has Column
                Headers, lalu Export ke .txt.
              </li>
              <li>Buka Aplikasi Checksum, pilih berkas .txt tadi, Type Payroll.</li>
              <li>
                Di KlikBCA Bisnis: Multi Transaksi, File Upload, Multi Payroll. Unggah berkas .txt
                dan berkas checksum, lalu otorisasi.
              </li>
            </ol>
          </details>
        </div>
      )}

      <FormRekening
        baris={ubah}
        client={client}
        onClose={() => setUbah(null)}
        onSaved={() => {
          setUbah(null);
          muat();
        }}
      />
    </section>
  );
}

function FormRekening({
  baris,
  client,
  onClose,
  onSaved,
}: {
  baris: BarisTransfer | null;
  client: ClientTransfer;
  onClose(): void;
  onSaved(): void;
}) {
  const [bank, setBank] = useState('');
  const [bankLain, setBankLain] = useState('');
  const [swiftLain, setSwiftLain] = useState('');
  const [nomor, setNomor] = useState('');
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [galat, setGalat] = useState('');
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    if (!baris) return;
    const r = baris.rekening;
    const dikenal = BANK_TUJUAN.find((b) => b.swift === r?.swiftCode);
    setBank(r ? (dikenal?.swift ?? LAINNYA) : BANK_TUJUAN[0].swift);
    setBankLain(r && !dikenal ? r.bankName : '');
    setSwiftLain(r && !dikenal ? r.swiftCode : '');
    setNomor(r?.accountNumber ?? '');
    setNama(r?.accountName ?? baris.nama);
    setEmail(r?.email ?? '');
    setGalat('');
  }, [baris]);

  const kirim = async (event: FormEvent) => {
    event.preventDefault();
    if (!baris) return;
    const dikenal = BANK_TUJUAN.find((b) => b.swift === bank);
    setSibuk(true);
    setGalat('');
    try {
      await client.simpanRekeningInstruktur(baris.instructorId, {
        bankName: dikenal ? dikenal.nama : bankLain,
        swiftCode: dikenal ? dikenal.swift : swiftLain,
        accountNumber: nomor,
        accountName: nama,
        email: email || undefined,
      });
      onSaved();
    } catch (error) {
      setGalat(keuanganFailure(error, 'Rekening belum tersimpan. Periksa isiannya.'));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Modal
      open={baris !== null}
      title={`Rekening ${baris?.nama ?? ''}`}
      description="Rekening tujuan transfer honor. Sesama BCA langsung; bank lain lewat LLG."
      busy={sibuk}
      onClose={onClose}
    >
      <form className="grid gap-3" onSubmit={(e) => void kirim(e)}>
        <SelectInput label="Bank" required value={bank} onChange={(e) => setBank(e.target.value)}>
          {BANK_TUJUAN.map((b) => (
            <option key={b.swift} value={b.swift}>
              {b.nama}
            </option>
          ))}
          <option value={LAINNYA}>Bank lain</option>
        </SelectInput>
        {bank === LAINNYA && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Nama bank"
              required
              maxLength={64}
              value={bankLain}
              onChange={(e) => setBankLain(e.target.value)}
            />
            <TextInput
              label="Kode SWIFT"
              required
              maxLength={11}
              value={swiftLain}
              onChange={(e) => setSwiftLain(e.target.value.toUpperCase())}
              description="8 atau 11 karakter, dari bank penerima."
            />
          </div>
        )}
        <TextInput
          label="Nomor rekening"
          required
          inputMode="numeric"
          maxLength={40}
          value={nomor}
          onChange={(e) => setNomor(e.target.value)}
          description={bank === BANK_TUJUAN[0].swift ? 'BCA: 10 digit.' : undefined}
        />
        <TextInput
          label="Atas nama"
          required
          maxLength={70}
          value={nama}
          onChange={(e) => setNama(e.target.value)}
        />
        <TextInput
          label="Email notifikasi (opsional)"
          type="email"
          maxLength={191}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          description="BCA mengirim bukti transfer berhasil ke alamat ini."
        />
        {galat && <Feedback kind="error">{galat}</Feedback>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={sibuk} onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={sibuk}>
            Simpan rekening
          </Button>
        </div>
      </form>
    </Modal>
  );
}
