'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck2, Plus, RefreshCw, Search } from 'lucide-react';
import {
  bookingFailure,
  browserBookingClient,
  type BookingClient,
  type BookingCustomer,
  type ClassSlot,
  type CheckInIssue,
  type CustomerBookingRecord,
  type CustomerPackageBalance,
  type ManagementReschedule,
} from '@/api-clients/booking-client';
import { EmptyState, Feedback, Skeleton, StatusBadge } from '../ui';
import { AdminPageHeader } from '../components/admin/admin-page-header';
import { useActiveBranchState, useSessionContext } from '../session-context';
import { DateInput, SearchInput, SearchSelect, SelectInput } from '../components/forms';
import { Button, actionClasses } from '../components/actions';
import { Drawer, Modal, useAppFeedback } from '../components/app-feedback';
import { ReasonDialog } from '../components/admin/reason-dialog';
import {
  Badge,
  DataTable,
  FilterBar,
  Pagination,
  Panel,
  StatCard,
  TableActionMenu,
  Tabs,
} from '../components/admin/admin-ui';
import { ADMIN_PAGE_SIZE, pageOffset } from '../lib/pagination';
import { timezoneLabel } from '../classes/class-slot-presenters';

const newIntentKey = () => crypto.randomUUID();
const shortId = (id: string) => id.slice(0, 8);

