import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { MasterView } from './master-view';
import { AppFeedbackProvider } from '../components/app-feedback';
import type { MasterClient } from '@/api-clients/master-client';

const mockDeletability = vi.fn();
const mockRemove = vi.fn();
const mockArchive = vi.fn();
afterEach(() => {
  mockRemove.mockClear();
  mockArchive.mockClear();
  mockDeletability.mockReset();
});
vi.mock('../api-clients/lifecycle-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api-clients/lifecycle-client')>();
  return {
    ...actual,
    lifecycleClient: {
      deletability: (...args: unknown[]) => mockDeletability(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
      archive: (...args: unknown[]) => mockArchive(...args),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/master',
  useSearchParams: () => new URLSearchParams(),
}));


vi.mock('../session-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session-context')>();
  return {
    ...actual,
    useSessionContext: () => ({
      status: 'authenticated',
      activeBranchId: 'branch-1',
      hasCapability: () => true,
      session: {
        status: 'authenticated',
        hasCapability: () => true,
        branches: [
          { id: 'branch-1', name: 'Daily Dose Jakarta', code: 'DD-JKT' },
        ],
      },
    }),
  };
});

function fakeMasterClient(overrides: Partial<MasterClient> = {}): MasterClient {
  return {
    listBranches: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'branch-1',
          code: 'DD-JKT',
          name: 'Daily Dose Jakarta',
          timezone: 'Asia/Jakarta',
          active: true,
          version: 0,
        },
      ],
      summary: { total: 1, active: 1, inactive: 0 },
      page: { hasMore: false, nextCursor: null },
    }),
    listClassTypes: vi.fn().mockResolvedValue([
      {
        id: 'class-1',
        code: 'REFORMER',
        name: 'Reformer Pilates',
        active: true,
        version: 0,
        branchScopes: [],
      },
    ]),
    listStudios: vi.fn().mockResolvedValue([
      {
        id: 'studio-1',
        code: 'MAIN',
        name: 'Main Studio',
        active: true,
        version: 0,
        rooms: [],
      },
    ]),
    listSettings: vi.fn().mockResolvedValue([]),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createClassType: vi.fn().mockResolvedValue({
      id: 'class-2',
      code: 'BARRE',
      name: 'Barre Sculpt',
      active: true,
      version: 0,
      branchScopes: [],
    }),
    updateClassType: vi.fn().mockResolvedValue({
      id: 'class-1',
      code: 'REFORMER',
      name: 'Reformer Pilates Updated',
      active: true,
      version: 1,
      branchScopes: [],
    }),
    deactivateBranch: vi.fn().mockResolvedValue(undefined),
    deactivateClassType: vi.fn().mockResolvedValue({
      id: 'class-1',
      code: 'REFORMER',
      name: 'Reformer Pilates',
      active: false,
      version: 1,
      branchScopes: [],
    }),
    reactivateClassType: vi.fn().mockResolvedValue({
      id: 'class-1',
      code: 'REFORMER',
      name: 'Reformer Pilates',
      active: true,
      version: 2,
      branchScopes: [],
    }),
    replaceClassTypeScopes: vi.fn().mockResolvedValue([]),
    createStudio: vi.fn().mockResolvedValue({
      id: 'studio-2',
      code: 'STUDIO-B',
      name: 'Studio B',
      active: true,
      version: 0,
    }),
    updateStudio: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockResolvedValue({
      id: 'room-1',
      code: 'ROOM-1',
      name: 'Room 1',
      active: true,
      version: 0,
    }),
    updateRoom: vi.fn().mockResolvedValue(undefined),
    deleteSetting: vi.fn().mockResolvedValue(undefined),
    createSetting: vi.fn().mockResolvedValue({
      id: 'setting-1',
      kind: 'QUOTA_CAPACITY',
      branchId: 'branch-1',
      classTypeId: 'class-1',
      effectiveFrom: new Date('2026-08-01'),
      effectiveUntil: null,
      value: { minimumQuota: 4, defaultCapacity: 8 },
      version: 0,
      active: true,
    }),
    ...overrides,
  };
}

