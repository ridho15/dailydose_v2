'use client';

import { useState } from 'react';
import {
  bookingFailure,
  type BookingClient,
  type CustomerBookingRecord,
} from '@/api-clients/booking-client';
import { Button } from '../components/actions';
import { Modal } from '../components/app-feedback';
import { SelectInput, Textarea } from '../components/forms';
import { Feedback } from '../ui';

type Status = 'BOOKED' | 'ATTENDED' | 'NO_SHOW';
const LABEL: Record<Status, string> = { BOOKED: 'Aktif', ATTENDED: 'Hadir', NO_SHOW: 'Tidak hadir' };
const MIN_ALASAN = 3;

/** Koreksi salah catat Hadir/Tidak hadir. Hanya Super Owner; ditolak server bila sesi sudah dipotong. */
export function KoreksiStatusBooking({
  booking,
  client,
  onBerubah,
}: {
  booking: Pick<CustomerBookingRecord, 'id' | 'status' | 'customer'>;
  client: Pick<BookingClient, 'koreksiStatus'>;
  onBerubah(): void;
}) {
  const pilihan = (Object.keys(LABEL) as Status[]).filter((s) => s !== booking.status);
  const [terbuka, setTerbuka] = useState(false);
  const [tujuan, setTujuan] = useState<Status>(pilihan[0]!);
  const [alasan, setAlasan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const nama = booking.customer?.displayName ?? 'member';
  if (!client.koreksiStatus || !(booking.status in LABEL)) return null;

  const kirim = async () => {
    setSibuk(true);
    setGalat('');
    try {
      await client.koreksiStatus!(booking.id, tujuan, alasan.trim(), crypto.randomUUID());
      setTerbuka(false);
      setAlasan('');
      onBerubah();
    } catch (error) {
      setGalat(await bookingFailure(error));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setTerbuka(true)}>
        Koreksi status
      </Button>
      <Modal
        open={terbuka}
        title={`Koreksi status ${nama}`}
        description="Hanya untuk salah catat. Kursi tidak berubah dan perubahan tercatat di audit. Ditolak bila sesi paket sudah dipotong."
        busy={sibuk}
        onClose={() => setTerbuka(false)}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={sibuk} onClick={() => setTerbuka(false)}>
              Kembali
            </Button>
            <Button loading={sibuk} disabled={alasan.trim().length < MIN_ALASAN} onClick={() => void kirim()}>
              Simpan koreksi
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <SelectInput label="Status baru" value={tujuan} onChange={(e) => setTujuan(e.target.value as Status)}>
            {pilihan.map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </SelectInput>
          <Textarea
            label="Alasan"
            required
            maxLength={200}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            description={`Minimal ${MIN_ALASAN} huruf.`}
            className="min-h-20"
          />
          {galat && <Feedback kind="error">{galat}</Feedback>}
        </div>
      </Modal>
    </>
  );
}