export function BookingView({
  client = browserBookingClient,
  activeBranchId,
  access,
  initialTab = 'bookings',
  onTabChange,
  initialFilters,
  onFiltersChange,
  initialCursor,
  onCursorChange,
  initialRescheduleCursor,
  onRescheduleCursorChange,
}: {
  client?: BookingClient;
  activeBranchId?: string;
  access?: {
    canRead: boolean;
    canCreate: boolean;
    canReview: boolean;
    canDecide: boolean;
    canCancel?: boolean;
  };
  initialTab?: 'bookings' | 'reschedules' | 'attendance';
  onTabChange?(value: 'bookings' | 'reschedules' | 'attendance'): void;
  initialFilters?: {
    q?: string;
    status?: string;
    from?: string;
    until?: string;
    classSlotId?: string;
    rosterStatus?: string;
  };
  onFiltersChange?(value: {
    q: string;
    status: string;
    from: string;
    until: string;
    classSlotId: string;
    rosterStatus: string;
  }): void;
  initialCursor?: string;
  onCursorChange?(cursor?: string): void;
  initialRescheduleCursor?: string;
  onRescheduleCursorChange?(cursor?: string): void;
}) {
  const [contextBranchId, setContextBranchId] = useActiveBranchState();
  const branchId = activeBranchId ?? contextBranchId;
  const sessionContext = useSessionContext();
  const [pickBranchOpen, setPickBranchOpen] = useState(false);
  const [pickedBranchId, setPickedBranchId] = useState('');
  const feedback = useAppFeedback();
  const fixtureClient = client !== browserBookingClient;
  const injectedAccess =
    access ??
    (fixtureClient && activeBranchId !== undefined
      ? { canRead: true, canCreate: true, canReview: true, canDecide: true }
      : undefined);
  const canRead =
    injectedAccess?.canRead ??
    (sessionContext?.status === 'authenticated' && sessionContext.hasCapability('booking:read'));
  const canCreate =
    injectedAccess?.canCreate ??
    (sessionContext?.status === 'authenticated' &&
      sessionContext.hasCapability('booking:create:assisted'));
  const canReview =
    injectedAccess?.canReview ??
    (sessionContext?.status === 'authenticated' && sessionContext.hasCapability('reschedule:read'));
  const canDecide =
    injectedAccess?.canDecide ??
    (sessionContext?.status === 'authenticated' &&
      sessionContext.hasCapability('reschedule:decide'));
  // Pembatalan atas nama pelanggan (izin API `booking:cancel:assisted`; batas H-24 berlaku).
  const canCancelBookings =
    injectedAccess?.canCancel ??
    Boolean(
      sessionContext?.status === 'authenticated' &&
        sessionContext.hasCapability('booking:cancel:assisted'),
    );
  const canManageAttendance =
    injectedAccess?.canCreate ??
    (sessionContext?.status === 'authenticated' &&
      sessionContext.hasCapability('attendance:manage'));
  const [customers, setCustomers] = useState<BookingCustomer[]>([]);
  const [packages, setPackages] = useState<CustomerPackageBalance[]>([]);
  const [slots, setSlots] = useState<ClassSlot[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [items, setItems] = useState<CustomerBookingRecord[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    booked: 0,
    reschedulePending: 0,
    attended: 0,
    cancelled: 0,
    noShow: 0,
  });
  const [statusFilter, setStatusFilter] = useState(initialFilters?.status ?? '');
  const [search, setSearch] = useState(initialFilters?.q ?? '');
  const [from, setFrom] = useState(initialFilters?.from ?? '');
  const [until, setUntil] = useState(initialFilters?.until ?? '');
  const [rosterSlotId, setRosterSlotId] = useState(initialFilters?.classSlotId ?? '');
  const [rosterStatus, setRosterStatus] = useState(initialFilters?.rosterStatus ?? '');
  const [selectedRosterIds, setSelectedRosterIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'bookings' | 'reschedules' | 'attendance'>(initialTab);
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(initialCursor);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [reschedules, setReschedules] = useState<ManagementReschedule[]>([]);
  const [rescheduleCursor, setRescheduleCursor] = useState<string | null>();
  const [reviewId, setReviewId] = useState('');
  const [rejectionCode, setRejectionCode] = useState<
    'TARGET_UNAVAILABLE' | 'OUTSIDE_POLICY' | 'OUT_OF_SCOPE'
  >('TARGET_UNAVAILABLE');
  const [busy, setBusy] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CustomerBookingRecord | null>(null);
  const [cancelError, setCancelError] = useState('');
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const createDirty = Boolean(customerId || packageId || slotId);
  const [checkInIssues, setCheckInIssues] = useState<Record<string, CheckInIssue>>({});
  const [qrModalData, setQrModalData] = useState<{
    booking: CustomerBookingRecord;
    issue: CheckInIssue;
  } | null>(null);
  const [qrCopied, setQrCopied] = useState(false);
  const intentKey = useRef(newIntentKey());
  const decisionKey = useRef(newIntentKey());
  const lastFilterSignature = useRef(
    JSON.stringify({
      q: initialFilters?.q ?? '',
      status: initialFilters?.status ?? '',
      from: initialFilters?.from ?? '',
      until: initialFilters?.until ?? '',
      classSlotId: initialFilters?.classSlotId ?? '',
      rosterStatus: initialFilters?.rosterStatus ?? '',
    }),
  );

  useEffect(() => setActiveTab(initialTab), [initialTab]);
  useEffect(() => setCursor(initialCursor), [initialCursor]);
  useEffect(() => {
    const next = {
      q: initialFilters?.q ?? '',
      status: initialFilters?.status ?? '',
      from: initialFilters?.from ?? '',
      until: initialFilters?.until ?? '',
      classSlotId: initialFilters?.classSlotId ?? '',
      rosterStatus: initialFilters?.rosterStatus ?? '',
    };
    lastFilterSignature.current = JSON.stringify(next);
    setSearch(next.q);
    setStatusFilter(next.status);
    setFrom(next.from);
    setUntil(next.until);
    setRosterSlotId(next.classSlotId);
    setRosterStatus(next.rosterStatus);
  }, [
    initialFilters?.classSlotId,
    initialFilters?.from,
    initialFilters?.q,
    initialFilters?.rosterStatus,
    initialFilters?.status,
    initialFilters?.until,
  ]);
  useEffect(() => {
    if (!onFiltersChange) return;
    const value = {
      q: search.trim(),
      status: statusFilter,
      from,
      until,
      classSlotId: rosterSlotId,
      rosterStatus,
    };
    const signature = JSON.stringify(value);
    if (signature === lastFilterSignature.current) return;
    setCursor(undefined);
    setCursorHistory([]);
    setPage(1);
    const timer = window.setTimeout(() => {
      lastFilterSignature.current = signature;
      onFiltersChange(value);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [from, onFiltersChange, rosterSlotId, rosterStatus, search, statusFilter, until]);

  const resetIntent = () => {
    intentKey.current = newIntentKey();
    setMessage(undefined);
    setFailure(undefined);
  };

  useEffect(() => {
    setCustomers([]);
    setPackages([]);
    setSlots([]);
    setItems([]);
    setNextCursor(undefined);
    setReschedules([]);
    setRescheduleCursor(undefined);
    setReviewId('');
    setCustomerId('');
    setPackageId('');
    setSlotId('');
    setSelectedRosterIds([]);
    setInitialLoaded(false);
    resetIntent();
  }, [branchId]);

  useEffect(() => {
    if (createOpen && branchId && customers.length === 0) {
      client
        .discover(branchId)
        .then((discovery) => {
          setCustomers(discovery.customers);
          setPackages(discovery.packages);
          setSlots(discovery.slots);
        })
        .catch(() => {});
    }
  }, [createOpen, branchId, customers.length, client]);

  const customerPackages = useMemo(
    () =>
      packages.filter(
        (item) =>
          (item.customerUserId ?? (item as any).customer?.id) === customerId ||
          (item.isShareable &&
            Array.isArray(item.sharedMembers) &&
            item.sharedMembers.some((m: any) => m.userId === customerId)),
      ),
    [customerId, packages],
  );
  const selectedPackage = packages.find(({ id }) => id === packageId);
  const eligibleSlots = useMemo(
    () =>
      slots.filter(
        (slot) =>
          !selectedPackage?.classTypeId || slot.classTypeId === selectedPackage.classTypeId,
      ),
    [selectedPackage, slots],
  );
  const selectedSlot = slots.find(({ id }) => id === slotId);
  const selectedCustomer = customers.find(({ id }) => id === customerId);

  const loadWorkspace = async () => {
    if (!canRead) return;
    setBusy(true);
    setFailure(undefined);
    setMessage(undefined);
    try {
      const [bookingPage, reschedulePage] = await Promise.all([
        client.list({
          branchId: branchId || undefined,
          status:
            activeTab === 'attendance' ? rosterStatus || undefined : statusFilter || undefined,
          q: search.trim() || undefined,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          until: until ? new Date(`${until}T23:59:59.999`).toISOString() : undefined,
          page,
          limit: ADMIN_PAGE_SIZE,
          cursor: cursor || undefined,
          classSlotId: activeTab === 'attendance' ? rosterSlotId || undefined : undefined,
        }),
        canReview
          ? client.listReschedules({
              branchId: branchId || undefined,
              status: 'PENDING',
              cursor: initialRescheduleCursor,
            })
          : Promise.resolve({ items: [], nextCursor: null }),
      ]);
      setItems(bookingPage.items);
      if (bookingPage.summary) setSummary(bookingPage.summary);
      setNextCursor(bookingPage.nextCursor);
      if (bookingPage.totalPages) setTotalPages(bookingPage.totalPages);
      if (typeof bookingPage.total === 'number') setTotalItems(bookingPage.total);
      else if (bookingPage.summary?.total) setTotalItems(bookingPage.summary.total);
      setReschedules(reschedulePage.items);
      setRescheduleCursor(reschedulePage.nextCursor);
      setMessage('Data booking siap digunakan.');
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
      setInitialLoaded(true);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
    // Data follows global branch and the active status filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    branchId,
    statusFilter,
    search,
    from,
    until,
    rosterSlotId,
    rosterStatus,
    activeTab,
    canRead,
    page,
    cursor,
    initialRescheduleCursor,
  ]);

  const loadMoreReschedules = async () => {
    if (!rescheduleCursor || !canReview) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const cursor = rescheduleCursor;
      const page = await client.listReschedules({
        branchId: branchId || undefined,
        status: 'PENDING',
        cursor,
      });
      setReschedules((current) => [
        ...current,
        ...page.items.filter((item) => !current.some(({ id }) => id === item.id)),
      ]);
      setRescheduleCursor(page.nextCursor);
      onRescheduleCursorChange?.(cursor);
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const decideReschedule = async (decision: 'approve' | 'reject') => {
    const selected = reschedules.find(({ id }) => id === reviewId);
    if (!selected || !canDecide || !branchId) return;
    setBusy(true);
    setFailure(undefined);
    setMessage(undefined);
    try {
      const result = await client.decideReschedule(
        selected.id,
        decision,
        {
          reasonCode: decision === 'approve' ? 'ELIGIBILITY_VERIFIED' : rejectionCode,
          expectedVersion: selected.version,
        },
        decisionKey.current,
      );
      setReschedules((current) => current.filter(({ id }) => id !== selected.id));
      await loadWorkspace();
      setReviewId('');
      setMessage(
        result.idempotentReplay
          ? 'Permintaan reschedule ini sudah pernah diproses sebelumnya.'
          : decision === 'approve'
            ? 'Reschedule disetujui dan jadwal booking berhasil dipindahkan.'
            : 'Reschedule ditolak; booking tetap berada pada kelas semula.',
      );
      decisionKey.current = newIntentKey();
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const openNextPage = () => {
    if ((!nextCursor && page >= totalPages) || busy) return;
    setCursorHistory((current) => [...current, cursor ?? '']);
    setCursor(nextCursor ?? undefined);
    setPage((current) => current + 1);
    onCursorChange?.(nextCursor ?? undefined);
  };

  const openPreviousPage = () => {
    if ((cursorHistory.length === 0 && page <= 1) || busy) return;
    const previous = cursorHistory.at(-1) ?? '';
    setCursorHistory((current) => current.slice(0, -1));
    setCursor(previous || undefined);
    setPage((current) => Math.max(1, current - 1));
    onCursorChange?.(previous || undefined);
  };

  const submit = async () => {
    if (!selectedPackage || !selectedSlot || !selectedCustomer) return;
    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Buat booking manual?',
      message: `${selectedCustomer.displayName} akan memperoleh satu reservasi pada kelas terpilih dan saldo tersedia berkurang satu sesi.`,
      confirmLabel: 'Buat booking',
    });
    if (!accepted) return;
    setBusy(true);
    setFailure(undefined);
    setMessage(undefined);
    try {
      const booking = await client.create(
        {
          classSlotId: selectedSlot.id,
          customerPackageId: selectedPackage.id,
          customerUserId: selectedCustomer.id,
          source: 'ADMIN_ASSISTED',
        },
        intentKey.current,
      );
      await loadWorkspace();
      setMessage(
        booking.idempotentReplay
          ? 'Booking sudah pernah dibuat sebelumnya (tidak ada reservasi ganda).'
          : 'Booking dibuat; satu sesi telah direservasi.',
      );
      intentKey.current = newIntentKey();
      setCustomerId('');
      setPackageId('');
      setSlotId('');
      setCreateOpen(false);
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };
  const confirmDiscardCreate = () =>
    feedback.confirm({
      tone: 'warning',
      title: 'Batalkan booking manual?',
      message: 'Pilihan pelanggan, paket, dan kelas akan dikosongkan.',
      confirmLabel: 'Buang pilihan',
    });
  const closeCreate = async () => {
    if (!createDirty || (await confirmDiscardCreate())) {
      setCustomerId('');
      setPackageId('');
      setSlotId('');
      setCreateOpen(false);
    }
  };

  /** Buka dialog batal hanya bila API menyatakan bisa; setelah batas H-24 jalurnya Penyesuaian Sesi. */
  const requestCancel = async (booking: CustomerBookingRecord) => {
    setCancelError('');
    if (client.cancellationOptions) {
      try {
        const options = await client.cancellationOptions(booking.id);
        if (!options.canCancel) {
          feedback.showToast({
            tone: 'warning',
            title: 'Booking ini tidak bisa dibatalkan dari sini',
            message:
              options.unavailableReason === 'CANCELLATION_CUTOFF_PASSED'
                ? 'Batas H-24 sudah lewat. Gunakan Penyesuaian Sesi di menu Ledger sesi.'
                : 'Status booking atau kelas sudah tidak memungkinkan pembatalan.',
          });
          return;
        }
      } catch {
        // Tidak diketahui: dialog tetap dibuka dan server yang memutuskan dengan pesan yang jelas.
      }
    }
    setCancelTarget(booking);
  };

  const cancelBooking = async (reason: string) => {
    if (!cancelTarget || !client.cancelAsStaff) return;
    setBusy(true);
    setCancelError('');
    try {
      await client.cancelAsStaff(cancelTarget.id, reason, crypto.randomUUID());
      setCancelTarget(null);
      await loadWorkspace();
      setMessage('Booking dibatalkan. Kursi kembali tersedia dan sesi pelanggan tidak terpotong.');
    } catch (error) {
      setCancelError(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const issueCheckIn = async (booking: CustomerBookingRecord) => {
    if (!canManageAttendance || !branchId || booking.status !== 'BOOKED') return;
    setBusy(true);
    setFailure(undefined);
    try {
      if (!client.issueCheckIn) return;
      const issue = await client.issueCheckIn(booking.id, booking.version, crypto.randomUUID());
      setCheckInIssues((current) => ({ ...current, [booking.id]: issue }));
      setQrModalData({ booking, issue });
      setMessage(
        issue.idempotentReplay
          ? 'Pass QR sebelumnya ditemukan kembali.'
          : 'Pass QR berhasil dibuat.',
      );
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const issueBulkCheckIn = async () => {
    if (!canManageAttendance || !branchId || !rosterSlotId || selectedRosterIds.length === 0)
      return;
    if (!client.issueBulkCheckIns) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await client.issueBulkCheckIns(
        rosterSlotId,
        selectedRosterIds,
        newIntentKey(),
      );
      const successes = result.items.filter((item) => item.ok && item.result);
      setCheckInIssues((current) => {
        const next = { ...current };
        for (const item of successes) next[item.bookingId] = item.result!;
        return next;
      });
      setSelectedRosterIds([]);
      const failed = result.items.length - successes.length;
      setMessage(
        failed
          ? `${successes.length} QR diterbitkan, ${failed} peserta memerlukan peninjauan.`
          : `${successes.length} QR berhasil diterbitkan.`,
      );
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const revokeCheckIn = async (booking: CustomerBookingRecord) => {
    const token = booking.checkInToken;
    if (
      !canManageAttendance ||
      !branchId ||
      !token ||
      token.status !== 'ACTIVE' ||
      !client.revokeCheckIn
    )
      return;
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await client.revokeCheckIn(
        token.id,
        token.version,
        'QR tidak lagi diperlukan oleh operasional',
        newIntentKey(),
      );
      setCheckInIssues((current) => ({ ...current, [booking.id]: result }));
      setMessage('QR berhasil dicabut.');
    } catch (error) {
      setFailure(await bookingFailure(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-5" aria-labelledby="bookings-title">
      <AdminPageHeader
        title="Manajemen Booking"
        titleId="bookings-title"
        description="Pilih pelanggan, paket, dan kelas yang tersedia. Sistem otomatis memvalidasi batas waktu, saldo sesi, kapasitas kelas, dan izin akses saat konfirmasi."
        actions={
          <>
            {/* Nilai sebenarnya ada di RESCHEDULE_CUTOFF_HOURS (bawaan 24) dan belum pernah
                dikirim ke web, jadi angka di sini masih ditulis tetap. Begitu konfigurasi itu
                diekspos, ganti dengan nilai dari server agar label tidak bisa melenceng dari
                aturan yang benar-benar ditegakkan. */}
            <StatusBadge tone="warning">Batas reschedule 24 jam</StatusBadge>
            <Button
              type="button"
              variant="secondary"
              leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
              disabled={busy || !canRead}
              onClick={() => void loadWorkspace()}
            >
              Segarkan
            </Button>
            {canCreate && (
              <Button
                type="button"
                leadingIcon={<Plus className="size-4" aria-hidden="true" />}
                onClick={() => (branchId ? setCreateOpen(true) : setPickBranchOpen(true))}
              >
                Buat booking manual
              </Button>
            )}
          </>
        }
      />
      {!branchId && canCreate && (
        <Panel className="border-dd-brass/40 bg-dd-brass-soft/35 p-4 text-sm text-dd-warning">
          Anda sedang melihat semua cabang. Saat membuat booking, Anda akan diminta memilih cabang terlebih dahulu. Untuk memproses reschedule atau menerbitkan QR check-in, pilih cabang pada pemilih di bagian atas halaman.
        </Panel>
      )}
      {!canRead && (
        <Feedback kind="error">Anda tidak memiliki akses untuk melihat booking.</Feedback>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total booking"
          value={summary.total.toLocaleString('id-ID')}
          loading={!initialLoaded || (busy && items.length === 0)}
        />
        <StatCard
          label="Aktif"
          value={summary.booked.toLocaleString('id-ID')}
          tone="success"
          loading={!initialLoaded || (busy && items.length === 0)}
        />
        <StatCard
          label="Reschedule"
          value={summary.reschedulePending.toLocaleString('id-ID')}
          tone="warning"
          loading={!initialLoaded || (busy && items.length === 0)}
        />
        <StatCard
          label="Sudah hadir"
          value={summary.attended.toLocaleString('id-ID')}
          loading={!initialLoaded || (busy && items.length === 0)}
        />
      </div>

      <Tabs
        value={activeTab}
        onChange={(value) => {
          const next = value as 'bookings' | 'reschedules' | 'attendance';
          setCursor(undefined);
          setCursorHistory([]);
          setActiveTab(next);
          onTabChange?.(next);
        }}
        items={[
          { value: 'bookings', label: 'Booking', count: summary.total },
          {
            value: 'reschedules',
            label: 'Antrean Reschedule',
            count: summary.reschedulePending,
          },
          ...(sessionContext?.hasCapability('attendance:read')
            ? [{ value: 'attendance', label: 'Check-in & Kehadiran', count: summary.attended }]
            : []),
        ]}
      />

      {activeTab === 'bookings' && (
        <FilterBar>
          <SearchInput
            label="Cari booking"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pelanggan, paket, kelas, atau studio"
            leadingIcon={<Search className="size-4" aria-hidden="true" />}
            wrapperClassName="min-w-64 flex-1"
          />
          <SelectInput
            label="Status booking"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            wrapperClassName="min-w-48"
          >
            <option value="">Semua status</option>
            <option value="BOOKED">Aktif</option>
            <option value="RESCHEDULE_PENDING">Menunggu reschedule</option>
            <option value="ATTENDED">Sudah hadir</option>
            <option value="CANCELLED">Dibatalkan</option>
            <option value="NO_SHOW">Tidak hadir</option>
          </SelectInput>
          <DateInput
            label="Dari tanggal"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            wrapperClassName="min-w-44"
          />
          <DateInput
            label="Sampai tanggal"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            wrapperClassName="min-w-44"
          />
          {(search || statusFilter || from || until) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setFrom('');
                setUntil('');
              }}
            >
              Reset filter
            </Button>
          )}
        </FilterBar>
      )}

      <ReasonDialog
        open={Boolean(cancelTarget)}
        title="Batalkan booking pelanggan?"
        description={
          cancelTarget
            ? `Pemesanan #${cancelTarget.bookingNumber || cancelTarget.id.slice(0, 8)} · ${cancelTarget.customer?.displayName ?? 'Pelanggan'} · ${cancelTarget.classSlot?.classType.name ?? 'Kelas'}`
            : undefined
        }
        label="Alasan pembatalan"
        confirmLabel="Batalkan booking"
        tone="danger"
        minLength={10}
        maxLength={200}
        busy={busy}
        error={cancelError}
        onCancel={() => setCancelTarget(null)}
        onConfirm={(reason) => void cancelBooking(reason)}
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 space-y-2 text-xs">
          <strong className="block text-[13px] font-bold text-amber-900">
            Rincian Dampak Operasional:
          </strong>
          <ul className="list-disc pl-4 space-y-1 text-amber-800">
            <li>1 sesi kuota dikembalikan ke paket aktif pelanggan.</li>
            <li>1 kursi kuota kelas langsung dibuka kembali untuk pemesanan lain.</li>
            <li>Aksi ini dicatat permanen dalam jejak audit beserta identitas staf dan timestamp.</li>
          </ul>
        </div>
      </ReasonDialog>
      <Modal
        open={pickBranchOpen}
        title="Pilih cabang"
        description="Booking manual dibuat untuk satu cabang. Pilih cabang tempat kelas berlangsung."
        onClose={() => setPickBranchOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPickBranchOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              disabled={!pickedBranchId}
              onClick={() => {
                setContextBranchId(pickedBranchId);
                setPickBranchOpen(false);
                setCreateOpen(true);
              }}
            >
              Lanjutkan
            </Button>
          </div>
        }
      >
        <SelectInput
          label="Cabang"
          value={pickedBranchId}
          onChange={(event) => setPickedBranchId(event.target.value)}
        >
          <option value="">Pilih cabang</option>
          {(sessionContext?.session?.branches ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectInput>
      </Modal>
      <Modal
        open={Boolean(qrModalData)}
        title="QR Pass & Kirim WhatsApp"
        description={`QR Pass untuk ${qrModalData?.booking.customer?.displayName ?? 'Peserta'} pada kelas ${qrModalData?.booking.classSlot?.classType.name ?? ''}.`}
        onClose={() => {
          setQrModalData(null);
          setQrCopied(false);
        }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQrModalData(null);
                setQrCopied(false);
              }}
            >
              Tutup
            </Button>
            {qrModalData?.issue.passUrl && (
              <Button
                type="button"
                variant="secondary"
                data-testid="btn-copy-qr-link"
                onClick={() => {
                  void navigator.clipboard.writeText(qrModalData.issue.passUrl ?? '');
                  setQrCopied(true);
                  setTimeout(() => setQrCopied(false), 2000);
                }}
              >
                {qrCopied ? 'Tersalin!' : 'Salin Link Pass'}
              </Button>
            )}
            {(() => {
              const waLink =
                qrModalData?.issue.whatsappUrl ||
                (qrModalData?.issue.passUrl
                  ? `https://wa.me/?text=${encodeURIComponent(
                      `Halo ${qrModalData.booking.customer?.displayName ?? ''}, berikut adalah link QR Pass Check-in untuk kelas Pilates Anda di Daily Dose:\n\n${qrModalData.issue.passUrl}\n\nTunjukkan QR ini kepada staf di meja resepsionis saat tiba di studio. Sampai jumpa di kelas!`
                    )}`
                  : null);
              return waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="btn-open-wa"
                  className="inline-flex min-h-11 items-center justify-center rounded-dd-md bg-[#25D366] hover:bg-[#20ba5a] px-4 text-xs font-bold text-white no-underline shadow-sm transition"
                >
                  Kirim via WhatsApp ↗
                </a>
              ) : null;
            })()}
          </div>
        }
      >
        {qrModalData && (
          <div className="space-y-4 text-sm">
            <div className="rounded-dd-md border border-dd-line bg-dd-surface-muted p-3">
              <p className="text-xs text-dd-muted">Link Pass Check-in:</p>
              <p className="font-mono text-xs text-dd-ink break-all select-all mt-1">
                {qrModalData.issue.passUrl ?? 'Belum tersedia'}
              </p>
            </div>
            <p className="text-xs text-dd-muted leading-relaxed">
              Klik tombol <strong>Kirim via WhatsApp ↗</strong> di bawah untuk langsung membuka chat WhatsApp dengan pesan berisi QR Pass ke peserta. Anda juga dapat menyalin tautan pass secara langsung.
            </p>
          </div>
        )}
      </Modal>
      <Drawer
        open={createOpen && canCreate && Boolean(branchId)}
        title="Buat booking manual"
        description="Pilih pelanggan, paket aktif, dan kelas dalam cabang operasional."
        busy={busy}
        dirty={createDirty}
        onDirtyClose={confirmDiscardCreate}
        onClose={() => {
          setCustomerId('');
          setPackageId('');
          setSlotId('');
          setCreateOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void closeCreate()}
              disabled={busy}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="assisted-booking-form"
              loading={busy}
              disabled={!selectedPackage || !selectedSlot || !selectedCustomer}
              leadingIcon={<Plus className="size-4" aria-hidden="true" />}
            >
              Konfirmasi booking satu sesi
            </Button>
          </div>
        }
      >
        <form
          id="assisted-booking-form"
          className="grid gap-4"
          aria-label="Buat booking bantuan"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm leading-6 text-dd-muted">
            Pilih pelanggan, paket aktif, dan kelas dalam cabang{' '}
            <strong>{sessionContext?.activeBranch?.name ?? 'aktif'}</strong>. Sistem otomatis
            memastikan sisa sesi member mencukupi dan kapasitas kelas masih tersedia.
          </p>
          <SearchSelect
            label="Pelanggan"
            value={customerId}
            disabled={busy || customers.length === 0}
            placeholder="Pilih pelanggan"
            options={customers.map((customer) => ({
              id: customer.id,
              label: customer.displayName,
              description:
                customer.phoneMasked ??
                `${customer.eligiblePackageCount ?? 0} paket dapat digunakan`,
            }))}
            onChange={async (value) => {
              setCustomerId(value);
              setPackageId('');
              setSlotId('');
              resetIntent();
              if (value && client.getCustomerPackages) {
                try {
                  const customerPkgs = await client.getCustomerPackages(value, branchId || undefined);
                  setPackages((prev) => {
                    const others = prev.filter(
                      (p) => (p.customerUserId ?? (p as any).customer?.id) !== value,
                    );
                    return [...others, ...customerPkgs];
                  });
                } catch (err) {
                  console.error('Gagal memuat paket pelanggan:', err);
                }
              }
            }}
          />
          <SearchSelect
            label="Paket pelanggan"
            value={packageId}
            disabled={busy || !customerId || customerPackages.length === 0}
            placeholder="Pilih paket aktif"
            options={customerPackages.map((item) => {
              const isShared = (item.customerUserId ?? (item as any).customer?.id) !== customerId;
              const ownerPrefix = isShared
                ? `[Paket Bersama: ${(item.customer as any)?.displayName ?? (item.customer as any)?.name ?? 'Pemilik'}] `
                : '';
              return {
                id: item.id,
                label: `${ownerPrefix}${item.packageName ?? item.name ?? 'Paket Aktif'} · ${item.available} sesi tersedia`,
                description: item.classTypeName
                  ? `${item.classTypeName} · Berlaku s/d ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(item.expiryAt)}`
                  : `${item.reserved ?? 0} sesi direservasi`,
              };
            })}
            onChange={(value) => {
              setPackageId(value);
              setSlotId('');
              resetIntent();
            }}
          />
          <SearchSelect
            label="Kelas"
            value={slotId}
            disabled={busy || !packageId || eligibleSlots.length === 0}
            placeholder="Pilih jadwal kelas"
            options={eligibleSlots.map((slot) => {
              const timeStr = new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: slot.timezone,
              }).format(slot.startAt);
              const instructorName = (slot as any).instructor?.displayName ?? (slot as any).instructorName;
              const roomName = (slot as any).room?.name ?? (slot as any).roomName ?? (slot as any).studio?.name;
              return {
                id: slot.id,
                label: `${(slot as any).classType?.name ?? 'Kelas'} · ${timeStr}`,
                description: `${roomName ? `${roomName} · ` : ''}${instructorName ? `${instructorName} · ` : ''}${slot.bookedCount}/${slot.capacity} peserta`,
              };
            })}
            onChange={(value) => {
              setSlotId(value);
              resetIntent();
            }}
          />
          {customerId && customerPackages.length === 0 && (
            <Feedback kind="status">
              Pelanggan ini belum memiliki paket aktif dengan saldo sesi tersedia untuk cabang ini. Silakan catat pembelian paket terlebih dahulu melalui menu Pembayaran.
            </Feedback>
          )}
          {packageId && eligibleSlots.length === 0 && (
            <Feedback kind="status">Tidak ada jadwal kelas yang sesuai dengan tipe paket ini.</Feedback>
          )}
          {selectedPackage && selectedSlot && selectedCustomer && (
            <Panel
              className="border-dd-warning/30 bg-dd-warning-soft p-4 text-sm text-dd-warning"
              aria-label="Konsekuensi reservasi"
            >
              <strong className="mb-1 block">Konsekuensi reservasi</strong>
              <strong>{selectedCustomer.displayName}</strong> akan memakai paket aktif untuk kelas
              pada{' '}
              {new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: selectedSlot.timezone,
              }).format(selectedSlot.startAt)}{' '}
              ({timezoneLabel(selectedSlot.timezone)}). Saldo tersedia berubah dari {selectedPackage.available}{' '}
              menjadi {selectedPackage.available - 1}; kapasitas menjadi{' '}
              {selectedSlot.bookedCount + 1}/{selectedSlot.capacity}. Tidak ada pemotongan saldo sesi permanen pada tahap booking (sesi hanya direservasi sementara).
            </Panel>
          )}
        </form>
      </Drawer>

      {busy && <Skeleton label="Memproses booking" />}
      {failure && <Feedback kind="error">{failure}</Feedback>}
      {message && !busy && <Feedback kind="status">{message}</Feedback>}
      {canReview && activeTab === 'reschedules' && (
        <section aria-labelledby="reschedule-queue-title">
          <div className="mb-4">
            <h2 id="reschedule-queue-title" className="text-xl font-semibold text-dd-ink">
              Antrean reschedule
            </h2>
            <p className="mt-1 text-sm text-dd-muted">
              Permintaan tertua ditinjau lebih dahulu. Pilih cabang untuk mengambil keputusan.
            </p>
          </div>
          {reschedules.length === 0 ? (
            <EmptyState
              title="Tidak ada permintaan reschedule tertunda"
              description="Permintaan member yang masih menunggu persetujuan akan tampil di sini."
            />
          ) : (
            <ul className="grid gap-3" aria-label="Antrean reschedule">
              {reschedules.map((reschedule) => {
                const source =
                  reschedule.sourceClassSlot ??
                  slots.find(({ id }) => id === reschedule.sourceClassSlotId);
                const target =
                  reschedule.targetClassSlot ??
                  slots.find(({ id }) => id === reschedule.targetClassSlotId);
                return (
                  <li
                    key={reschedule.id}
                    className="rounded-dd-lg border border-dd-line bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong className="block">
                          {reschedule.customer?.displayName ?? 'Pelanggan'}
                        </strong>
                        <span className="mt-1 block text-xs text-dd-muted">
                          {reschedule.customer?.phoneMasked ?? 'Kontak termasking'} ·{' '}
                          {reschedule.branch?.name ?? 'Cabang'} ·{' '}
                          {reschedule.package?.name ?? 'Paket pelanggan'}
                        </span>
                      </div>
                      <Badge tone="warning">Menunggu keputusan</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 rounded-dd-md bg-dd-surface-muted p-3 text-sm sm:grid-cols-2">
                      <div>
                        <span className="block text-xs text-dd-muted">Jadwal asal</span>
                        <strong>
                          {source
                            ? formatBookingTime(source.startAt, source.timezone)
                            : 'Kelas sumber'}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-xs text-dd-muted">Jadwal tujuan</span>
                        <strong>
                          {target
                            ? formatBookingTime(target.startAt, target.timezone)
                            : 'Kelas tujuan'}
                        </strong>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-dd-muted">
                        Diajukan {formatBookingTime(reschedule.requestedAt, 'Asia/Jakarta')}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canDecide || !branchId || busy}
                        title={!branchId ? 'Pilih cabang untuk mengambil keputusan' : undefined}
                        onClick={() => {
                          setReviewId(reschedule.id);
                          decisionKey.current = newIntentKey();
                        }}
                      >
                        Tinjau reschedule
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {rescheduleCursor && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void loadMoreReschedules()}
            >
              Muat reschedule berikutnya
            </Button>
          )}
          {reviewId && (
            <Panel
              className="grid gap-4 border-dd-warning/30 bg-dd-warning-soft p-4 text-sm text-dd-warning"
              aria-label="Keputusan reschedule"
            >
              <strong>Keputusan reschedule</strong>
              Persetujuan akan memindahkan jadwal booking ke kelas tujuan secara otomatis. Penolakan
              akan mempertahankan booking di kelas semula tanpa mengubah kuota sesi paket.
              <SelectInput
                label="Alasan penolakan"
                value={rejectionCode}
                onChange={(event) =>
                  setRejectionCode(
                    event.target.value as 'TARGET_UNAVAILABLE' | 'OUTSIDE_POLICY' | 'OUT_OF_SCOPE',
                  )
                }
              >
                <option value="TARGET_UNAVAILABLE">Target tidak tersedia</option>
                <option value="OUTSIDE_POLICY">Di luar kebijakan reschedule</option>
                <option value="OUT_OF_SCOPE">Di luar cakupan cabang</option>
              </SelectInput>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void decideReschedule('approve')}
              >
                Setujui reschedule
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => void decideReschedule('reject')}
              >
                Tolak reschedule
              </Button>
            </Panel>
          )}
        </section>
      )}
      {activeTab === 'attendance' && (
        <Panel className="grid gap-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <CalendarCheck2 className="mt-0.5 size-6 text-dd-forest" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-dd-ink">Check-in & Kehadiran</h2>
              <p className="mt-1 text-sm leading-6 text-dd-muted">
                Booking yang sudah hadir tercatat pada tabel di bawah. Untuk memindai QR member
                atau instruktur, buka halaman Check-in dengan cabang operasional yang sudah dipilih.
              </p>
              <Link
                className="mt-4 inline-flex min-h-11 items-center rounded-dd-md border border-dd-forest bg-dd-forest px-4 text-sm font-bold text-white no-underline"
                href="/workspace/check-in"
              >
                Buka Check-in
              </Link>
            </div>
          </div>
          <FilterBar>
            <SearchSelect
              label="Jadwal kelas"
              value={rosterSlotId}
              placeholder="Semua jadwal"
              wrapperClassName="min-w-56 flex-1"
              options={Array.from(
                new Map(
                  items
                    .filter((item) => item.classSlot)
                    .map((item) => [item.classSlot!.id, item.classSlot!]),
                ).values(),
              ).map((slot) => ({
                id: slot.id,
                label: slot.classType.name,
                description: formatBookingTime(slot.startAt, slot.timezone),
              }))}
              onChange={setRosterSlotId}
            />
            <SelectInput
              label="Status roster"
              value={rosterStatus}
              onChange={(event) => setRosterStatus(event.target.value)}
              wrapperClassName="min-w-44"
            >
              <option value="">Semua status</option>
              <option value="BOOKED">Belum hadir</option>
              <option value="ATTENDED">Sudah hadir</option>
              <option value="CANCELLED">Dibatalkan</option>
              <option value="NO_SHOW">Tidak hadir</option>
            </SelectInput>
            {(search || rosterSlotId || rosterStatus) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setRosterSlotId('');
                  setRosterStatus('');
                }}
              >
                Reset roster
              </Button>
            )}
          </FilterBar>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-dd-md border border-dd-line bg-dd-surface-muted p-3">
            <span className="text-sm text-dd-muted">
              {selectedRosterIds.length} peserta dipilih
            </span>
            <Button
              type="button"
              disabled={
                busy ||
                !canManageAttendance ||
                !branchId ||
                !rosterSlotId ||
                selectedRosterIds.length === 0
              }
              title={
                !branchId
                  ? 'Pilih cabang untuk menerbitkan QR'
                  : !rosterSlotId
                    ? 'Pilih jadwal untuk menerbitkan QR'
                    : undefined
              }
              onClick={() => void issueBulkCheckIn()}
            >
              Terbitkan QR untuk peserta terpilih
            </Button>
          </div>
        </Panel>
      )}
      {(activeTab === 'bookings' || activeTab === 'attendance') && (
        <>
          <h2 className="text-xl font-semibold text-dd-ink">
            {activeTab === 'attendance' ? 'Riwayat kehadiran' : 'Daftar booking'}
          </h2>
          <DataTable
            rowNumberOffset={pageOffset(page - 1)}
            items={items}
            rowKey={(booking) => booking.id}
            loading={busy && items.length === 0}
            emptyTitle="Belum ada booking"
            emptyDescription="Tidak ada booking yang sesuai dengan cakupan dan filter saat ini."
            columns={[
              {
                id: 'customer',
                header: 'Pelanggan',
                cell: (booking) => (
                  <div>
                    {activeTab === 'attendance' && (
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${booking.customer?.displayName ?? 'customer'}`}
                        className="mr-2 size-4 accent-dd-forest"
                        checked={selectedRosterIds.includes(booking.id)}
                        onChange={(event) =>
                          setSelectedRosterIds((current) =>
                            event.target.checked
                              ? [...current, booking.id]
                              : current.filter((id) => id !== booking.id),
                          )
                        }
                      />
                    )}
                    <strong className="block">
                      {booking.customer?.displayName ?? 'Pelanggan'}
                    </strong>
                    <span className="text-xs text-dd-muted">{booking.customer?.phoneMasked}</span>
                  </div>
                ),
              },
              {
                id: 'class',
                header: 'Kelas',
                cell: (booking) => (
                  <div>
                    <strong className="block">
                      {booking.classSlot?.classType.name ?? 'Kelas'}
                    </strong>
                    <span className="text-xs text-dd-muted">
                      {booking.classSlot
                        ? formatBookingTime(booking.classSlot.startAt, booking.classSlot.timezone)
                        : 'Jadwal tidak tersedia'}
                    </span>
                  </div>
                ),
              },
              {
                id: 'branch',
                header: 'Studio',
                cell: (booking) => booking.branch?.name ?? 'Studio',
              },
              {
                id: 'balance',
                header: 'Sesi',
                cell: (booking) =>
                  booking.sessionBalance
                    ? `${booking.sessionBalance.available} tersedia · ${booking.sessionBalance.reserved} direservasi`
                    : 'Saldo tidak tersedia',
              },
              {
                id: 'status',
                header: 'Status',
                cell: (booking) => (
                  <Badge
                    tone={
                      booking.status === 'ATTENDED'
                        ? 'success'
                        : booking.status === 'CANCELLED' || booking.status === 'NO_SHOW'
                          ? 'danger'
                          : booking.status === 'RESCHEDULE_PENDING'
                            ? 'warning'
                            : 'info'
                    }
                  >
                    {bookingStatusLabel(booking.status)}
                  </Badge>
                ),
              },
              {
                id: 'action',
                header: <span className="sr-only">Tindakan</span>,
                cell: (booking) => {
                  const issue = checkInIssues[booking.id];
                  const menuItems = [
                    ...(booking.status === 'BOOKED' && canCancelBookings && client.cancelAsStaff
                      ? [
                          {
                            id: 'cancel',
                            label: 'Batalkan booking',
                            tone: 'danger' as const,
                            onClick: () => void requestCancel(booking),
                          },
                        ]
                      : []),
                    ...(activeTab === 'attendance' &&
                    booking.checkInToken?.status === 'ACTIVE' &&
                    canManageAttendance &&
                    branchId
                      ? [
                          {
                            id: 'revoke',
                            label: 'Cabut QR',
                            tone: 'warning' as const,
                            onClick: () => void revokeCheckIn(booking),
                          },
                        ]
                      : []),
                    ...(issue?.whatsappUrl
                      ? [
                          {
                            id: 'whatsapp',
                            label: 'Buka WhatsApp',
                            href: issue.whatsappUrl,
                          },
                        ]
                      : []),
                    ...(issue?.passUrl
                      ? [
                          {
                            id: 'pass',
                            label: 'Buka pass',
                            href: issue.passUrl,
                          },
                          {
                            id: 'copy-link',
                            label: 'Salin link pass',
                            onClick: () => void navigator.clipboard.writeText(issue.passUrl ?? ''),
                          },
                        ]
                      : []),
                  ];

                  return (
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        className="inline-flex min-h-11 items-center rounded-dd-md border border-dd-line px-3 text-xs font-semibold text-dd-forest no-underline hover:bg-dd-surface-muted"
                        href={`/workspace/bookings/${booking.id}?returnTo=${encodeURIComponent('/workspace/bookings')}`}
                      >
                        Lihat detail
                      </Link>
                      {booking.status === 'BOOKED' && canManageAttendance && branchId && (
                        issue ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid="btn-wa-qr"
                            className="!text-[#166534] !border-[#22c55e]/50 hover:!bg-[#f0fdf4]"
                            onClick={() => setQrModalData({ booking, issue })}
                          >
                            Kirim WA ↗
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            data-testid="btn-issue-qr"
                            onClick={() => void issueCheckIn(booking)}
                          >
                            Buat/Kirim QR
                          </Button>
                        )
                      )}
                      {menuItems.length > 0 && (
                        <TableActionMenu
                          ariaLabel={`Aksi booking ${shortId(booking.id)}`}
                          disabled={busy}
                          items={menuItems}
                        />
                      )}
                    </div>
                  );
                },
              },
            ]}
            mobileCard={(booking) => {
            const issue = checkInIssues[booking.id];
            return (
              <div className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="block">
                      {booking.customer?.displayName ?? 'Pelanggan'}
                    </strong>
                    <span className="text-sm text-dd-muted">
                      {booking.classSlot?.classType.name ?? 'Kelas'} ·{' '}
                      {booking.branch?.name ?? 'Studio'}
                    </span>
                  </div>
                  <Badge
                    tone={
                      booking.status === 'ATTENDED'
                        ? 'success'
                        : booking.status === 'CANCELLED' || booking.status === 'NO_SHOW'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {bookingStatusLabel(booking.status)}
                  </Badge>
                </div>
                <p className="text-sm text-dd-muted">
                  {booking.classSlot
                    ? formatBookingTime(booking.classSlot.startAt, booking.classSlot.timezone)
                    : 'Jadwal tidak tersedia'}
                </p>
                {activeTab === 'attendance' && (
                  <label className="inline-flex items-center gap-2 text-sm text-dd-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-dd-forest"
                      checked={selectedRosterIds.includes(booking.id)}
                      onChange={(event) =>
                        setSelectedRosterIds((current) =>
                          event.target.checked
                            ? [...current, booking.id]
                            : current.filter((id) => id !== booking.id),
                        )
                      }
                    />
                    Pilih peserta
                  </label>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-dd-md border border-dd-line px-3 text-xs font-semibold text-dd-forest no-underline"
                    href={`/workspace/bookings/${booking.id}?returnTo=${encodeURIComponent('/workspace/bookings')}`}
                  >
                    Lihat detail
                  </Link>
                  {booking.status === 'BOOKED' && canManageAttendance && branchId && (
                    issue ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="mobile-btn-wa-qr"
                        className="!text-[#166534] !border-[#22c55e]/50 hover:!bg-[#f0fdf4]"
                        onClick={() => setQrModalData({ booking, issue })}
                      >
                        Kirim WA ↗
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        data-testid="mobile-btn-issue-qr"
                        onClick={() => void issueCheckIn(booking)}
                      >
                        Buat/Kirim QR
                      </Button>
                    )
                  )}
                  {booking.status === 'BOOKED' && canCancelBookings && client.cancelAsStaff && (
                    <TableActionMenu
                      ariaLabel={`Aksi booking ${shortId(booking.id)}`}
                      disabled={busy}
                      items={[
                        {
                          id: 'cancel',
                          label: 'Batalkan booking',
                          tone: 'danger' as const,
                          onClick: () => void requestCancel(booking),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            );
          }}
          />
          <Pagination
            hasPrevious={page > 1 || cursorHistory.length > 0}
            hasNext={Boolean(nextCursor) || page < totalPages}
            currentPage={page}
            totalPages={totalPages > 1 ? totalPages : (nextCursor ? page + 1 : page)}
            totalItems={totalItems}
            pageSize={ADMIN_PAGE_SIZE}
            showPageNumbers={totalPages > 1}
            onPageChange={(target) => {
              setPage(target);
            }}
            onPrevious={openPreviousPage}
            onNext={openNextPage}
          />
        </>
      )}
    </section>
  );
}

function bookingStatusLabel(status: string) {
  return (
    {
      BOOKED: 'Aktif',
      RESCHEDULE_PENDING: 'Menunggu reschedule',
      CANCELLED: 'Dibatalkan',
      ATTENDED: 'Sudah hadir',
      NO_SHOW: 'Tidak hadir',
    }[status] ?? 'Status booking'
  );
}

function formatBookingTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(value);
}
