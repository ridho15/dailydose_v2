import { apiFetch, ApiError } from '../lib/api-client';

export type StatusWaTertaut = 'BELUM_TERSAMBUNG' | 'MENUNGGU_SCAN' | 'TERSAMBUNG' | 'TERPUTUS';

export interface InfoWaTertaut {
  /** False: server belum disiapkan (kunci WA_SESSION_KEY atau tabel wa_tertaut_sesi belum ada). */
  siap: boolean;
  status: StatusWaTertaut;
  nomor: string | null;
  /** Gambar QR (data URL) selama menunggu scan. */
  qr: string | null;
  galat: string | null;
}

export interface WaTertautClient {
  status(): Promise<InfoWaTertaut>;
  mulai(): Promise<InfoWaTertaut>;
  uji(): Promise<{ terkirim: boolean }>;
  putuskan(): Promise<unknown>;
}

export const browserWaTertautClient: WaTertautClient = {
  // Dipanggil berulang selama menunggu scan: fetch biasa, tanpa indikator loading global.
  status: async () => {
    const r = await fetch('/api/v1/me/whatsapp-link', { credentials: 'include', headers: { Accept: 'application/json' } });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(`Request failed with status ${r.status}`, r.status, data, data?.error?.code ?? data?.code);
    return data as InfoWaTertaut;
  },
  mulai: () => apiFetch('/me/whatsapp-link', { method: 'POST', label: 'Menyiapkan QR WhatsApp…' }),
  uji: () => apiFetch('/me/whatsapp-link/test', { method: 'POST', label: 'Mengirim pesan uji…' }),
  putuskan: () => apiFetch('/me/whatsapp-link', { method: 'DELETE', label: 'Memutus WhatsApp…' }),
};

/** Pesan galat untuk staf: penyebab dan langkahnya. */
export function pesanGalatWa(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case 'WA_LINK_NOT_CONFIGURED':
      return 'Server belum disiapkan untuk WhatsApp otomatis (kunci WA_SESSION_KEY belum diisi). Hubungi pengembang.';
    case 'WA_LINK_TABLE_MISSING':
      return 'Server belum disiapkan untuk WhatsApp otomatis (tabel wa_tertaut_sesi belum dibuat). Hubungi pengembang.';
    case 'WA_LINK_ADMIN_ONLY':
      return 'Hanya akun Admin cabang yang bisa menyambungkan WhatsApp otomatis.';
    case 'WA_LINK_NOT_CONNECTED':
      return 'WhatsApp belum tersambung. Klik Sambungkan dan scan QR dulu.';
    case 'WA_LINK_SEND_FAILED':
      return 'Pesan uji gagal terkirim. Pastikan HP Anda tersambung internet, lalu coba lagi.';
    default:
      return 'Permintaan gagal. Muat ulang halaman; bila masih gagal, hubungi pengembang.';
  }
}
