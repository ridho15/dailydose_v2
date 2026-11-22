'use client';

import { CalendarClock, Check, UserPlus, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bookingFailure,
  browserBookingClient,
  type BookingClient,
  type CustomerRescheduleOptions,
  type KodeAlasanPembatalan,
  type StatusPembatalanSaya,
} from '@/api-clients/booking-client';
import { Button } from '../actions';
import { Modal, useAppFeedback } from '../app-feedback';

export type BookingUntukAksi = {
  id: string;
  classSlotId: string;
  customerPackageId: string | null;
  className: string;
  timezone: string;
  kursiTeman?: boolean;
  bisaTambahTeman?: boolean;
};

type Klien = Pick<
  BookingClient,
  | 'cancellationOptions'
  | 'cancel'
  | 'rescheduleOptions'
  | 'requestReschedule'
  | 'create'
  | 'statusPembatalanSaya'
  | 'ajukanPembatalanSaya'
>;

const ALASAN: Array<{ kode: KodeAlasanPembatalan; label: string }> = [
  { kode: 'SAKIT', label: 'Sakit atau kurang sehat' },
  { kode: 'PEKERJAAN', label: 'Ada pekerjaan mendadak' },
  { kode: 'KELUARGA', label: 'Keperluan keluarga' },
  { kode: 'LAINNYA', label: 'Alasan lain' },
];

const kunci = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `aksi-${Date.now()}`;

function jadwal(value: Date, timeZone: string) {
  const hari = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(value);
  const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(value);
  return { hari, jam };
}

/**
 * Tombol tindakan sebuah booking member: Ganti jadwal, Batalkan (sebelum batas H-12) atau Ajukan
 * pembatalan (setelah batas), dan Kursi teman. Masing-masing paling banyak tiga langkah: tekan
 * tombol, pilih, konfirmasi.
 */
