import { apiFetch } from '../lib/api-client';

export interface PembelianBaru {
  id: string;
  invoiceNumber: string;
  namaMember: string;
  telepon: string | null;
  namaPaket: string;
  masaBerlakuHari: number | null;
  perpanjangan: boolean;
  totalRp: number;
  dibayarPada: string;
  terkirimPada: string | null;
}

export interface PembelianBaruClient {
  daftar(branchId: string): Promise<{ items: PembelianBaru[]; siap: boolean }>;
  tandaiTerkirim(purchaseId: string): Promise<{ purchaseId: string; terkirimPada: string }>;
}

export const browserPembelianBaruClient: PembelianBaruClient = {
  daftar: (branchId) =>
    apiFetch(`/purchase-followups?branchId=${encodeURIComponent(branchId)}`, { label: 'Memuat pembelian baru…' }),
  tandaiTerkirim: (purchaseId) =>
    apiFetch(`/purchase-followups/${encodeURIComponent(purchaseId)}/sent`, {
      method: 'POST',
      label: 'Mencatat pesan terkirim…',
    }),
};
