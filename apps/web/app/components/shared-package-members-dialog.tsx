'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Phone, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from './actions';
import { AlertBanner, Modal, useOptionalAppFeedback } from './app-feedback';
import { SelectInput, TextInput } from './forms';
import { Badge } from './admin/admin-ui';
import {
  addPackageMember,
  listPackageMembers,
  packageActionFailure,
  removePackageMember,
  type SharedPackageMember,
} from '@/api-clients/ledger-client';

const RELATIONSHIP_OPTIONS = [
  { value: 'FAMILY', label: 'Keluarga' },
  { value: 'FRIEND', label: 'Teman / Rekan' },
  { value: 'SPOUSE', label: 'Pasangan (Suami / Istri)' },
  { value: 'CHILD', label: 'Anak' },
  { value: 'OTHER', label: 'Lainnya' },
];

export function SharedPackageMembersDialog({
  open,
  onClose,
  customerPackageId,
  packageName,
  canManage = false,
  onChanged,
}: {
  open: boolean;
  onClose(): void;
  customerPackageId: string;
  packageName?: string;
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const feedback = useOptionalAppFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [members, setMembers] = useState<SharedPackageMember[]>([]);
  const [owner, setOwner] = useState<{
    displayName: string;
    phoneMasked: string | null;
    activeBookings?: number;
    attendedSessions?: number;
  } | null>(null);

  // Form self-service tambah member
  const [identifier, setIdentifier] = useState('');
  const [relationship, setRelationship] = useState('FRIEND');

  const load = useCallback(async () => {
    if (!open || !customerPackageId) return;
    setLoading(true);
    setError('');
    try {
      const res = await listPackageMembers(customerPackageId);
      setMembers(res.members ?? []);
      setOwner(res.owner ?? null);
    } catch (cause) {
      setError(packageActionFailure(cause));
    } finally {
      setLoading(false);
    }
  }, [customerPackageId, open]);

  useEffect(() => {
    if (open) {
      void load();
      setIdentifier('');
      setError('');
    }
  }, [load, open]);

  const handleAddMember = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanId = identifier.trim();
    if (!cleanId) {
      setError('Masukkan email atau nomor WhatsApp teman yang ingin diundang.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const added = await addPackageMember(customerPackageId, {
        identifier: cleanId,
        relationship,
      });
      feedback?.showToast({
        tone: 'success',
        title: 'Anggota Berhasil Ditambahkan',
        message: `${added.displayName} telah ditambahkan ke paket bersama.`,
      });
      setIdentifier('');
      await load();
      onChanged?.();
    } catch (cause) {
      setError(packageActionFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (member: SharedPackageMember) => {
    const accepted = feedback
      ? await feedback.confirm({
          tone: 'danger',
          title: 'Hapus anggota bersama?',
          message: `${member.displayName} tidak akan dapat lagi menggunakan sisa sesi dari paket ini.`,
          confirmLabel: 'Hapus anggota',
        })
      : false;
    if (!accepted) return;

    setBusy(true);
    setError('');
    try {
      await removePackageMember(customerPackageId, member.userId);
      feedback?.showToast({
        tone: 'success',
        title: 'Anggota dihapus',
        message: `${member.displayName} telah dihapus dari paket bersama.`,
      });
      await load();
      onChanged?.();
    } catch (cause) {
      setError(packageActionFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const isLimitReached = members.length >= 4;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Kelola Anggota Paket Bersama"
      description={packageName ? `Paket: ${packageName}` : 'Daftar pengguna bersama kuota paket'}
      className="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Tutup
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {error && <AlertBanner tone="danger" title="Terjadi kendala" message={error} />}

        <div className="rounded-dd-sm border border-dd-forest/20 bg-dd-forest/5 p-3 text-xs text-dd-forest">
          <strong>Self-Service Paket Bersama (Family / Duet):</strong> Sisa sesi kuota paket ini dipakai bersama. Setiap anggota yang terdaftar sah dapat memesan kelas, dan sisa sesi akan berkurang saat booking atau dihadiri.
        </div>

        {owner && (
          <div className="flex items-center justify-between rounded-dd-sm border border-dd-line bg-dd-surface-muted/30 p-3">
            <div>
              <p className="text-xs font-bold text-dd-muted uppercase tracking-wider">Pemilik Utama</p>
              <p className="text-sm font-semibold text-dd-ink">{owner.displayName}</p>
              {owner.phoneMasked && <p className="text-xs text-dd-muted">{owner.phoneMasked}</p>}
              {owner.attendedSessions !== undefined && (
                <p className="mt-1 text-xs text-dd-forest font-medium">
                  {owner.attendedSessions} sesi terpakai · {owner.activeBookings ?? 0} booking aktif
                </p>
              )}
            </div>
            <Badge tone="success">Pemilik</Badge>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-dd-ink flex items-center gap-1.5">
              <Users className="size-4 text-dd-forest" />
              Anggota Tambahan ({members.length}/4)
            </h3>
          </div>

          {loading ? (
            <p className="text-sm text-dd-muted py-2">Memuat daftar anggota…</p>
          ) : members.length === 0 ? (
            <div className="rounded-dd-sm border border-dashed border-dd-line p-4 text-center text-xs text-dd-muted">
              Belum ada anggota bersama yang didaftarkan pada paket ini.
            </div>
          ) : (
            <ul className="divide-y divide-dd-line rounded-dd-sm border border-dd-line">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm text-dd-ink">{member.displayName}</strong>
                      <Badge tone="neutral">
                        {RELATIONSHIP_OPTIONS.find((opt) => opt.value === member.relationship)?.label ?? member.relationship}
                      </Badge>
                    </div>
                    {member.phoneMasked && (
                      <p className="text-xs text-dd-muted mt-0.5">{member.phoneMasked}</p>
                    )}
                    {member.attendedSessions !== undefined && (
                      <p className="mt-1 text-xs text-dd-forest font-medium">
                        {member.attendedSessions} sesi terpakai · {member.activeBookings ?? 0} booking aktif
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="text-dd-danger hover:bg-dd-danger/10"
                      onClick={() => void handleRemoveMember(member)}
                      aria-label={`Hapus ${member.displayName}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canManage && (
          <div className="mt-2">
            {isLimitReached ? (
              <div className="rounded-dd-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Batas Kuota Tercapai:</strong> Paket bersama ini telah mencapai kuota maksimal 4 anggota tambahan. Hapus anggota lama terlebih dahulu jika ingin mengundang teman baru.
              </div>
            ) : (
              <form onSubmit={handleAddMember} className="grid gap-3 rounded-dd-md border border-dd-line p-3">
                <legend className="px-1 text-sm font-semibold flex items-center gap-1.5">
                  <UserPlus className="size-4 text-dd-forest" />
                  Undang Teman / Tambah Anggota (Self-Service)
                </legend>

                <TextInput
                  label="Email atau Nomor WhatsApp Teman"
                  placeholder="Contoh: teman@gmail.com atau 081234567890"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={busy}
                  data-testid="input-member-identifier"
                  required
                />

                <SelectInput
                  label="Hubungan / Relasi"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  disabled={busy}
                  data-testid="select-member-relationship"
                >
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </SelectInput>

                <p className="text-xs text-dd-muted">
                  Pastikan teman yang diundang sudah terdaftar di Daily Dose. Kuota sesi paket akan langsung dapat digunakan olehnya untuk reservasi kelas.
                </p>

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !identifier.trim()}
                    loading={busy}
                    data-testid="btn-add-member"
                  >
                    Undang / Tambah Anggota
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
