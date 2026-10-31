import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedPackageMembersDialog } from './shared-package-members-dialog';
import * as ledgerClient from '@/api-clients/ledger-client';

vi.mock('@/api-clients/ledger-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-clients/ledger-client')>();
  return {
    ...actual,
    listPackageMembers: vi.fn(),
    addPackageMember: vi.fn(),
    removePackageMember: vi.fn(),
  };
});

describe('SharedPackageMembersDialog - Self-Service Sharing Paket', () => {
  const customerPackageId = 'cp-100';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Happy Path: Member mengundang teman via email secara self-service', async () => {
    vi.mocked(ledgerClient.listPackageMembers).mockResolvedValue({
      customerPackageId,
      package: { id: 'p-1', name: 'Duet Package 10', isShareable: true },
      owner: {
        id: 'user-owner',
        displayName: 'Alice Owner',
        phoneMasked: '0812****',
        activeBookings: 1,
        attendedSessions: 2,
      },
      remainingSessions: 7,
      status: 'ACTIVE',
      members: [],
    });

    vi.mocked(ledgerClient.addPackageMember).mockResolvedValue({
      id: 'member-1',
      userId: 'user-friend',
      relationship: 'FRIEND',
      displayName: 'Bob Friend',
      phoneMasked: '0813****',
      createdAt: new Date().toISOString(),
    });

    const user = userEvent.setup();
    render(
      <SharedPackageMembersDialog
        open={true}
        onClose={vi.fn()}
        customerPackageId={customerPackageId}
        packageName="Duet Package 10"
        canManage={true}
      />,
    );

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument();
    expect(screen.getByText(/2 sesi terpakai · 1 booking aktif/)).toBeInTheDocument();

    const input = screen.getByTestId('input-member-identifier');
    await user.type(input, 'bob@example.com');

    const submitBtn = screen.getByTestId('btn-add-member');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(ledgerClient.addPackageMember).toHaveBeenCalledWith(customerPackageId, {
        identifier: 'bob@example.com',
        relationship: 'FRIEND',
      });
    });
  });

  it('Happy Path: Member mengundang teman via nomor HP WhatsApp (08...)', async () => {
    vi.mocked(ledgerClient.listPackageMembers).mockResolvedValue({
      customerPackageId,
      package: { id: 'p-1', name: 'Duet Package 10', isShareable: true },
      owner: {
        id: 'user-owner',
        displayName: 'Alice Owner',
        phoneMasked: '0812****',
      },
      remainingSessions: 7,
      status: 'ACTIVE',
      members: [],
    });

    vi.mocked(ledgerClient.addPackageMember).mockResolvedValue({
      id: 'member-1',
      userId: 'user-friend',
      relationship: 'FAMILY',
      displayName: 'Charlie Family',
      phoneMasked: '0812****',
      createdAt: new Date().toISOString(),
    });

    const user = userEvent.setup();
    render(
      <SharedPackageMembersDialog
        open={true}
        onClose={vi.fn()}
        customerPackageId={customerPackageId}
        packageName="Duet Package 10"
        canManage={true}
      />,
    );

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument();

    const input = screen.getByTestId('input-member-identifier');
    await user.type(input, '081299998888');

    const select = screen.getByTestId('select-member-relationship');
    await user.selectOptions(select, 'FAMILY');

    const submitBtn = screen.getByTestId('btn-add-member');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(ledgerClient.addPackageMember).toHaveBeenCalledWith(customerPackageId, {
        identifier: '081299998888',
        relationship: 'FAMILY',
      });
    });
  });

  it('No Happy Path: Menampilkan peringatan kuota penuh saat 4 anggota bersama sudah terdaftar', async () => {
    vi.mocked(ledgerClient.listPackageMembers).mockResolvedValue({
      customerPackageId,
      package: { id: 'p-1', name: 'Duet Package 10', isShareable: true },
      owner: {
        id: 'user-owner',
        displayName: 'Alice Owner',
        phoneMasked: '0812****',
      },
      remainingSessions: 2,
      status: 'ACTIVE',
      members: [
        { id: 'm-1', userId: 'u-1', relationship: 'FAMILY', displayName: 'Member 1', phoneMasked: '0811****', createdAt: '' },
        { id: 'm-2', userId: 'u-2', relationship: 'FRIEND', displayName: 'Member 2', phoneMasked: '0812****', createdAt: '' },
        { id: 'm-3', userId: 'u-3', relationship: 'SPOUSE', displayName: 'Member 3', phoneMasked: '0813****', createdAt: '' },
        { id: 'm-4', userId: 'u-4', relationship: 'CHILD', displayName: 'Member 4', phoneMasked: '0814****', createdAt: '' },
      ],
    });

    render(
      <SharedPackageMembersDialog
        open={true}
        onClose={vi.fn()}
        customerPackageId={customerPackageId}
        packageName="Duet Package 10"
        canManage={true}
      />,
    );

    expect(await screen.findByText(/Batas Kuota Tercapai/)).toBeInTheDocument();
    expect(screen.queryByTestId('input-member-identifier')).toBeNull();
  });

  it('No Happy Path: Menampilkan pesan error saat paket kedaluwarsa atau terjadi kendala', async () => {
    vi.mocked(ledgerClient.listPackageMembers).mockResolvedValue({
      customerPackageId,
      package: { id: 'p-1', name: 'Duet Package 10', isShareable: true },
      owner: {
        id: 'user-owner',
        displayName: 'Alice Owner',
        phoneMasked: '0812****',
      },
      remainingSessions: 5,
      status: 'ACTIVE',
      members: [],
    });

    vi.mocked(ledgerClient.addPackageMember).mockRejectedValue({
      status: 400,
      data: { code: 'PACKAGE_EXPIRED' },
    });

    const user = userEvent.setup();
    render(
      <SharedPackageMembersDialog
        open={true}
        onClose={vi.fn()}
        customerPackageId={customerPackageId}
        packageName="Duet Package 10"
        canManage={true}
      />,
    );

    await screen.findByText('Alice Owner');
    await user.type(screen.getByTestId('input-member-identifier'), 'test@test.com');
    await user.click(screen.getByTestId('btn-add-member'));

    expect(
      await screen.findByText('Paket sudah kedaluwarsa sehingga tidak dapat menambah anggota baru.'),
    ).toBeInTheDocument();
  });
});
