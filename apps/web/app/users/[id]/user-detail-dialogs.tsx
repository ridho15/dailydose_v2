'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import type { ApplicationRole, RoleCatalogItem, UserSummary } from '@/api-clients/identity-client';
import { Button } from '../../components/actions';
import { DestructiveDialog, Modal, useOptionalAppFeedback } from '../../components/app-feedback';
import { FormSection } from '../../components/admin/admin-ui';
import { Textarea, TextInput } from '../../components/forms';
import {
  RoleSelection,
  rolesFromSelection,
  roleSummary,
  selectionFromRoles,
  type RoleSelectionValue,
} from '../user-admin-controls';

function useDialogFormGuard(open: boolean, onClose: () => void, subject: string) {
  const feedback = useOptionalAppFeedback();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (open) setDirty(false);
  }, [open]);
  const confirmDiscard = () =>
    feedback?.confirm({
      tone: 'warning',
      title: `Batalkan ${subject}?`,
      message: 'Perubahan yang belum disimpan akan hilang.',
      confirmLabel: 'Buang perubahan',
    }) ?? Promise.resolve(true);
  return {
    dirty,
    setDirty,
    confirmDiscard,
    closeImmediately() {
      setDirty(false);
      onClose();
    },
    async cancel() {
      if (!dirty || (await confirmDiscard())) {
        setDirty(false);
        onClose();
      }
    },
  };
}

export function ProfileDialog({
  open,
  user,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  user: UserSummary;
  submitting: boolean;
  onClose(): void;
  onSubmit(input: {
    displayName: string;
    email?: string | null;
    username?: string | null;
    phoneE164: string | null;
  }): Promise<void>;
}) {
  const guard = useDialogFormGuard(open, onClose, 'perubahan profil');
  return (
    <Modal
      open={open}
      title="Edit Profil Pengguna"
      description="Perbarui informasi identitas dan akun staf atau pengguna studio."
      busy={submitting}
      dirty={guard.dirty}
      onDirtyClose={guard.confirmDiscard}
      onClose={guard.closeImmediately}
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void guard.cancel()}
          >
            Batal
          </Button>
          <Button type="submit" form="staff-profile-form" loading={submitting}>
            Simpan Profil
          </Button>
        </div>
      }
    >
      <form
        id="staff-profile-form"
        className="grid gap-4"
        onChange={() => guard.setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const rawUsername = String(data.get('username') ?? '').trim();
          const rawEmail = String(data.get('email') ?? '').trim();
          void onSubmit({
            displayName: String(data.get('displayName')),
            email: rawEmail ? rawEmail.toLowerCase() : null,
            username: rawUsername ? rawUsername.toLowerCase() : null,
            phoneE164: String(data.get('phoneE164')).trim() || null,
          });
        }}
      >
        <FormSection title="Informasi Profil">
          <TextInput
            label="Username (ID Login)"
            name="username"
            defaultValue={user.username ?? ''}
            placeholder="contoh: budi_santoso"
            description="Gunakan huruf kecil, angka, _, ., atau - (3-30 karakter). Digunakan untuk login."
          />
          <TextInput
            label="Alamat Email"
            name="email"
            type="email"
            defaultValue={user.email ?? ''}
            placeholder="nama@email.com"
            description="Email akun untuk autentikasi dan notifikasi sistem."
          />
          <TextInput
            label="Nama Tampilan"
            name="displayName"
            defaultValue={user.displayName}
            minLength={2}
            maxLength={160}
            required
          />
          <TextInput
            label="Nomor WhatsApp / HP"
            name="phoneE164"
            type="tel"
            defaultValue={user.phoneE164 ?? ''}
          />
        </FormSection>
      </form>
    </Modal>
  );
}

export function RoleDialog({
  open,
  user,
  catalog,
  branches,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  user: UserSummary;
  catalog: RoleCatalogItem[];
  branches: { id: string; code: string; name: string }[];
  submitting: boolean;
  onClose(): void;
  onSubmit(roles: { role: ApplicationRole; branchId?: string | null }[], reason: string): Promise<void>;
}) {
  const guard = useDialogFormGuard(open, onClose, 'perubahan role');
  const [reason, setReason] = useState('');
  const [selection, setSelection] = useState<RoleSelectionValue>(() =>
    selectionFromRoles(user.directRoles),
  );
  useEffect(() => {
    if (open) {
      setSelection(selectionFromRoles(user.directRoles));
      setReason('');
    }
  }, [open, user.directRoles]);
  const roles = useMemo(() => rolesFromSelection(catalog, selection), [catalog, selection]);
  const invalid =
    roles.length === 0 ||
    roles.some(
      (item) =>
        catalog.find(({ role }) => role === item.role)?.scope === 'BRANCH' && !item.branchId,
    ) ||
    reason.trim().length < 3;
  return (
    <Modal
      open={open}
      title="Kelola Role dan Cabang Penugasan"
      description="Tentukan peran sistem staf ini dan cabang operasional tempatnya bertugas."
      busy={submitting}
      dirty={guard.dirty}
      onDirtyClose={guard.confirmDiscard}
      onClose={guard.closeImmediately}
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void guard.cancel()}
          >
            Batal
          </Button>
          <Button type="submit" form="staff-role-form" loading={submitting} disabled={invalid}>
            Simpan Perubahan Role
          </Button>
        </div>
      }
    >
      <form
        id="staff-role-form"
        className="grid gap-4"
        onChange={() => guard.setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(roles, reason.trim());
        }}
      >
        <RoleSelection
          catalog={catalog}
          branches={branches}
          value={selection}
          onChange={(value) => {
            setSelection(value);
            guard.setDirty(true);
          }}
        />
        <Textarea
          label="Alasan perubahan role"
          value={reason}
          maxLength={500}
          required
          placeholder="Minimal 3 karakter"
          onChange={(event) => {
            setReason(event.target.value);
            guard.setDirty(true);
          }}
          description="Alasan tersimpan pada catatan audit."
        />
        <div className="rounded-dd-md border border-dd-warning/30 bg-dd-warning-soft p-3.5 text-xs font-semibold text-dd-warning">
          Perubahan role berlaku segera dan seluruh sesi aktif pengguna akan diperbarui saat login berikutnya.
        </div>
      </form>
    </Modal>
  );
}