export function AksiBooking({
  booking,
  client = browserBookingClient,
  onBerubah,
}: {
  booking: BookingUntukAksi;
  client?: Klien;
  onBerubah(): void;
}) {
  const feedback = useAppFeedback();
  const [batasLewat, setBatasLewat] = useState<boolean | null>(null);
  const [pengajuan, setPengajuan] = useState<StatusPembatalanSaya | null>(null);
  const [terbuka, setTerbuka] = useState<'pindah' | 'batal' | 'ajukan' | 'teman' | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const muatStatus = useCallback(async () => {
    if (!client.cancellationOptions) return;
    try {
      const opsi = await client.cancellationOptions(booking.id);
      const lewat = !opsi.canCancel && opsi.unavailableReason === 'CANCELLATION_CUTOFF_PASSED';
      setBatasLewat(lewat);
      if (lewat && client.statusPembatalanSaya) setPengajuan(await client.statusPembatalanSaya(booking.id));
    } catch {
      // Tombol tetap tampil; server menolak dengan pesan jelas bila tindakannya tidak berlaku.
      setBatasLewat(false);
    }
  }, [booking.id, client]);

  useEffect(() => {
    void muatStatus();
  }, [muatStatus]);

  const tutup = () => {
    if (sibuk) return;
    setTerbuka(null);
    setGalat('');
  };

  const selesai = (judul: string, pesan: string) => {
    feedback.showToast({ tone: 'success', title: judul, message: pesan });
    setTerbuka(null);
    setGalat('');
    onBerubah();
  };

  const menunggu = pengajuan?.pengajuan?.status === 'PENDING';
  const ditolak = pengajuan?.pengajuan?.status === 'REJECTED';

  return (
    <div className="space-y-3">
      {menunggu && (
        <p className="m-0 rounded-dd-lg border border-dd-warning-line/60 bg-dd-warning-soft p-3 text-base text-dd-ink" role="status">
          Pengajuan pembatalan sudah terkirim. Manager studio akan memutuskan; Anda mendapat notifikasi.
        </p>
      )}
      {ditolak && !menunggu && (
        <p className="m-0 rounded-dd-lg border border-dd-line bg-dd-surface-muted p-3 text-base text-dd-ink" role="status">
          Pengajuan pembatalan sebelumnya ditolak. Booking tetap terjadwal.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {!booking.kursiTeman && (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={<CalendarClock className="size-5" aria-hidden="true" />}
            onClick={() => setTerbuka('pindah')}
            className="text-base"
          >
            Ganti jadwal
          </Button>
        )}
        {batasLewat ? (
          !menunggu && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={<XCircle className="size-5" aria-hidden="true" />}
              onClick={() => setTerbuka('ajukan')}
              className="text-base"
            >
              Ajukan pembatalan
            </Button>
          )
        ) : (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={<XCircle className="size-5" aria-hidden="true" />}
            onClick={() => setTerbuka('batal')}
            disabled={batasLewat === null}
            className="text-base text-dd-danger"
          >
            {booking.kursiTeman ? 'Batalkan kursi teman' : 'Batalkan'}
          </Button>
        )}
        {booking.bisaTambahTeman && (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={<UserPlus className="size-5" aria-hidden="true" />}
            onClick={() => setTerbuka('teman')}
            className="text-base"
          >
            Kursi teman
          </Button>
        )}
      </div>

      <GantiJadwal
        open={terbuka === 'pindah'}
        booking={booking}
        client={client}
        sibuk={sibuk}
        setSibuk={setSibuk}
        galat={galat}
        setGalat={setGalat}
        onTutup={tutup}
        onAjukanPembatalan={() => setTerbuka('ajukan')}
        onSelesai={(hari, jam) => selesai('Jadwal sudah dipindah', `Booking Anda sekarang ${hari} pukul ${jam}.`)}
      />

      <Modal
        open={terbuka === 'batal'}
        title={booking.kursiTeman ? 'Batalkan kursi teman?' : 'Batalkan booking ini?'}
        description={`${booking.className}. Sesi paket kembali utuh karena belum lewat batas 12 jam sebelum kelas.`}
        onClose={tutup}
        busy={sibuk}
        footer={
          <div className="grid w-full gap-2 sm:flex sm:justify-end">
            <Button variant="secondary" size="lg" onClick={tutup} disabled={sibuk}>
              Kembali
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={sibuk}
              loadingLabel="Membatalkan…"
              onClick={async () => {
                if (!client.cancel) return;
                setSibuk(true);
                setGalat('');
                try {
                  await client.cancel(booking.id, 'Dibatalkan member dari Beranda', kunci());
                  selesai('Booking dibatalkan', 'Sesi paket Anda sudah kembali.');
                } catch (cause) {
                  setGalat(await bookingFailure(cause));
                } finally {
                  setSibuk(false);
                }
              }}
            >
              Ya, batalkan
            </Button>
          </div>
        }
      >
        {galat && <PesanGalat teks={galat} />}
      </Modal>

      <AjukanPembatalan
        open={terbuka === 'ajukan'}
        booking={booking}
        client={client}
        sibuk={sibuk}
        setSibuk={setSibuk}
        galat={galat}
        setGalat={setGalat}
        onTutup={tutup}
        onSelesai={() => {
          selesai('Pengajuan terkirim', 'Manager studio akan memutuskan. Booking tetap terjadwal sampai diputus.');
          void muatStatus();
        }}
      />

      <KursiTeman
        open={terbuka === 'teman'}
        booking={booking}
        client={client}
        sibuk={sibuk}
        setSibuk={setSibuk}
        galat={galat}
        setGalat={setGalat}
        onTutup={tutup}
        onSelesai={(nama) => selesai('Kursi teman ditambahkan', `Kursi untuk ${nama} memakai 1 sesi paket Anda.`)}
      />
    </div>
  );
}

function PesanGalat({ teks }: { teks: string }) {
  return (
    <p role="alert" className="m-0 rounded-dd-lg border border-dd-danger/40 bg-dd-danger-soft p-3 text-base text-dd-danger">
      {teks}
    </p>
  );
}

type LangkahProps = {
  open: boolean;
  booking: BookingUntukAksi;
  client: Klien;
  sibuk: boolean;
  setSibuk(value: boolean): void;
  galat: string;
  setGalat(value: string): void;
  onTutup(): void;
};

function GantiJadwal({
  open,
  booking,
  client,
  sibuk,
  setSibuk,
  galat,
  setGalat,
  onTutup,
  onAjukanPembatalan,
  onSelesai,
}: LangkahProps & { onAjukanPembatalan(): void; onSelesai(hari: string, jam: string): void }) {
  const [opsi, setOpsi] = useState<CustomerRescheduleOptions | null>(null);
  const [dipilih, setDipilih] = useState('');
  const [memuat, setMemuat] = useState(false);
  const niat = useRef(kunci());

  useEffect(() => {
    if (!open) return;
    let aktif = true;
    setOpsi(null);
    setDipilih('');
    setMemuat(true);
    niat.current = kunci();
    client
      .rescheduleOptions(booking.id)
      .then((value) => aktif && setOpsi(value))
      .catch(async (cause) => aktif && setGalat(await bookingFailure(cause)))
      .finally(() => aktif && setMemuat(false));
    return () => {
      aktif = false;
    };
  }, [open, booking.id, client, setGalat]);

  const pilihan = (opsi?.targets ?? []).filter((target) => target.eligible !== false).slice(0, 6);
  const lewatBatas = opsi?.unavailableReason === 'RESCHEDULE_CUTOFF_PASSED';
  const target = pilihan.find((item) => item.id === dipilih);

  return (
    <Modal
      open={open}
      title="Ganti jadwal"
      description={`${booking.className}. Pilih jam pengganti di studio yang sama, lalu tekan Pindah.`}
      onClose={onTutup}
      busy={sibuk}
      footer={
        opsi?.canRequest && pilihan.length > 0 ? (
          <Button
            size="lg"
            fullWidth
            disabled={!target}
            loading={sibuk}
            loadingLabel="Memindahkan…"
            className="text-base"
            onClick={async () => {
              if (!target) return;
              setSibuk(true);
              setGalat('');
              try {
                await client.requestReschedule(
                  {
                    bookingId: booking.id,
                    targetClassSlotId: target.id,
                    reasonCode: 'PERSONAL_UNAVAILABLE',
                    expectedBookingVersion: opsi.bookingVersion,
                  },
                  niat.current,
                );
                const waktu = jadwal(target.startAt, target.timezone || booking.timezone);
                onSelesai(waktu.hari, waktu.jam);
              } catch (cause) {
                setGalat(await bookingFailure(cause));
                niat.current = kunci();
              } finally {
                setSibuk(false);
              }
            }}
          >
            {target ? 'Pindah ke jadwal ini' : 'Pilih jadwal dulu'}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {galat && <PesanGalat teks={galat} />}
        {memuat && <p className="m-0 text-base text-dd-muted">Mencari jadwal pengganti…</p>}
        {lewatBatas && (
          <div className="space-y-3">
            <p className="m-0 text-base text-dd-ink">
              Ganti jadwal hanya bisa sampai 12 jam sebelum kelas. Bila Anda tidak bisa hadir, ajukan pembatalan.
            </p>
            <Button variant="secondary" size="lg" fullWidth onClick={onAjukanPembatalan} className="text-base">
              Ajukan pembatalan
            </Button>
          </div>
        )}
        {opsi && !lewatBatas && pilihan.length === 0 && (
          <p className="m-0 text-base text-dd-ink">
            Belum ada jadwal pengganti yang masih ada tempat untuk kelas ini. Coba lagi besok, atau booking kelas lain dari Jadwal.
          </p>
        )}
        {opsi?.canRequest && pilihan.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Jadwal pengganti">
            {pilihan.map((item) => {
              const waktu = jadwal(item.startAt, item.timezone || booking.timezone);
              const aktif = item.id === dipilih;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={aktif}
                    onClick={() => setDipilih(item.id)}
                    className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-dd-lg border-2 px-4 py-3 text-left transition-colors motion-reduce:transition-none ${
                      aktif ? 'border-dd-forest bg-dd-success-soft' : 'border-dd-line bg-white hover:border-dd-forest'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold text-dd-ink">
                        {waktu.hari}, {waktu.jam}
                      </span>
                      <span className="block text-base text-dd-muted">
                        {[item.instructor?.displayName, `${item.availableCapacity} tempat tersisa`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {aktif && <Check className="size-6 shrink-0 text-dd-forest" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function AjukanPembatalan({ open, booking, client, sibuk, setSibuk, galat, setGalat, onTutup, onSelesai }: LangkahProps & { onSelesai(): void }) {
  const [kode, setKode] = useState<KodeAlasanPembatalan | null>(null);
  const [lainnya, setLainnya] = useState('');

  useEffect(() => {
    if (open) {
      setKode(null);
      setLainnya('');
    }
  }, [open]);

  const siap = kode !== null && (kode !== 'LAINNYA' || lainnya.trim().length >= 3);

  return (
    <Modal
      open={open}
      title="Ajukan pembatalan"
      description={`${booking.className}. Sudah kurang dari 12 jam sebelum kelas, jadi Manager studio yang memutuskan. Bila disetujui, sesi Anda kembali.`}
      onClose={onTutup}
      busy={sibuk}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={!siap}
          loading={sibuk}
          loadingLabel="Mengirim…"
          className="text-base"
          onClick={async () => {
            if (!kode || !client.ajukanPembatalanSaya) return;
            setSibuk(true);
            setGalat('');
            try {
              await client.ajukanPembatalanSaya(booking.id, kode, kode === 'LAINNYA' ? lainnya.trim() : undefined);
              onSelesai();
            } catch (cause) {
              setGalat(await bookingFailure(cause));
            } finally {
              setSibuk(false);
            }
          }}
        >
          Kirim pengajuan
        </Button>
      }
    >
      <div className="space-y-3">
        {galat && <PesanGalat teks={galat} />}
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 text-base font-semibold text-dd-ink">Alasan</legend>
          {ALASAN.map((item) => (
            <button
              key={item.kode}
              type="button"
              aria-pressed={kode === item.kode}
              onClick={() => setKode(item.kode)}
              className={`min-h-14 rounded-dd-lg border-2 px-4 text-left text-base font-semibold transition-colors motion-reduce:transition-none ${
                kode === item.kode ? 'border-dd-forest bg-dd-success-soft text-dd-forest' : 'border-dd-line bg-white text-dd-ink hover:border-dd-forest'
              }`}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        {kode === 'LAINNYA' && (
          <label className="grid gap-1.5 text-base font-semibold text-dd-ink">
            Tulis alasannya
            <textarea
              value={lainnya}
              onChange={(event) => setLainnya(event.target.value)}
              maxLength={200}
              rows={3}
              className="min-h-24 rounded-dd-lg border border-dd-border-interactive bg-white p-3 text-base font-normal text-dd-ink"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

function KursiTeman({ open, booking, client, sibuk, setSibuk, galat, setGalat, onTutup, onSelesai }: LangkahProps & { onSelesai(nama: string): void }) {
  const [nama, setNama] = useState('');
  const niat = useRef(kunci());

  useEffect(() => {
    if (open) {
      setNama('');
      niat.current = kunci();
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title="Tambah kursi teman"
      description={`${booking.className}. Teman tidak perlu punya akun. Kursinya memakai 1 sesi paket Anda.`}
      onClose={onTutup}
      busy={sibuk}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={nama.trim().length < 2 || !booking.customerPackageId}
          loading={sibuk}
          loadingLabel="Menambahkan…"
          className="text-base"
          onClick={async () => {
            if (!booking.customerPackageId) return;
            setSibuk(true);
            setGalat('');
            try {
              await client.create(
                {
                  classSlotId: booking.classSlotId,
                  customerPackageId: booking.customerPackageId,
                  source: 'SELF',
                  namaTeman: nama.trim(),
                },
                niat.current,
              );
              onSelesai(nama.trim());
            } catch (cause) {
              setGalat(await bookingFailure(cause));
              niat.current = kunci();
            } finally {
              setSibuk(false);
            }
          }}
        >
          Tambah kursi teman
        </Button>
      }
    >
      <div className="space-y-3">
        {galat && <PesanGalat teks={galat} />}
        <label className="grid gap-1.5 text-base font-semibold text-dd-ink">
          Nama teman
          <input
            value={nama}
            onChange={(event) => setNama(event.target.value)}
            maxLength={128}
            autoComplete="off"
            className="min-h-12 rounded-dd-lg border border-dd-border-interactive bg-white px-4 text-base font-normal text-dd-ink"
          />
        </label>
      </div>
    </Modal>
  );
}
