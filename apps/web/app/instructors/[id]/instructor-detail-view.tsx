'use client';

import Link from 'next/link';
import { ArrowLeft, Building2, Calendar, CreditCard, Pencil, Power, PowerOff, ShieldAlert, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Feedback, Skeleton, StatusBadge } from '../../ui';
import { AdminPageHeader } from '../../components/admin/admin-page-header';
import { KirimQrWhatsApp } from '../../components/kirim-qr-whatsapp';
import { formatRupiah } from '../../lib/formatters';
import { instructorClient, type InstructorDetail } from '../instructor-client';
import { Button, ButtonLink } from '../../components/actions';
import { Drawer, useAppFeedback } from '../../components/app-feedback';
import { TextInput } from '../../components/forms';
import { Badge } from '../../components/admin/admin-ui';
import { useSessionContext } from '../../session-context';
import { FeeInstruktur } from './fee-instruktur';

export function InstructorDetailView({ id }: { id: string }) {
  const sessionContext = useSessionContext();
  const session = sessionContext?.session;
  const feedback = useAppFeedback();
  const canManage =
    session?.capabilities?.includes('user:admin') ||
    session?.capabilities?.includes('assignment:manage') ||
    session?.capabilities?.includes('master:manage');

  const [data, setData] = useState<InstructorDetail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit Profile Drawer State
  const [editOpen, setEditOpen] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: '',
    email: '',
    phoneE164: '',
    branchIds: [] as string[],
    bankName: '',
    accountNumber: '',
    accountHolder: '',
    address: '',
    gender: '',
    birthDate: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    notes: '',
  });

  const load = useCallback(() => {
    return instructorClient
      .detail(id)
      .then((res) => {
        setData(res);
        setEditForm({
          displayName: res.displayName,
          email: res.email ?? '',
          phoneE164: res.phoneE164 ?? '',
          branchIds: res.assignments?.map((a) => a.branch.id) ?? [],
          bankName: res.profile?.bankInfo?.bankName ?? '',
          accountNumber: res.profile?.bankInfo?.accountNumber ?? '',
          accountHolder: res.profile?.bankInfo?.accountHolder ?? '',
          address: res.profile?.address ?? '',
          gender: res.profile?.gender ?? '',
          birthDate: res.profile?.birthDate ?? '',
          emergencyContactName: res.profile?.emergencyContactName ?? '',
          emergencyContactPhone: res.profile?.emergencyContactPhone ?? '',
          notes: res.profile?.notes ?? '',
        });
      })
      .catch(() => setError(true));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleBranch = (branchId: string) => {
    setEditDirty(true);
    setEditForm((prev) => {
      const exists = prev.branchIds.includes(branchId);
      return {
        ...prev,
        branchIds: exists
          ? prev.branchIds.filter((b) => b !== branchId)
          : [...prev.branchIds, branchId],
      };
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.displayName.trim()) {
      feedback.showToast({
        tone: 'danger',
        title: 'Nama lengkap wajib diisi',
      });
      return;
    }

    const accepted = await feedback.confirm({
      tone: 'warning',
      title: 'Simpan perubahan profil instruktur?',
      message: 'Perubahan nama, kontak, penugasan cabang, dan rekening payroll akan langsung diperbarui.',
      confirmLabel: 'Simpan Perubahan',
    });
    if (!accepted) return;

    setBusy(true);
    try {
      await instructorClient.updateProfile(id, {
        displayName: editForm.displayName,
        email: editForm.email || null,
        phoneE164: editForm.phoneE164 || null,
        branchIds: editForm.branchIds,
        bankInfo: {
          bankName: editForm.bankName || null,
          accountNumber: editForm.accountNumber || null,
          accountHolder: editForm.accountHolder || null,
        },
        address: editForm.address || null,
        gender: editForm.gender || null,
        birthDate: editForm.birthDate || null,
        emergencyContactName: editForm.emergencyContactName || null,
        emergencyContactPhone: editForm.emergencyContactPhone || null,
        notes: editForm.notes || null,
        expectedVersion: data?.version ?? 1,
      });
      feedback.showToast({
        tone: 'success',
        title: 'Profil instruktur berhasil diperbarui',
      });
      setEditDirty(false);
      setEditOpen(false);
      await load();
    } catch {
      feedback.showToast({
        tone: 'danger',
        title: 'Gagal memperbarui profil',
        message: 'Periksa kembali data atau coba beberapa saat lagi.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!data || busy) return;
    const isActivating = data.status !== 'ACTIVE';
    const action = isActivating ? 'reactivate' : 'deactivate';
    const actionTitle = isActivating ? 'Aktifkan kembali instruktur?' : 'Nonaktifkan instruktur?';
    const actionMessage = isActivating
      ? `Instruktur "${data.displayName}" akan aktif kembali dan dapat dijadwalkan untuk sesi kelas baru.`
      : `Instruktur "${data.displayName}" tidak akan dapat dipilih pada sesi kelas baru hingga diaktifkan kembali.`;

    const accepted = await feedback.confirm({
      tone: isActivating ? 'warning' : 'danger',
      title: actionTitle,
      message: actionMessage,
      confirmLabel: isActivating ? 'Aktifkan' : 'Nonaktifkan',
    });
    if (!accepted) return;

    setBusy(true);
    try {
      await instructorClient.toggleStatus(id, action, data.version);
      feedback.showToast({
        tone: 'success',
        title: isActivating
          ? 'Instruktur berhasil diaktifkan kembali'
          : 'Instruktur berhasil dinonaktifkan',
      });
      await load();
    } catch {
      feedback.showToast({
        tone: 'danger',
        title: 'Gagal mengubah status instruktur',
        message: 'Silakan muat ulang atau periksa hak akses Anda.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Feedback kind="error">Profil instruktur tidak tersedia.</Feedback>;
  if (!data) return <Skeleton label="Memuat profil instruktur" />;

  const blockers = data.blockers;

  return (
    <section className="space-y-6">
      <Link
        href="/instructors"
        className="inline-flex items-center gap-1.5 font-semibold text-dd-forest hover:underline text-sm"
      >
        <ArrowLeft className="size-4" />
        <span>Kembali ke Daftar Instruktur</span>
      </Link>

      <div className="rounded-dd-lg border border-dd-line bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <AdminPageHeader
            title={data.displayName}
            description={`${data.email ?? 'Email belum tersedia'} · ${data.phoneE164 ?? 'Telepon belum tersedia'}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={data.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {data.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                </StatusBadge>
                {data.status === 'ACTIVE' && (
                  <KirimQrWhatsApp
                    userId={data.id}
                    nama={data.displayName}
                    punyaNomor={Boolean(data.phoneE164)}
                  />
                )}
              </div>
            }
          />
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Pencil className="size-4" />}
                onClick={() => setEditOpen(true)}
              >
                Edit Profil
              </Button>
              <Button
                variant={data.status === 'ACTIVE' ? 'ghost' : 'secondary'}
                size="sm"
                className={
                  data.status === 'ACTIVE'
                    ? 'text-dd-danger hover:bg-dd-danger-soft hover:text-dd-danger'
                    : 'text-dd-forest hover:bg-dd-success-soft'
                }
                leadingIcon={
                  data.status === 'ACTIVE' ? (
                    <PowerOff className="size-4" />
                  ) : (
                    <Power className="size-4" />
                  )
                }
                disabled={busy}
                onClick={() => void handleToggleStatus()}
              >
                {data.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
              <ButtonLink
                variant="secondary"
                size="sm"
                leadingIcon={<Building2 className="size-4" />}
                href={`/assignments?q=${encodeURIComponent(data.displayName)}`}
              >
                Kelola Penugasan
              </ButtonLink>
            </div>
          )}
        </div>

        {/* Assigned branches badge pills */}
        <div className="mt-5 border-t border-dd-line pt-4">
          <span className="text-[13px] font-bold text-dd-muted">
            Studio / Cabang Penugasan:
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.assignments?.length ? (
              data.assignments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-dd-md bg-dd-surface-muted px-3 py-1 text-xs font-semibold text-dd-ink"
                >
                  <Building2 className="size-3.5 text-dd-forest" />
                  {a.branch.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-dd-muted italic">
                Belum ada cabang yang ditugaskan.
              </span>
            )}
          </div>
        </div>

        {/* Bank & Payroll account information */}
        <div className="mt-5 border-t border-dd-line pt-4">
          <span className="text-[13px] font-bold text-dd-muted">
            Rekening Payroll &amp; Honor:
          </span>
          {data.profile?.bankInfo?.accountNumber ? (
            <div className="mt-2 flex flex-wrap items-center gap-6 rounded-dd-md bg-dd-surface-muted px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-dd-forest" />
                <span className="text-xs text-dd-muted">Bank:</span>
                <span className="font-semibold text-dd-ink">{data.profile.bankInfo.bankName || '—'}</span>
              </div>
              <div>
                <span className="text-xs text-dd-muted mr-1">No. Rek:</span>
                <span className="font-mono font-bold text-dd-ink">{data.profile.bankInfo.accountNumber}</span>
              </div>
              <div>
                <span className="text-xs text-dd-muted mr-1">A/N:</span>
                <span className="font-semibold text-dd-ink">{data.profile.bankInfo.accountHolder || '—'}</span>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-dd-muted italic">
              Rekening bank belum diatur. Klik &quot;Edit Profil&quot; untuk mengisi rekening honor instruktur.
            </p>
          )}
        </div>
      </div>

      {blockers.completedWithoutCheckIn || blockers.completedWithoutFee ? (
        <Feedback kind="warning">
          {blockers.completedWithoutCheckIn > 0 &&
            `Bulan ini ada ${blockers.completedWithoutCheckIn} kelas selesai tanpa presensi instruktur; honornya ditandai belum terverifikasi, verifikasi dari detail kelas. `}
          {blockers.completedWithoutFee > 0 &&
            `${blockers.completedWithoutFee} kelas memakai fee bawaan karena belum ada konfigurasi fee yang cocok.`}
        </Feedback>
      ) : (
        <Feedback kind="status">
          Presensi dan konfigurasi fee kelas selesai bulan ini sudah lengkap.
        </Feedback>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Penugasan Cabang" value={data.assignments.length} />
        <Metric label="Sesi Kelas Diampu" value={data.instructedClassSlots.length} />
        <Metric
          label="Honor Bulan Ini (kelas selesai)"
          value={data.compensationRp === null ? '—' : formatRupiah(data.compensationRp)}
          hint={
            data.compensationRp === null
              ? 'Nominal honor hanya untuk peran dengan akses honor.'
              : data.unverifiedCompensationRp
                ? `${formatRupiah(data.unverifiedCompensationRp)} belum terverifikasi`
                : undefined
          }
        />
      </div>

      {session?.capabilities?.includes('master:read') && (
        <FeeInstruktur
          instructorId={data.id}
          canEdit={Boolean(session.capabilities.includes('master:manage'))}
          branches={
            data.assignments.length
              ? data.assignments.map((a) => ({ id: a.branch.id, name: a.branch.name }))
              : (session.branches ?? []).map((b) => ({ id: b.id, name: b.name }))
          }
        />
      )}

      <div className="rounded-dd-lg border border-dd-line bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Riwayat Sesi Kelas Terbaru</h2>
          <ButtonLink
            variant="ghost"
            size="sm"
            href={`/workspace/classes?q=${encodeURIComponent(data.displayName)}`}
          >
            Buka Kalender Kelas
          </ButtonLink>
        </div>
        <ul className="mt-4 divide-y divide-dd-line">
          {data.instructedClassSlots.length ? (
            data.instructedClassSlots.map((slot) => (
              <li key={slot.id} className="py-3.5 flex items-center justify-between text-sm">
                <div>
                  <strong className="font-medium text-dd-ink">{slot.classType.name}</strong>
                  <span className="text-dd-muted"> · {slot.branch.name}</span>
                  <div className="text-xs text-dd-muted mt-0.5">
                    {new Date(slot.startAt).toLocaleString('id-ID', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    tone={
                      slot.status === 'CONFIRMED' || slot.status === 'COMPLETED'
                        ? 'success'
                        : slot.status === 'CANCELLED'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {slot.status}
                  </Badge>
                  <span className="text-xs font-semibold text-dd-forest">
                    {slot.instructorHourLog
                      ? `Rp${Number(slot.instructorHourLog.amountRp).toLocaleString('id-ID')}`
                      : '—'}
                  </span>
                </div>
              </li>
            ))
          ) : (
            <li className="py-8 text-center text-dd-muted text-sm">
              Belum ada riwayat sesi kelas untuk instruktur ini.
            </li>
          )}
        </ul>
      </div>

      {/* Drawer: Edit Profil Instruktur */}
      <Drawer
        open={editOpen}
        title="Edit Profil Instruktur"
        description="Perbarui informasi data diri dan nomor kontak instruktur."
        busy={busy}
        dirty={editDirty}
        onDirtyClose={() =>
          feedback.confirm({
            tone: 'warning',
            title: 'Batalkan perubahan profil?',
            message: 'Perubahan yang belum disimpan akan hilang.',
            confirmLabel: 'Buang perubahan',
          })
        }
        onClose={() => {
          setEditDirty(false);
          setEditOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditDirty(false);
                setEditOpen(false);
              }}
              disabled={busy}
            >
              Batal
            </Button>
            <Button
              type="submit"
              form="edit-instructor-form"
              leadingIcon={<UserCheck className="size-4" />}
              loading={busy}
            >
              Simpan Perubahan
            </Button>
          </div>
        }
      >
        <form
          id="edit-instructor-form"
          className="grid gap-5 py-2"
          onChange={() => setEditDirty(true)}
          onSubmit={(e) => void handleEditSubmit(e)}
        >
          {/* Bagian 1: Identitas & Kontak */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dd-forest">
              1. Identitas &amp; Kontak Akun
            </h3>
            <TextInput
              label="Nama Lengkap Instruktur"
              value={editForm.displayName}
              onChange={(e) => setEditForm((prev) => ({ ...prev, displayName: e.target.value }))}
              required
            />
            <TextInput
              label="Alamat Email (Akun)"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="nama@dailydose.id"
              description="Email login instruktur. Perubahan email akan mengubah username login sesi."
            />
            <TextInput
              label="Nomor WhatsApp / HP"
              placeholder="08123456789 atau +628123456789"
              value={editForm.phoneE164}
              onChange={(e) => setEditForm((prev) => ({ ...prev, phoneE164: e.target.value }))}
              description="Digunakan untuk koordinasi operasional kelas dan notifikasi sesi."
            />
          </div>

          {/* Bagian 2: Cabang Mengajar */}
          <div className="space-y-3 border-t border-dd-line pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dd-forest">
              2. Studio / Cabang Penugasan Mengajar
            </h3>
            <p className="text-xs text-dd-muted">
              Pilih cabang tempat instruktur bertugas. Nama instruktur otomatis tampil di dropdown timetable cabang terpilih.
            </p>
            <div className="space-y-2">
              {(session?.branches ?? []).map((branch) => {
                const checked = editForm.branchIds.includes(branch.id);
                return (
                  <label
                    key={branch.id}
                    className="flex items-center gap-2.5 rounded-dd-md border border-dd-line p-2.5 text-sm hover:bg-dd-surface-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBranch(branch.id)}
                      className="size-4 rounded border-dd-line text-dd-forest focus:ring-dd-forest"
                    />
                    <span className="font-medium text-dd-ink">{branch.name}</span>
                    <span className="text-xs text-dd-muted">({branch.code})</span>
                  </label>
                );
              })}
              {(!session?.branches || session.branches.length === 0) && (
                <p className="text-xs text-dd-muted italic">Tidak ada cabang terdaftar.</p>
              )}
            </div>
          </div>

          {/* Bagian 3: Data Honor & Payroll */}
          <div className="space-y-3 border-t border-dd-line pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dd-forest">
              3. Rekening Payroll &amp; Pembayaran Honor
            </h3>
            <p className="text-xs text-dd-muted">
              Data rekening bank untuk transfer honor mengajar instruktur.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Nama Bank"
                placeholder="contoh: BCA, Mandiri, BRI, BNI"
                value={editForm.bankName}
                onChange={(e) => setEditForm((prev) => ({ ...prev, bankName: e.target.value }))}
              />
              <TextInput
                label="Nomor Rekening"
                placeholder="contoh: 1234567890"
                value={editForm.accountNumber}
                onChange={(e) => setEditForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
              />
            </div>
            <TextInput
              label="Atas Nama Pemilik Rekening"
              placeholder="contoh: Sarah Kartika"
              value={editForm.accountHolder}
              onChange={(e) => setEditForm((prev) => ({ ...prev, accountHolder: e.target.value }))}
            />
          </div>

          {/* Bagian 4: Data Pribadi & Kontak Darurat */}
          <div className="space-y-3 border-t border-dd-line pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dd-forest">
              4. Data Pribadi &amp; Kontak Darurat (Opsional)
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-bold text-dd-ink" htmlFor="inst-gender-select">
                  Jenis Kelamin
                </label>
                <select
                  id="inst-gender-select"
                  value={editForm.gender}
                  onChange={(e) => {
                    setEditDirty(true);
                    setEditForm((prev) => ({ ...prev, gender: e.target.value }));
                  }}
                  className="w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
                >
                  <option value="">Pilih Jenis Kelamin</option>
                  <option value="FEMALE">Perempuan</option>
                  <option value="MALE">Laki-laki</option>
                </select>
              </div>
              <TextInput
                type="date"
                label="Tanggal Lahir"
                value={editForm.birthDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, birthDate: e.target.value }))}
              />
            </div>
            <TextInput
              label="Alamat Domisili"
              placeholder="Alamat tempat tinggal instruktur"
              value={editForm.address}
              onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Nama Kontak Darurat"
                placeholder="Nama keluarga / rekan"
                value={editForm.emergencyContactName}
                onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
              />
              <TextInput
                label="Nomor Kontak Darurat"
                placeholder="08123456789"
                value={editForm.emergencyContactPhone}
                onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-bold text-dd-ink" htmlFor="inst-notes">
                Catatan Tambahan
              </label>
              <textarea
                id="inst-notes"
                rows={2}
                value={editForm.notes}
                onChange={(e) => {
                  setEditDirty(true);
                  setEditForm((prev) => ({ ...prev, notes: e.target.value }));
                }}
                placeholder="Catatan sertifikasi, spesialisasi, atau preferensi jam mengajar"
                className="w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
              />
            </div>
          </div>
        </form>
      </Drawer>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-dd-lg border border-dd-line bg-white p-5">
      <div className="text-[13px] font-bold text-dd-muted">{label}</div>
      <strong className="mt-2 block text-2xl font-bold text-dd-ink">{value}</strong>
      {hint && <p className="mt-1 text-xs text-dd-muted">{hint}</p>}
    </div>
  );
}
