'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import {
  browserWaTertautClient,
  pesanGalatWa,
  type InfoWaTertaut,
  type WaTertautClient,
} from '@/api-clients/wa-tertaut-client';
import { Button } from '@/components/actions';
import { useAppFeedback } from '@/components/app-feedback';
import { Feedback, StatusBadge } from '@/ui';

const JEDA_CEK_MS = 3_000;

/**
 * Admin menautkan WhatsApp dari HP-nya sendiri (scan QR seperti WhatsApp Web). Setelah tersambung,
 * pesan otomatis ke member cabangnya dikirim dari nomor ini: akun baru terdaftar, terima kasih
 * pembelian + Syarat & Ketentuan, dan pengingat kelas H-24.
 */
export function WhatsAppOtomatis({ client = browserWaTertautClient }: { client?: WaTertautClient }) {
  const feedback = useAppFeedback();
  const [info, setInfo] = useState<InfoWaTertaut | null>(null);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cek = useCallback(async () => {
    try {
      setInfo(await client.status());
    } catch (e) {
      setGalat(pesanGalatWa(e));
    }
  }, [client]);

  useEffect(() => {
    void cek();
  }, [cek]);

  // Selama menunggu scan, status dicek berkala supaya QR baru dan "tersambung" langsung terlihat.
  useEffect(() => {
    if (info?.status !== 'MENUNGGU_SCAN') return;
    timer.current = setTimeout(() => void cek(), JEDA_CEK_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [info, cek]);

  const jalankan = async (aksi: () => Promise<unknown>, berhasil?: string) => {
    setSibuk(true);
    setGalat('');
    setPesan('');
    try {
      const hasil = await aksi();
      if (hasil && typeof hasil === 'object' && 'status' in hasil && 'siap' in hasil) setInfo(hasil as InfoWaTertaut);
      else await cek();
      if (berhasil) setPesan(berhasil);
    } catch (e) {
      setGalat(pesanGalatWa(e));
    } finally {
      setSibuk(false);
    }
  };

  const putuskan = async () => {
    const ya =
      (await feedback?.confirm({
        tone: 'danger',
        title: 'Putuskan WhatsApp otomatis?',
        message: 'Pesan otomatis ke member cabang Anda berhenti dikirim dari nomor ini sampai Anda menyambungkannya lagi.',
        confirmLabel: 'Putuskan',
      })) ?? true;
    if (ya) await jalankan(() => client.putuskan(), 'WhatsApp diputus dari sistem.');
  };

  if (!info && !galat) return null;
  const status = info?.status ?? 'BELUM_TERSAMBUNG';

  return (
    <section id="whatsapp" aria-labelledby="wa-otomatis-title" className="space-y-4 rounded-dd-xl border border-dd-line bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wa-otomatis-title" className="m-0 flex items-center gap-2 text-lg font-semibold text-dd-ink">
          <MessageCircle className="size-5" aria-hidden="true" />
          WhatsApp otomatis
        </h2>
        {status === 'TERSAMBUNG' ? (
          <StatusBadge tone="success">Tersambung{info?.nomor ? ` · +${info.nomor}` : ''}</StatusBadge>
        ) : status === 'TERPUTUS' ? (
          <StatusBadge tone="danger">Terputus</StatusBadge>
        ) : status === 'MENUNGGU_SCAN' ? (
          <StatusBadge tone="warning">Menunggu scan</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Belum tersambung</StatusBadge>
        )}
      </div>
      <p className="m-0 text-[15px] text-dd-muted">
        Pesan ke member cabang Anda dikirim otomatis dari WhatsApp Anda: akun baru terdaftar, terima kasih
        setelah membeli paket beserta Syarat &amp; Ketentuan, dan pengingat jadwal latihan H-24 jam.
      </p>

      {galat && <Feedback kind="error" onDismiss={() => setGalat('')}>{galat}</Feedback>}
      {pesan && <Feedback kind="status" onDismiss={() => setPesan('')}>{pesan}</Feedback>}
      {status === 'TERPUTUS' && info?.galat && <Feedback kind="error">{info.galat}</Feedback>}

      {info && !info.siap ? (
        <p className="m-0 text-sm text-dd-muted">
          Fitur ini belum disiapkan di server (kunci WA_SESSION_KEY dan tabel wa_tertaut_sesi). Hubungi pengembang.
        </p>
      ) : status === 'MENUNGGU_SCAN' ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {info?.qr ? (
            <img src={info.qr} alt="QR untuk menautkan WhatsApp" width={240} height={240} className="rounded-dd-md border border-dd-line" />
          ) : (
            <p className="m-0 text-sm text-dd-muted">Menyiapkan QR…</p>
          )}
          <ol className="m-0 space-y-1 pl-5 text-[15px] text-dd-ink">
            <li>Buka WhatsApp di HP Anda.</li>
            <li>Klik menu titik tiga (Android) atau Pengaturan (iPhone), lalu Perangkat tertaut.</li>
            <li>Pilih Tautkan perangkat, lalu arahkan kamera ke QR ini.</li>
            <li>Halaman ini berubah menjadi Tersambung dengan sendirinya.</li>
          </ol>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {status === 'TERSAMBUNG' ? (
            <>
              <Button type="button" variant="secondary" loading={sibuk} onClick={() => void jalankan(() => client.uji(), 'Pesan uji terkirim ke chat WhatsApp Anda sendiri.')}>
                Kirim pesan uji
              </Button>
              <Button type="button" variant="ghost" disabled={sibuk} onClick={() => void putuskan()}>
                Putuskan
              </Button>
            </>
          ) : (
            <Button type="button" variant="primary" loading={sibuk} onClick={() => void jalankan(() => client.mulai())}>
              Sambungkan WhatsApp
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Di halaman Hari ini: mengingatkan Admin bila WhatsApp otomatisnya belum tersambung atau terputus. */
export function PengingatWhatsAppAdmin({ client = browserWaTertautClient }: { client?: WaTertautClient }) {
  const [info, setInfo] = useState<InfoWaTertaut | null>(null);
  useEffect(() => {
    let batal = false;
    client
      .status()
      .then((i) => !batal && setInfo(i))
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [client]);
  if (!info?.siap || info.status === 'TERSAMBUNG' || info.status === 'MENUNGGU_SCAN') return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-dd-lg border border-dd-warning-line/60 bg-dd-warning-soft px-4 py-3 text-[15px] text-dd-ink">
      <span>
        {info.status === 'TERPUTUS'
          ? 'WhatsApp otomatis Anda terputus: pesan ke member (terima kasih, S&K, pengingat kelas) tidak terkirim.'
          : 'WhatsApp otomatis belum tersambung: pesan ke member (terima kasih, S&K, pengingat kelas) belum terkirim.'}
      </span>
      <a href="/account/profile#whatsapp" className="inline-flex min-h-11 items-center font-semibold text-dd-forest underline-offset-4 hover:underline">
        Sambungkan WhatsApp
      </a>
    </div>
  );
}
