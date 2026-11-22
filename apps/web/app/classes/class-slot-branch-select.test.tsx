import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClassSlotView } from './class-slot-view';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { ClassSlotClient } from '../api-clients/class-slot-client';

const render = (view: React.ReactNode) =>
  rtlRender(view, {
    wrapper: ({ children }) => <AppFeedbackProvider>{children}</AppFeedbackProvider>,
  });

const mockBranches = [
  { id: 'b1', code: 'DD-GG', name: 'Daily Dose Green Garden', timezone: 'Asia/Jakarta' },
  { id: 'b2', code: 'DD-MK', name: 'Daily Dose Muara Karang', timezone: 'Asia/Jakarta' },
];

const mockClient = {
  discover: vi.fn().mockResolvedValue({
    slots: [],
    classTypes: [{ id: 'ct1', name: 'Reformer Intro', code: 'REF-INTRO' }],
    instructors: [{ id: 'ins1', name: 'Coach Sarah', code: 'SARAH' }],
    studios: [{ id: 'st1', name: 'Studio Utama', branchId: 'b1', rooms: [] }],
  }),
  create: vi.fn().mockResolvedValue({ id: 'new-slot' }),
  getBranchStudios: vi.fn().mockResolvedValue([]),
} as unknown as ClassSlotClient;

describe('ClassSlotView - Mode Semua Cabang (Poin 22)', () => {
  it('tombol Buat kelas tetap aktif saat melihat Semua Cabang dan menampilkan pilihan cabang studio di form', async () => {
    const user = userEvent.setup();

    render(
      <ClassSlotView
        client={mockClient}
        branchOverride={null}
        branchesOverride={mockBranches}
        capabilitiesOverride={['class-slot:read', 'class-slot:manage', 'branch:all']}
      />,
    );

    // Tombol "Buat kelas" harus aktif (enabled), bukan disabled
    const createButton = await screen.findByRole('button', { name: 'Buat kelas' });
    expect(createButton).toBeEnabled();

    // Klik tombol "Buat kelas"
    await user.click(createButton);

    // Dialog buat draft kelas terbuka
    const dialog = await screen.findByRole('dialog', { name: 'Buat kelas' });
    expect(dialog).toBeInTheDocument();

    // Pilihan Cabang Studio tersedia di dalam dialog
    const branchCombobox = within(dialog).getByRole('combobox', { name: /Cabang Studio/ });
    expect(branchCombobox).toBeInTheDocument();
  });
});
