import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceGuideView } from './workspace-guide-view';

vi.mock('../../session-context', () => ({
  useSessionContext: () => ({
    session: {
      user: { id: 'staff-admin-1', displayName: 'Admin Studio', role: 'ADMIN' },
      roles: [{ role: 'ADMIN', branchId: null }],
    },
  }),
}));

describe('WorkspaceGuideView (Poin 18)', () => {
  it('renders operational SOP heading, role tabs, and passes axe a11y test', async () => {
    const view = render(<WorkspaceGuideView />);

    expect(
      screen.getByRole('heading', { name: 'Standar Operasional Prosedur (SOP) Studio' }),
    ).toBeVisible();

    expect(screen.getByText('1. Front Desk & Cabang')).toBeVisible();
    expect(screen.getByText('2. Finance & Kasir')).toBeVisible();
    expect(screen.getByText('3. Super Owner & Eksekutif')).toBeVisible();

    // Default tab is Front Desk
    expect(
      screen.getByRole('heading', { name: 'Front Desk & Operasional Cabang' }),
    ).toBeVisible();
    expect(screen.getByText('1. Scanner QR Code Kehadiran Member')).toBeVisible();
    expect(screen.getByRole('link', { name: /Buka Check-in/i })).toHaveAttribute(
      'href',
      '/workspace/check-in',
    );

    // Verify a11y
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('switches to Finance and Super Owner tabs correctly', () => {
    render(<WorkspaceGuideView />);

    // Click Finance Tab
    fireEvent.click(screen.getByText('2. Finance & Kasir'));
    expect(screen.getByRole('heading', { name: 'Finance & Accounting' })).toBeVisible();
    expect(screen.getByText('1. Verifikasi & Approval Pembayaran')).toBeVisible();
    expect(screen.getByRole('link', { name: /Buka Pembayaran/i })).toHaveAttribute(
      'href',
      '/workspace/payments',
    );

    // Click Super Owner Tab
    fireEvent.click(screen.getByText('3. Super Owner & Eksekutif'));
    expect(
      screen.getByRole('heading', { name: 'Super Owner & Manajemen Eksekutif' }),
    ).toBeVisible();
    expect(screen.getByText('1. Executive Multi-Branch Command Center')).toBeVisible();
    expect(screen.getByRole('link', { name: /Buka Audit Trail/i })).toHaveAttribute(
      'href',
      '/audit',
    );
  });

  it('filters SOP steps via search query', () => {
    render(<WorkspaceGuideView />);

    const searchInput = screen.getByPlaceholderText(/Cari SOP/i);
    fireEvent.change(searchInput, { target: { value: 'Assisted' } });

    expect(screen.getByText('2. Manajemen Slot & Assisted Booking')).toBeVisible();
    expect(
      screen.queryByText('1. Scanner QR Code Kehadiran Member'),
    ).not.toBeInTheDocument();
  });
});
