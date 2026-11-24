'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { bookingFailure } from '@/api-clients/booking-client';
import { Button } from '../components/actions';
import { Modal, useAppFeedback } from '../components/app-feedback';
import { Textarea } from '../components/forms';
import { masalahBukti, PilihBukti } from '../components/pilih-bukti';
import { Feedback, Skeleton } from '../ui';

export interface SlotHariSama {
  id: string;
  className: string;
  branchName: string | null;
  startAt: string;
  endAt: string;
  terisi: number;
  capacity: number;
  memberSudahBooking: boolean;
  bisaDipilih: boolean;
}

export interface PindahJamClient {
  pilihan(bookingId: string): Promise<{ items: SlotHariSama[] }>;
  pindah(bookingId: string, input: { targetClassSlotId: string; reason: string; bukti: File }): Promise<{ cara: 'PINDAH' | 'BATAL_SLOT_LAMA' }>;
}

export const browserPindahJamClient: PindahJamClient = {
  pilihan: (bookingId) =>
    apiFetch(`/bookings/${encodeURIComponent(bookingId)}/same-day-slots`, { label: 'Memuat jadwal hari ini…' }),
  pindah: (bookingId, input) => {
    const form = new FormData();
    form.set('targetClassSlotId', input.targetClassSlotId);
    form.set('reason', input.reason);
    form.set('evidence', input.bukti);
    return apiFetch(`/bookings/${encodeURIComponent(bookingId)}/move-same-day`, {
      method: 'POST',
      body: form,
      label: 'Memindahkan jadwal…',
    });
  },
};

const MIN_ALASAN = 10;
const jam = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(iso));

/**
 * Tombol "Pindah jam" untuk staf: member pindah ke kelas lain di hari yang sama tanpa sesi lama
 * hangus. Bila member sudah booking jam baru sendiri, booking lama dibatalkan; bila belum, booking
 * dipindah. Bukti (mis. chat member) wajib karena ini perubahan kurang dari 12 jam oleh admin.
 */
export function PindahJam({
  bookingId,
  nama,
  client = browserPindahJamClient,
  onBerubah,
}: {
  bookingId: string;
  nama: string;
  client?: PindahJamClient;
  onBerubah(): void;
}) {
  const feedback = useAppFeedback();
  const [buka, setBuka] = useState(false);
  const [slots, setSlots] = useState<SlotHariSama[] | null>(null);
  const [tujuan, setTujuan] = useState('');
  const [alasan, setAlasan] = useState('');
  const [bukti, setBukti] = useState<File | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');

  const mulai = async () => {
    setBuka(true);
    setSlots(null);
    setTujuan('');
    setAlasan('');
    setBukti(null);
    setGalat('');
    try {
      setSlots((await client.pilihan(bookingId)).items);
    } catch (error) {
      setGalat(await bookingFailure(error));
      setSlots([]);
    }
  };

  const dipilih = slots?.find((s) => s.id === tujuan);
  const siap = Boolean(dipilih) && alasan.trim().length >= MIN_ALASAN && Boolean(bukti) && masalahBukti(bukti) === null;

  const kirim = async () => {
    if (!dipilih || !bukti) return;
    setSibuk(true);
    setGalat('');
    try {
      const hasil = await client.pindah(bookingId, { targetClassSlotId: dipilih.id, reason: alasan.trim(), bukti });
      setBuka(false);
      feedback.showToast({
        tone: 'success',
        title: 'Jadwal dipindah',
        message:
          hasil.cara === 'BATAL_SLOT_LAMA'
            ? `${nama} sudah terdaftar di jam ${jam(dipilih.startAt)}. Booking lama dibatalkan, sesinya utuh.`
            : `${nama} pindah ke jam ${jam(dipilih.startAt)}. Sesi tidak dipotong untuk jam lama.`,
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
      <Button variant="secondary" onClick={() => void mulai()}>
        Pindah jam
      </Button>
      <Modal
        open={buka}
        title={`Pindah jam ${nama}`}
        description="Pilih kelas lain di hari yang sama. Sesi untuk jam lama tidak hangus."
        busy={sibuk}
        onClose={() => setBuka(false)}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={sibuk} onClick={() => setBuka(false)}>
              Kembali
            </Button>
            <Button disabled={!siap} loading={sibuk} onClick={() => void kirim()}>
              Pindahkan
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          {slots === null && <Skeleton label="Memuat jadwal hari ini" />}
          {slots?.length === 0 && !galat && (
            <p className="m-0 text-[15px] text-dd-muted">Tidak ada kelas lain hari ini yang bisa dipakai paket member ini.</p>
          )}
          {slots && slots.length > 0 && (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-[15px] font-semibold text-dd-ink">Kelas tujuan</legend>
              {slots.map((s) => (
                <label
                  key={s.id}
                  className={`flex min-h-11 items-center gap-3 rounded-dd-sm border px-3 py-2 text-[15px] ${
                    s.bisaDipilih ? 'cursor-pointer border-dd-line' : 'cursor-not-allowed border-dd-line opacity-60'
                  } ${tujuan === s.id ? 'border-dd-forest bg-dd-success-soft' : ''}`}
                >
                  <input
                    type="radio"
                    name="tujuan"
                    value={s.id}
                    disabled={!s.bisaDipilih}
                    checked={tujuan === s.id}
                    onChange={() => setTujuan(s.id)}
                  />
                  <span className="flex-1">
                    {jam(s.startAt)} · {s.className}
                    {s.branchName ? ` · ${s.branchName}` : ''}
                  </span>
                  <span className="text-sm text-dd-muted">
                    {s.memberSudahBooking ? 'sudah dibooking member' : s.bisaDipilih ? `${s.terisi}/${s.capacity}` : 'penuh'}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <Textarea
            label="Alasan"
            required
            maxLength={200}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="Contoh: member minta pindah ke jam 12 lewat WhatsApp"
            description={`Minimal ${MIN_ALASAN} huruf; tercatat di riwayat ganti jadwal.`}
            className="min-h-20"
          />
          <PilihBukti wajib berkas={bukti} onChange={setBukti} petunjuk="Tangkapan layar chat member yang meminta pindah" />
          {galat && <Feedback kind="error">{galat}</Feedback>}
        </div>
      </Modal>
    </>
  );
}