export function PasswordDialog({
  open,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onClose(): void;
  onSubmit(newPassword: string): Promise<void>;
}) {
  const guard = useDialogFormGuard(open, onClose, 'reset kata sandi');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const generateRandom = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let res = 'Dose';
    for (let i = 0; i < 6; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    res += '!';
    setNewPassword(res);
    setConfirmPassword(res);
    setShowPassword(true);
    guard.setDirty(true);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError('Kata sandi minimal 8 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setError('');
    void onSubmit(newPassword);
  };

  return (
    <Modal
      open={open}
      title="Reset Kata Sandi Staf Langsung"
      description="Tetapkan kata sandi baru untuk staf. Pengguna langsung dapat login menggunakan kata sandi ini. Sampaikan kata sandi baru kepada staf secara aman."
      busy={submitting}
      dirty={guard.dirty}
      onDirtyClose={guard.confirmDiscard}
      onClose={() => {
        setNewPassword('');
        setConfirmPassword('');
        setError('');
        guard.closeImmediately();
      }}
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              setNewPassword('');
              setConfirmPassword('');
              setError('');
              void guard.cancel();
            }}
          >
            Batal
          </Button>
          <Button
            type="submit"
            form="staff-password-form"
            loading={submitting}
            disabled={!newPassword || newPassword.length < 8 || newPassword !== confirmPassword}
          >
            Simpan Kata Sandi Baru
          </Button>
        </div>
      }
    >
      <form
        id="staff-password-form"
        className="grid gap-4"
        onChange={() => guard.setDirty(true)}
        onSubmit={handleSubmit}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={generateRandom}
            className="inline-flex items-center gap-1 text-xs font-semibold text-dd-forest hover:underline"
          >
            <RefreshCw className="h-3 w-3" /> Buat Sandi Acak
          </button>
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-bold text-dd-ink" htmlFor="new-password">
            Kata Sandi Baru (Min. 8 Karakter)
          </label>
          <div className="relative flex items-center">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                guard.setDirty(true);
              }}
              placeholder="Masukkan kata sandi baru"
              minLength={8}
              className="mt-1 min-h-11 w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 text-dd-muted hover:text-dd-ink"
              tabIndex={-1}
              aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-bold text-dd-ink" htmlFor="confirm-password">
            Konfirmasi Kata Sandi Baru
          </label>
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              guard.setDirty(true);
            }}
            placeholder="Ketik ulang kata sandi baru"
            minLength={8}
            className="mt-1 min-h-11 w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
            required
          />
        </div>

        {error && <p className="text-xs font-bold text-dd-danger">{error}</p>}
      </form>
    </Modal>
  );
}

export function StatusDialog({
  open,
  user,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  user: UserSummary;
  submitting: boolean;
  onClose(): void;
  onSubmit(reason: string): Promise<void>;
}) {
  const deactivate = user.status === 'ACTIVE';
  const guard = useDialogFormGuard(open, onClose, 'perubahan status pengguna');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const reasonValid = !deactivate || (reason.trim().length >= 3 && reason.trim().length <= 500);
  return (
    <DestructiveDialog
      open={open}
      title={deactivate ? 'Nonaktifkan Pengguna' : 'Aktifkan Kembali Pengguna'}
      impact={
        deactivate
          ? 'Login akun akan dihentikan dan seluruh sesi aktif pengguna dicabut.'
          : 'Pengguna dapat login kembali menggunakan role yang telah ditetapkan.'
      }
      scope={roleSummary(user.roles).join(', ') || 'Tanpa role'}
      busy={submitting}
      dirty={guard.dirty}
      onDirtyClose={guard.confirmDiscard}
      onClose={guard.closeImmediately}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void guard.cancel()}
          >
            Batal
          </Button>
          <Button
            type="submit"
            form="staff-status-form"
            variant={deactivate ? 'danger' : 'primary'}
            loading={submitting}
            disabled={!reasonValid}
          >
            {deactivate ? 'Konfirmasi Nonaktifkan' : 'Konfirmasi Aktifkan'}
          </Button>
        </div>
      }
    >
      <form
        id="staff-status-form"
        className="grid gap-2"
        onChange={() => guard.setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          if (reasonValid) void onSubmit(reason.trim());
        }}
      >
        <p className="text-sm text-dd-muted">
          Apakah Anda yakin ingin {deactivate ? 'menonaktifkan' : 'mengaktifkan kembali'} akun <strong>{user.displayName}</strong>?
        </p>
        {deactivate && (
          <Textarea
            label="Alasan"
            value={reason}
            maxLength={500}
            placeholder="Minimal 3 karakter"
            onChange={(event) => setReason(event.target.value)}
            description="Alasan tersimpan pada catatan audit."
          />
        )}
      </form>
    </DestructiveDialog>
  );
}
