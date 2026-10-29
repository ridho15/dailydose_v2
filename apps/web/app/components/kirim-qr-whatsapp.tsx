'use client';

import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api-client';
import { Button } from './actions';
import { useSessionContext } from '../session-context';

interface HasilKirimQr {
  status: 'SENT' | 'FAILED' | 'SKIPPED_DUPLICATE';
  provider: string;
  error?: string;
}

export async function kirimQrWhatsApp(userId: string): Promise<HasilKirimQr> {
  return apiFetch<HasilKirimQr>(`/users/${encodeURIComponent(userId)}/check-in-qr/whatsapp`, {
    method: 'POST',
    label: 'Mengirim QR lewat WhatsApp…',
  });
}

/** Kalimat hasil pengiriman untuk staf, termasuk saat WhatsApp masih mode uji. */
export function pesanHasilKirim(
  hasil: HasilKirimQr,
  nama: string,
): { tone: 'success' | 'warning' | 'danger'; pesan: string } {
  if (hasil.status === 'SKIPPED_DUPLICATE')
    return {
      tone: 'warning',
      pesan: `QR baru saja dikirim ke ${nama}. Tunggu dua menit sebelum mengirim lagi.`,
    };
  if (hasil.status === 'FAILED')
    return {
      tone: 'danger',
      pesan: `QR belum terkirim ke ${nama}. Periksa nomor WhatsApp-nya, lalu coba lagi.`,
    };
  if (hasil.provider === 'MOCK')
    return {
      tone: 'warning',
      pesan: `Tercatat, tetapi belum benar-benar terkirim: kunci WhatsApp belum dipasang di server.`,
    };
  return { tone: 'success', pesan: `QR kehadiran terkirim ke WhatsApp ${nama}.` };
}

/** Tombol staf untuk mengirim QR kehadiran ke WhatsApp member atau instruktur. */
export function KirimQrWhatsApp({
  userId,
  nama,
  punyaNomor,
  kirim = kirimQrWhatsApp,
}: {
  userId: string;
  nama: string;
  punyaNomor: boolean;
  /** Hanya untuk tes. */
  kirim?: (userId: string) => Promise<HasilKirimQr>;
}) {
  const context = useSessionContext();
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState<{
    tone: 'success' | 'warning' | 'danger';
    pesan: string;
  } | null>(null);
  const boleh = Boolean(
    context?.hasCapability?.('attendance:manage') || context?.hasCapability?.('customer:manage'),
  );
  if (!boleh) return null;

  const tekan = async () => {
    setSibuk(true);
    setHasil(null);
    try {
      setHasil(pesanHasilKirim(await kirim(userId), nama));
    } catch (error) {
      const issue = (
        error instanceof ApiError
          ? (error.data as { issues?: { field?: string; issue?: string }[] })
          : null
      )?.issues?.[0];
      setHasil({
        tone: 'danger',
        pesan:
          issue?.field === 'phone'
            ? `${nama} belum punya nomor WhatsApp. Isi nomornya di profil dulu.`
            : issue?.issue === 'ACCOUNT_INACTIVE'
              ? `Akun ${nama} tidak aktif.`
              : 'QR belum terkirim. Coba lagi sebentar.',
      });
    } finally {
      setSibuk(false);
    }
  };

  const warna = { success: 'text-dd-forest', warning: 'text-dd-warning', danger: 'text-dd-danger' };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={!punyaNomor || sibuk}
        title={punyaNomor ? undefined : 'Isi nomor WhatsApp di profil dulu'}
        leadingIcon={<MessageCircle className="size-4" aria-hidden="true" />}
        onClick={() => void tekan()}
      >
        {sibuk ? 'Mengirim…' : 'Kirim QR via WhatsApp'}
      </Button>
      {hasil && (
        <span role="status" className={`max-w-xs text-sm ${warna[hasil.tone]}`}>
          {hasil.pesan}
        </span>
      )}
    </span>
  );
}
