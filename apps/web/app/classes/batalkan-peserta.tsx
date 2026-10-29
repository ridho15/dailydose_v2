'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  bookingFailure,
  type BookingClient,
  type CustomerBookingRecord,
  type PengajuanPembatalan,
} from '@/api-clients/booking-client';
import { Button } from '../components/actions';
import { Modal, useAppFeedback } from '../components/app-feedback';
import { Textarea } from '../components/forms';
import { useSessionContext } from '../session-context';
import { Feedback, StatusBadge } from '../ui';

export type BatalClient = Pick<
  BookingClient,
  'cancelAsStaff' | 'cancellationOptions' | 'ajukanPembatalanTerlambat' | 'putuskanPembatalan'
>;

type Mode = 'langsung' | 'pengajuan';

const MIN_ALASAN = 10;

/**
 * Tombol X untuk membatalkan booking satu peserta, dengan konfirmasi.
 *
 * Lebih dari H-24: langsung batal, kursi terbuka, sesi member utuh. Kurang dari H-24 (atau booking
 * yang sudah terkunci Hadir sebelum kelas berjalan): menjadi pengajuan yang harus disetujui Manager
 * atau Owner; setelah disetujui, sesi yang sudah terpotong dikembalikan.
 */
export function BatalkanPeserta({
  booking,
  kelasMulai,
  client,
  pengajuan,
  onBerubah,
  tampilan = 'ikon',
}: {
  booking: Pick<CustomerBookingRecord, 'id' | 'status' | 'customer'>;
  kelasMulai: Date;
  client: BatalClient;
  pengajuan?: PengajuanPembatalan;
  onBerubah(): void;
  /** `tombol`: tombol berlabel untuk halaman detail booking; `ikon`: tombol X di daftar peserta. */
  tampilan?: 'ikon' | 'tombol';
}) {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const feedback = useAppFeedback();
  const [mode, setMode] = useState<Mode | null>(null);
  const [alasan, setAlasan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const nama = booking.customer?.displayName ?? 'member';

  const bolehPutus = Boolean(
    session?.capabilities.some(
      (cap) => cap === 'booking:late-cancel:decide' || cap === 'ledger:adjust:decide',
    ),
  );
  const superOwner = Boolean(session?.roles.includes('SUPER_OWNER'));

  if (pengajuan) {
    const milikSendiri = pengajuan.requestedById === session?.id;
    const putuskan = async (keputusan: 'approve' | 'reject') => {
      if (!client.putuskanPembatalan) return;
      const setuju = keputusan === 'approve';
      const yakin = await feedback.confirm({
        tone: setuju ? 'danger' : 'warning',
        title: setuju ? `Setujui pembatalan ${nama}?` : `Tolak pembatalan ${nama}?`,
        message: setuju
          ? `Booking dibatalkan dan kursinya terbuka. ${
              pengajuan.sessionCount > 0
                ? `${pengajuan.sessionCount} sesi dikembalikan ke paket member.`
                : 'Sesi member tetap utuh.'
            } Alasan admin: ${pengajuan.reason}`
          : 'Booking tetap seperti semula.',
        confirmLabel: setuju ? 'Setujui pembatalan' : 'Tolak',
      });
      if (!yakin) return;
      setSibuk(true);
      try {
        await client.putuskanPembatalan(pengajuan.id, keputusan, pengajuan.version);
        onBerubah();
      } catch (error) {
        feedback.showAlert({
          tone: 'danger',
          title: 'Keputusan belum tersimpan',
          message: await bookingFailure(error),
        });
      } finally {
        setSibuk(false);
      }
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="warning">Menunggu persetujuan batal</StatusBadge>
        {bolehPutus && (!milikSendiri || superOwner) && (
          <>
            <Button
              size="sm"
              variant="danger"
              disabled={sibuk}
              onClick={() => void putuskan('approve')}
            >
              Setujui
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={sibuk}
              onClick={() => void putuskan('reject')}
            >
              Tolak
            </Button>
          </>
        )}
      </div>
    );
  }

  const bisaDibatalkan =
    ['BOOKED', 'ATTENDED'].includes(booking.status) && kelasMulai.getTime() > Date.now();
  if (!bisaDibatalkan || !client.cancelAsStaff) return null;

  const buka = async () => {
    setGalat('');
    setAlasan('');
    let langsung = booking.status === 'BOOKED';
    if (langsung && client.cancellationOptions) {
      try {
        langsung = (await client.cancellationOptions(booking.id)).canCancel;
      } catch {
        langsung = false;
      }
    }
    setMode(langsung ? 'langsung' : client.ajukanPembatalanTerlambat ? 'pengajuan' : null);
  };

  const kirim = async () => {
    if (!mode) return;
    setSibuk(true);
    setGalat('');
    try {
      if (mode === 'langsung') {
        await client.cancelAsStaff!(booking.id, alasan.trim(), crypto.randomUUID());
      } else {
        await client.ajukanPembatalanTerlambat!(booking.id, alasan.trim());
      }
      setMode(null);
      feedback.showToast({
        tone: 'success',
        title: mode === 'langsung' ? 'Booking dibatalkan' : 'Pengajuan terkirim',
        message:
          mode === 'langsung'
            ? `${nama} dikeluarkan dari kelas. Sesinya tetap utuh.`
            : 'Menunggu persetujuan Manager atau Owner.',
      });
      onBerubah();
    } catch (error) {
      setGalat(await bookingFailure(error));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <>
      {tampilan === 'tombol' ? (
        <Button
          variant="danger"
          leadingIcon={<X className="size-4" aria-hidden="true" />}
          onClick={() => void buka()}
        >
          Batalkan booking
        </Button>
      ) : (
        <button
          type="button"
          aria-label={`Batalkan booking ${nama}`}
          title="Batalkan booking"
          onClick={() => void buka()}
          className="flex size-11 shrink-0 items-center justify-center rounded-dd-sm border border-dd-border-interactive bg-white text-dd-danger transition hover:border-dd-danger focus-visible:outline-2 focus-visible:outline-dd-forest"
        >
          <X className="size-[18px]" aria-hidden="true" />
        </button>
      )}
      <Modal
        open={mode !== null}
        title={mode === 'langsung' ? `Batalkan booking ${nama}?` : `Ajukan pembatalan ${nama}?`}
        description={
          mode === 'langsung'
            ? 'Kursinya terbuka lagi dan sesi member tetap utuh.'
            : 'Kelas mulai kurang dari 24 jam lagi, jadi pembatalan perlu disetujui Manager atau Owner. Setelah disetujui, sesi yang sudah terpotong dikembalikan ke paket member.'
        }
        busy={sibuk}
        onClose={() => setMode(null)}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={sibuk} onClick={() => setMode(null)}>
              Kembali
            </Button>
            <Button
              variant="danger"
              loading={sibuk}
              disabled={alasan.trim().length < MIN_ALASAN}
              onClick={() => void kirim()}
            >
              {mode === 'langsung' ? 'Batalkan booking' : 'Kirim pengajuan'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <Textarea
            label="Alasan"
            required
            maxLength={200}
            value={alasan}
            onChange={(event) => setAlasan(event.target.value)}
            placeholder="Contoh: member sakit, minta dibatalkan lewat WhatsApp"
            description={`Minimal ${MIN_ALASAN} huruf; tercatat di riwayat booking.`}
            className="min-h-20"
          />
          {galat && <Feedback kind="error">{galat}</Feedback>}
        </div>
      </Modal>
    </>
  );
}
