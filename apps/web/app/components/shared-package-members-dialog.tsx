'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from './actions';
import { AlertBanner, Modal, useOptionalAppFeedback } from './app-feedback';
import { SelectInput, TextInput } from './forms';
import { Badge } from './admin/admin-ui';
import { apiFetch } from '../lib/api-client';
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
  const [owner, setOwner] = useState<{ displayName: string; phoneMasked: string | null } | null>(null);

  // Form tambah member
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: string; label?: string; description?: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; info?: string } | null>(null);
  const [relationship, setRelationship] = useState('FAMILY');

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
      setSelectedUser(null);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [load, open]);

  // Debounced search customer
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{
          items: Array<{ id: string; label?: string; description?: string }>;
        }>(`/lookups/customers?${new URLSearchParams({ q, limit: '8' }).toString()}`);
        if (!cancelled) {
          setSearchResults(res.items ?? []);
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleAddMember = async () => {
    if (!selectedUser) return;
    setBusy(true);
    setError('');
    try {
      await addPackageMember(customerPackageId, {
        userId: selectedUser.id,
        relationship,
      });
      feedback?.showToast({
        tone: 'success',
        title: 'Anggota ditambahkan',
        message: `${selectedUser.name} berhasil ditambahkan sebagai anggota bersama.`,
      });
      setSelectedUser(null);
      setSearchQuery('');
      setSearchResults([]);
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
      : typeof window !== 'undefined'
        ? window.confirm(`Hapus ${member.displayName} dari anggota bersama?`)
        : true;
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
          <strong>Paket Bersama (Family / Duet):</strong> Sisa sesi kuota paket ini dipakai bersama. Setiap anggota yang terdaftar sah dapat memesan kelas, dan sisa sesi akan berkurang saat booking atau dihadiri.
        </div>

        {owner && (
          <div className="flex items-center justify-between rounded-dd-sm border border-dd-line bg-dd-surface-muted/30 p-3">
            <div>
              <p className="text-xs font-bold text-dd-muted uppercase tracking-wider">Pemilik Utama</p>
              <p className="text-sm font-semibold text-dd-ink">{owner.displayName}</p>
              {owner.phoneMasked && <p className="text-xs text-dd-muted">{owner.phoneMasked}</p>}
            </div>
            <Badge tone="success">Pemilik</Badge>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-dd-ink flex items-center gap-1.5">
              <Users className="size-4 text-dd-forest" />
              Anggota Tambahan ({members.length})
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
          <fieldset className="grid gap-3 rounded-dd-md border border-dd-line p-3 mt-2">
            <legend className="px-1 text-sm font-semibold flex items-center gap-1.5">
              <UserPlus className="size-4 text-dd-forest" />
              Tambah Anggota Baru
            </legend>

            {!selectedUser ? (
              <div className="relative">
                <TextInput
                  label="Cari Member"
                  placeholder="Ketik nama atau nomor WhatsApp member…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={busy}
                />
                {searching && (
                  <p className="text-xs text-dd-muted mt-1">Mencari member…</p>
                )}
                {searchResults.length > 0 && (
                  <ul className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-auto rounded-dd-sm border border-dd-line bg-white shadow-lg">
                    {searchResults.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          className="w-full text-left p-2.5 hover:bg-dd-surface-muted/60 transition cursor-pointer border-b border-dd-line/50 text-sm"
                          onClick={() => {
                            setSelectedUser({
                              id: user.id,
                              name: user.label || 'Member',
                              info: user.description,
                            });
                            setSearchQuery('');
                            setSearchResults([]);
                          }}
                        >
                          <strong className="block text-dd-ink">{user.label}</strong>
                          {user.description && (
                            <span className="block text-xs text-dd-muted">{user.description}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="flex items-center justify-between rounded-dd-sm border border-dd-forest/30 bg-dd-forest/5 p-2.5">
                  <div>
                    <span className="text-xs text-dd-muted">Member Terpilih:</span>
                    <strong className="block text-sm text-dd-forest">{selectedUser.name}</strong>
                    {selectedUser.info && (
                      <span className="block text-xs text-dd-muted">{selectedUser.info}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedUser(null)}
                    disabled={busy}
                  >
                    Ganti
                  </Button>
                </div>

                <SelectInput
                  label="Hubungan / Relasi"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  disabled={busy}
                >
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </SelectInput>

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    loading={busy}
                    onClick={() => void handleAddMember()}
                  >
                    Simpan Anggota
                  </Button>
                </div>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
