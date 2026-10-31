'use client';

import { FormEvent, useState } from 'react';
import { Button } from '../components/actions';
import { Drawer } from '../components/app-feedback';
import { SearchSelect, TextInput } from '../components/forms';
import { Feedback } from '../ui';
import type { CustomerDetail } from './customer-client';
import { customerClient } from './customer-client';

export interface CustomerEditDrawerProps {
  open: boolean;
  onClose: () => void;
  customer: Pick<
    CustomerDetail,
    'id' | 'displayName' | 'phoneE164' | 'email' | 'version'
  > & {
    username?: string | null;
    preferredBranch?: { id: string; name: string } | null;
    profile?: {
      gender?: string | null;
      genderCode?: string | null;
      birthDate?: string | null;
      address?: string | null;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
      nik?: string | null;
    } | null;
  };
  branches: Array<{ id: string; name: string }>;
  canWrite?: boolean;
  onSuccess: (updatedName?: string) => Promise<void> | void;
}

export function CustomerEditDrawer({
  open,
  onClose,
  customer,
  branches,
  canWrite = true,
  onSuccess,
}: CustomerEditDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const displayName = String(data.get('displayName') || '').trim();
    const phoneE164 = String(data.get('phoneE164') || '').trim();

    if (!displayName) {
      setError('Nama lengkap wajib diisi.');
      return;
    }
    if (!phoneE164) {
      setError('Nomor WhatsApp wajib diisi.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await customerClient.updateProfile(
        customer.id,
        {
          displayName,
          username: String(data.get('username') || '').trim().toLowerCase() || null,
          email: String(data.get('email') || '').trim() || null,
          phoneE164,
          preferredBranchId: String(data.get('preferredBranchId') || '').trim() || null,
          expectedVersion: customer.version,
          profile: {
            nik: customer.profile?.nik ?? null,
            genderCode: String(data.get('genderCode') || '').trim() || null,
            birthDate: String(data.get('birthDate') || '').trim() || null,
            address: String(data.get('address') || '').trim() || null,
            emergencyContactName: String(data.get('emergencyContactName') || '').trim() || null,
            emergencyContactPhone: String(data.get('emergencyContactPhone') || '').trim() || null,
          },
          reason: String(data.get('reason') || '').trim() || 'Pembaruan profil pelanggan',
        },
        { idempotencyKey: crypto.randomUUID() },
      );
      await onSuccess(displayName);
      onClose();
    } catch (cause: any) {
      setError(cause?.message || 'Perubahan profil belum dapat disimpan. Periksa kelengkapan data.');
    } finally {
      setBusy(false);
    }
  }

  const birthDateValue = customer.profile?.birthDate
    ? new Date(customer.profile.birthDate).toISOString().split('T')[0]
    : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit Cepat: ${customer.displayName}`}
      description="Perbarui identitas pribadi, alamat, studio utama, dan kontak darurat pelanggan."
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 py-2">
        {error && <Feedback kind="error">{error}</Feedback>}

        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            required
            label="Nama Lengkap"
            name="displayName"
            defaultValue={customer.displayName}
          />
          <TextInput
            label="Username (ID Login)"
            name="username"
            defaultValue={customer.username ?? ''}
            placeholder="contoh: budi_santoso"
            description="Digunakan untuk login member (3-30 karakter)."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            type="email"
            label="Email (Opsional)"
            name="email"
            defaultValue={customer.email ?? ''}
            placeholder="nama@email.com"
          />
          <TextInput
            required
            label="Nomor WhatsApp / HP"
            name="phoneE164"
            defaultValue={customer.phoneE164 ?? ''}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <SearchSelect
              label="Home Studio / Cabang Utama"
              name="preferredBranchId"
              defaultValue={customer.preferredBranch?.id ?? ''}
              placeholder="Belum ditentukan"
              options={branches.map((b) => ({
                id: b.id,
                label: b.name,
              }))}
            />
            <p className="text-[11px] text-dd-muted leading-tight">
              Studio utama untuk preferensi jadwal dan komunikasi. Hak akses latihan multi-cabang aktif secara otomatis mengikuti Paket Multi-Cabang atau Paket Bersama (Family/Duet) yang dimiliki member.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label className="text-xs font-bold text-dd-ink" htmlFor="gender-select">
              Jenis Kelamin
            </label>
            <select
              id="gender-select"
              name="genderCode"
              defaultValue={customer.profile?.gender ?? customer.profile?.genderCode ?? ''}
              className="w-full rounded-dd-md border border-dd-line bg-white px-3 py-2 text-sm text-dd-ink outline-none focus:border-dd-forest focus:ring-2 focus:ring-dd-forest/15"
            >
              <option value="">Pilih Jenis Kelamin</option>
              <option value="FEMALE">Perempuan</option>
              <option value="MALE">Laki-laki</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            type="date"
            label="Tanggal Lahir"
            name="birthDate"
            defaultValue={birthDateValue}
          />
          <TextInput
            label="Alamat Domisili"
            name="address"
            defaultValue={customer.profile?.address ?? ''}
            placeholder="Alamat lengkap tempat tinggal"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Nama Kontak Darurat"
            name="emergencyContactName"
            defaultValue={customer.profile?.emergencyContactName ?? ''}
            placeholder="Nama keluarga / rekan"
          />
          <TextInput
            label="Nomor Kontak Darurat"
            name="emergencyContactPhone"
            defaultValue={customer.profile?.emergencyContactPhone ?? ''}
            placeholder="08123456789"
          />
        </div>

        <TextInput
          label="Catatan perubahan (opsional)"
          name="reason"
          placeholder="Contoh: Pembaruan data demografi dan kontak"
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-dd-line">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Batal
          </Button>
          <Button type="submit" loading={busy} disabled={!canWrite}>
            Simpan Perubahan Profil
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
