'use client';

import { useState } from 'react';
import { Button } from '../components/actions';
import { Modal } from '../components/app-feedback';
import { Textarea } from '../components/forms';

const MIN_ALASAN = 3;

/** Hapus presensi instruktur yang salah catat. Hanya dirender untuk Super Owner; server menolak peran lain. */
export function HapusPresensiInstruktur({
  onHapus,
  size = 'sm',
}: {
  onHapus(alasan: string): Promise<boolean>;
  size?: 'sm' | 'md';
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const kirim = async () => {
    setSibuk(true);
    const berhasil = await onHapus(alasan.trim());
    setSibuk(false);
    if (berhasil) {
      setTerbuka(false);
      setAlasan('');
    }
  };

  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setTerbuka(true)}>
        Hapus presensi
      </Button>
      <Modal
        open={terbuka}
        title="Hapus presensi instruktur?"
        description="Untuk presensi yang salah catat. Honor kelas ini kembali 'belum terverifikasi' sampai presensi dicatat ulang. Tercatat di audit atas nama Anda."
        busy={sibuk}
        onClose={() => setTerbuka(false)}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={sibuk} onClick={() => setTerbuka(false)}>
              Kembali
            </Button>
            <Button
              variant="danger"
              loading={sibuk}
              disabled={alasan.trim().length < MIN_ALASAN}
              onClick={() => void kirim()}
            >
              Hapus presensi
            </Button>
          </div>
        }
      >
        <Textarea
          label="Alasan"
          required
          maxLength={200}
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          description={`Minimal ${MIN_ALASAN} huruf.`}
          className="min-h-20"
        />
      </Modal>
    </>
  );
}