describe('MasterView Redesign Tests', () => {
  it('does NOT show any persistent green status alert on initial render', async () => {
    const client = fakeMasterClient();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="classTypes" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    // Initial silent render should NOT show role="status"
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders modern PageHeader, StatCards, and full-width CRUD table on classTypes tab', async () => {
    const client = fakeMasterClient();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="classTypes" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    // Verify PageHeader
    expect(screen.getByRole('heading', { name: 'Data Master' })).toBeVisible();

    // Verify StatCards
    expect(screen.getByText('Tipe kelas aktif')).toBeVisible();
    expect(screen.getByText('Cabang aktif')).toBeVisible();
    expect(screen.getByText('Konfigurasi aktif')).toBeVisible();

    // Verify Table Header, Search Input, and Add Button
    expect(screen.getByRole('heading', { name: 'Tipe kelas' })).toBeVisible();
    expect(screen.getByLabelText('Cari tipe kelas')).toBeVisible();
    expect(screen.getByRole('button', { name: /Tambah tipe kelas/i })).toBeVisible();

    // Load master data to populate rows
    await waitFor(() => expect(screen.getByRole('button', { name: 'Muat master data' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(await screen.findByText('REFORMER')).toBeVisible();
    expect(screen.getByText('Reformer Pilates')).toBeVisible();

    // Opening Modal reveals the create form
    await userEvent.click(screen.getByRole('button', { name: /Tambah tipe kelas/i }));
    expect(screen.getByRole('form', { name: 'Buat class type' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Tambah tipe kelas' })).toBeVisible();
  });

  it('shows status alert only when a mutation action is performed (e.g. creating a class type)', async () => {
    const client = fakeMasterClient();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="classTypes" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    // Click [+ Tambah tipe kelas] to open modal dialog
    await userEvent.click(screen.getByRole('button', { name: /Tambah tipe kelas/i }));

    // Fill form inside modal and submit
    await userEvent.type(screen.getByLabelText(/Kode kelas/), 'BARRE');
    await userEvent.type(screen.getByLabelText(/Nama kelas/), 'Barre Sculpt');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan tipe kelas' }));

    // Status alert MUST appear after mutation
    expect(await screen.findByRole('status')).toHaveTextContent('Tipe kelas berhasil dibuat.');
  });

  it('renders quota and capacity settings tab', async () => {
    const client = fakeMasterClient();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="capacity" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Kuota & kapasitas kelas' })).toBeVisible();
  });

  it('has zero accessibility violations', async () => {
    const client = fakeMasterClient();
    const view = render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="classTypes" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    const results = await axe(view.container);
    expect(results.violations).toHaveLength(0);
  });
});

describe('MasterView tarif list', () => {
  const fee = (overrides: Record<string, unknown>) => ({
    id: 'fee-1',
    kind: 'INSTRUCTOR_FEE',
    businessKey: 'fee-1',
    branchId: 'branch-1',
    classTypeId: 'class-1',
    value: { feeRp: 180_000 },
    effectiveFrom: new Date('2027-01-01T00:00:00Z'),
    effectiveUntil: null,
    version: 1,
    instructorName: 'Ayu Instruktur',
    deletable: true,
    ...overrides,
  });

  it('shows the rupiah value, instructor and status, and deletes only not-yet-effective rows after confirming', async () => {
    const client = fakeMasterClient({
      listSettings: vi.fn().mockResolvedValue([
        fee({}),
        fee({
          id: 'fee-2',
          value: { feeRp: 150_000 },
          effectiveFrom: new Date('2025-01-01T00:00:00Z'),
          deletable: false,
        }),
      ]),
    });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );
    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect((await screen.findAllByText('Ayu Instruktur', { selector: 'span' })).length).toBe(2);
    expect(screen.getByText('Rp 180.000')).toBeVisible();
    expect(screen.getByText('Akan berlaku')).toBeVisible();
    expect(screen.getByText('Sudah berlaku')).toBeVisible();
    expect(screen.queryByLabelText(/Efektif sampai/)).toBeNull();
    const deleteButtons = screen.getAllByRole('button', { name: 'Hapus' });
    expect(deleteButtons).toHaveLength(1);
    await user.click(deleteButtons[0]!);
    expect(client.deleteSetting).not.toHaveBeenCalled();
    const confirmDelete = await screen.findByRole('button', { name: 'Hapus tarif' });
    expect(confirmDelete).toBeDisabled();
    await user.type(screen.getByLabelText(/^Alasan/), 'Tarif salah input');
    await user.click(confirmDelete);
    await waitFor(() =>
      expect(client.deleteSetting).toHaveBeenCalledWith('INSTRUCTOR_FEE', 'fee-1', 'Tarif salah input'),
    );
    expect(await screen.findByText('Tarif dihapus.')).toBeVisible();
  });

  it('lets Super Owner delete an effective version entered by mistake, after seeing the honor impact', async () => {
    const client = fakeMasterClient({
      listSettings: vi.fn().mockResolvedValue([
        fee({
          id: 'fee-2',
          value: { feeRp: 300_000 },
          effectiveFrom: new Date('2025-01-01T00:00:00Z'),
          deletable: false,
          duplikat: true,
        }),
      ]),
      dampakHapusTarif: vi.fn().mockResolvedValue({
        id: 'fee-2',
        sudahBerlaku: true,
        duplikat: false,
        kelasTerdampak: 2,
        honorSekarangRp: 600_000,
        honorSetelahHapusRp: 650_000,
      }),
    });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView
          client={client}
          activeTab="fees"
          access={{ canManage: true, canFinance: true, canCorrect: true }}
        />
      </AppFeedbackProvider>,
    );
    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(await screen.findByText('Duplikat')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hapus salah input' }));
    expect(await screen.findByText(/Honor 2 kelas yang sudah selesai berubah/)).toBeVisible();
    const confirm = screen.getByRole('button', { name: 'Hapus versi keliru' });
    await user.type(screen.getByLabelText(/^Alasan/), 'Salah');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/^Alasan/), ' pilih tipe kelas');
    await user.click(confirm);
    await waitFor(() =>
      expect(client.deleteSetting).toHaveBeenCalledWith(
        'INSTRUCTOR_FEE',
        'fee-2',
        'Salah pilih tipe kelas',
        true,
      ),
    );
  });

  it('hides the wrong-entry delete from roles other than Super Owner', async () => {
    const client = fakeMasterClient({
      listSettings: vi.fn().mockResolvedValue([fee({ deletable: false })]),
    });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );
    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    await screen.findByText('Sudah berlaku');
    expect(screen.queryByRole('button', { name: 'Hapus salah input' })).toBeNull();
  });

  it('deletes a quota & capacity setting through the shared dialog (reason first, then the server check)', async () => {
    mockDeletability.mockResolvedValue({ kind: 'min-quota', id: 'quota-1', deletable: true, blockers: [] });
    mockRemove.mockResolvedValue({ id: 'quota-1', deleted: true });
    const client = fakeMasterClient({
      listSettings: vi.fn().mockResolvedValue([
        {
          id: 'quota-1',
          kind: 'QUOTA_CAPACITY',
          businessKey: 'quota-1',
          branchId: 'branch-1',
          classTypeId: 'class-1',
          value: { minimumQuota: 3, defaultCapacity: 10 },
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          effectiveUntil: null,
          version: 1,
        },
      ]),
    });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="capacity" access={{ canManage: true, canFinance: false }} />
      </AppFeedbackProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Muat master data' }));
    await user.click(await screen.findByRole('button', { name: /Hapus pengaturan kuota Reformer Pilates/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus pengaturan kuota permanen?' });
    expect(within(dialog).getByRole('button', { name: 'Hapus permanen' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Alasan/), 'Kembali ke bawaan sistem');
    await user.click(within(dialog).getByRole('button', { name: 'Hapus permanen' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('min-quota', 'quota-1', 'Kembali ke bawaan sistem'));
  });

  it('hides the delete action without finance:manage', async () => {
    const client = fakeMasterClient({ listSettings: vi.fn().mockResolvedValue([fee({})]) });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: false }} />
      </AppFeedbackProvider>,
    );
    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    await screen.findByText('Akan berlaku');
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  });

  it('renders self-contained branch selector and ensures class types are populated in select form', async () => {
    const client = fakeMasterClient();
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    // Verify branch selector is visible inside the operational settings tab
    expect(screen.getByRole('combobox', { name: 'Pilih cabang operasional' })).toBeVisible();

    // Open create modal
    await user.click(screen.getByRole('button', { name: /\+ Atur honor baru/i }));

    // Verify SearchSelect for Tipe kelas has the class type option and is not empty
    const classTypeCombobox = screen.getByRole('combobox', { name: 'Tipe kelas' });
    expect(classTypeCombobox).toBeVisible();

    // Click to open dropdown and verify class type item appears
    await user.click(classTypeCombobox);
    expect(await screen.findByRole('option', { name: /Reformer Pilates/i })).toBeVisible();
  });

  it('provides default effective date and reason for direct save', async () => {
    const client = fakeMasterClient();
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: /\+ Atur honor baru/i }));

    const effectiveFromInput = screen.getByLabelText(/Efektif mulai/) as HTMLInputElement;
    const reasonInput = screen.getByLabelText(/Alasan perubahan/) as HTMLInputElement;

    expect(effectiveFromInput).toBeVisible();
    expect(reasonInput).toBeVisible();
  });

  it('allows editing existing setting directly from table row via edit modal', async () => {
    const client = fakeMasterClient({
      listSettings: vi.fn().mockResolvedValue([
        fee({
          id: 'fee-1',
          value: { feeRp: 150_000 },
        }),
      ]),
      createSetting: vi.fn().mockResolvedValue(undefined),
    });
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="fees" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /Honor/i }));
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(screen.getByText('Rp 150.000')).toBeVisible();

    // Click "Versi baru" button on the table row
    const editBtn = screen.getByRole('button', { name: 'Versi baru' });
    expect(editBtn).toBeVisible();
    await user.click(editBtn);

    // Edit modal opens
    expect(screen.getByRole('heading', { name: /Versi baru Honor Instruktur/i })).toBeVisible();
    const input = screen.getByLabelText(/Honor per sesi/i);
    expect(input).toHaveValue(150_000);

    // Modify fee amount and save
    await user.clear(input);
    await user.type(input, '175000');

    // Alasan tidak terisi otomatis: kosong dulu, wajib diisi pengguna.
    const reasonInput = screen.getByLabelText(/Alasan perubahan/i);
    expect(reasonInput).toHaveValue('');
    await user.type(reasonInput, 'Kenaikan honor 2026');
    await user.click(screen.getByRole('button', { name: 'Simpan versi baru' }));

    expect(client.createSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'INSTRUCTOR_FEE',
        value: 175_000,
        reason: 'Kenaikan honor 2026',
      }),
    );
    expect(await screen.findByText('Konfigurasi berhasil diperbarui.')).toBeVisible();
  });


  const openClassTypeMenu = async (client: MasterClient, itemName: RegExp) => {
    const user = userEvent.setup();
    render(
      <AppFeedbackProvider>
        <MasterView client={client} activeTab="classTypes" access={{ canManage: true, canFinance: true }} />
      </AppFeedbackProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Muat master data' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Muat master data' }));
    expect(await screen.findByText('Reformer Pilates')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Aksi tipe kelas Reformer Pilates/ }));
    await user.click(screen.getByRole('menuitem', { name: itemName }));
    return user;
  };

  it('asks the server for every non-archived class type (inactive ones included)', async () => {
    const client = fakeMasterClient();
    await openClassTypeMenu(client, /^Nonaktifkan$/);
    const calls = vi.mocked(client.listClassTypes).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, status] of calls) expect(status).toBe('ALL');
  });

  it('deactivates a class type with an optional reason and passes it on', async () => {
    const client = fakeMasterClient();
    const user = await openClassTypeMenu(client, /^Nonaktifkan$/);
    const confirm = await screen.findByRole('button', { name: 'Nonaktifkan' });
    expect(confirm).toBeEnabled();
    await user.type(screen.getByLabelText(/^Alasan/), 'Kelas tidak dibuka lagi');
    await user.click(confirm);
    await waitFor(() =>
      expect(client.deactivateClassType).toHaveBeenCalledWith('class-1', 0, 'Kelas tidak dibuka lagi'),
    );
  });

  it('archives a class type through the lifecycle endpoint with a reason', async () => {
    mockArchive.mockResolvedValue({});
    const client = fakeMasterClient();
    const user = await openClassTypeMenu(client, /Arsipkan/);
    await user.type(await screen.findByLabelText(/^Alasan/), 'Tidak dipakai lagi');
    await user.click(screen.getByRole('button', { name: 'Arsipkan' }));
    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('class-type', 'class-1', 'Tidak dipakai lagi'));
  });

  it('explains what still uses a class type instead of deleting it', async () => {
    mockDeletability.mockResolvedValue({
      kind: 'class-type',
      id: 'class-1',
      deletable: false,
      blockers: [
        { kind: 'paket', label: 'paket', count: 2 },
        { kind: 'slot_kelas', label: 'jadwal kelas', count: 8 },
      ],
    });
    await openClassTypeMenu(fakeMasterClient(), /Hapus/);
    expect(await screen.findByText('Tipe kelas belum dapat dihapus')).toBeVisible();
    expect(screen.getByText('Jadwal kelas')).toBeVisible();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('deletes a clean class type with a reason', async () => {
    mockDeletability.mockResolvedValue({ kind: 'class-type', id: 'class-1', deletable: true, blockers: [] });
    mockRemove.mockResolvedValue({ id: 'class-1', deleted: true });
    const user = await openClassTypeMenu(fakeMasterClient(), /Hapus/);
    await user.type(await screen.findByLabelText(/^Alasan/), 'Salah input');
    await user.click(screen.getByRole('button', { name: 'Hapus permanen' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('class-type', 'class-1', 'Salah input'));
  });
});
