import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

let peran: string[] = ['OWNER'];
vi.mock('../../session-context', () => ({ useSessionContext: () => ({ session: { roles: peran } }) }));
import type { AdjustmentEvidenceClient } from '@/api-clients/adjustment-evidence-client';
import { PenyesuaianForm } from './penyesuaian-form';

const paket = {
  id: 'pk-1',
  customerUserId: 'm-1',
  customer: { id: 'm-1', displayName: 'Lia Kusuma' },
  status: 'ACTIVE',
  available: 3,
  remainingSessions: 3,
  expiryAt: new Date('2026-12-12T00:00:00Z'),
  packageName: 'Private Group 10 sesi',
};

function client(): AdjustmentEvidenceClient {
  return {
    cariMember: vi.fn().mockResolvedValue([{ id: 'm-1', displayName: 'Lia Kusuma' }]),
    paketMember: vi.fn().mockResolvedValue([paket]),
    kirim: vi.fn().mockResolvedValue({ resultingBalance: 4, evidenceUrl: '/x' }),
    terakhir: vi.fn().mockResolvedValue([
      {
        id: 'adj-1',
        customerPackageId: 'pk-1',
        quantity: 2,
        reasonCode: 'PACKAGE_COMPENSATION',
        status: 'POSTED',
        version: 2,
        customer: { id: 'm-1', displayName: 'Lia Kusuma', phoneMasked: null },
        decisionNote: 'Kelas 14 Okt batal karena instruktur sakit.',
        decidedBy: { id: 'o', displayName: 'Rina' },
        decidedAt: new Date('2026-10-21T07:08:00Z'),
      },
    ]),
  };
}

const ALASAN = 'Keputusan Owner: kompensasi kelas 9 Okt yang dibatalkan studio.';

describe('PenyesuaianForm, Disetujui Owner', () => {
  it('Owner mencentang Disetujui Owner: terkirim tanpa berkas', async () => {
    peran = ['OWNER'];
    const c = client();
    const user = userEvent.setup();
    render(<PenyesuaianForm client={c} awal={{ memberId: 'm-1', sesi: 1 }} />);
    expect(await screen.findByText(/sisa 3/)).toBeVisible();
    await user.type(screen.getByLabelText('Alasan, wajib diisi'), ALASAN);
    const kirim = screen.getByRole('button', { name: 'Kirim penyesuaian' });
    expect(kirim).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Disetujui Owner, tanpa lampiran/ }));
    expect(kirim).toBeEnabled();
    await user.click(kirim);
    expect(c.kirim).toHaveBeenCalledWith(expect.objectContaining({ evidence: null, disetujuiOwner: true }));
  });

  it('Manager tidak melihat pilihan itu', async () => {
    peran = ['MANAGER'];
    render(<PenyesuaianForm client={client()} awal={{ memberId: 'm-1', sesi: 1 }} />);
    expect(await screen.findByText(/sisa 3/)).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /Disetujui Owner/ })).toBeNull();
  });
});
