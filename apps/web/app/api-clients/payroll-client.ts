import { apiFetch } from '../lib/api-client';

export interface BarisPayroll {
  classSlotId: string;
  mulai: string;
  selesai: string;
  namaKelas: string;
  namaCabang: string;
  jam: number;
  tarifPerJamRp: number;
  honorRp: number;
  terverifikasi: boolean;
  hadirPada: string | null;
}

export interface KoreksiPayroll {
  id: string;
  kelasMulai: string;
  jam: number;
  nilaiRp: number;
  alasan: string | null;
  dicatatPada: string;
}

export interface PayrollSaya {
  period: string;
  totalRp: number;
  terverifikasiRp: number;
  koreksiRp: number;
  belumTerverifikasiRp: number;
  kelasTerverifikasi: number;
  kelasBelumTerverifikasi: number;
  jamTerverifikasi: number;
  kelas: BarisPayroll[];
  koreksi: KoreksiPayroll[];
}

export interface PayrollClient {
  milikSaya(period: string): Promise<PayrollSaya>;
}

export const browserPayrollClient: PayrollClient = {
  async milikSaya(period) {
    const hasil = await apiFetch<PayrollSaya>(`/me/payroll?${new URLSearchParams({ period })}`, {
      label: 'Memuat payroll…',
    });
    if (!Array.isArray(hasil?.kelas) || typeof hasil.totalRp !== 'number') {
      throw new Error('PAYROLL_TIDAK_DIKENAL');
    }
    return hasil;
  },
};
