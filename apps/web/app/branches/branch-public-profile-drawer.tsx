'use client';

import { useEffect, useState } from 'react';
import { Button } from '../components/actions';
import { Drawer, useAppFeedback } from '../components/app-feedback';
import { Feedback } from '../ui';
import {
  controlClassName,
  ImageUploadField,
  MultiImageGalleryField,
  TextInput,
} from '../components/forms';

type Editable = Record<string, unknown> & { version: number };
type ProfileData = {
  branch: {
    id: string;
    name: string;
    publicProfile: Editable | null;
  };
  assetKeys: string[];
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!response.ok) throw { response: { status: response.status } };
  return response.json() as Promise<T>;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function lines(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('\n') : '';
}

function list(form: FormData, key: string) {
  return String(form.get(key) ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function BranchPublicProfileDrawer({
  branchId,
  branchName,
  open,
  onClose,
  onSaved,
}: {
  branchId: string;
  branchName: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const feedback = useAppFeedback();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !branchId) return;
    setLoading(true);
    setError('');
    request<ProfileData>(`/api/v1/master/public-profiles?branchId=${encodeURIComponent(branchId)}`)
      .then((res) => {
        setData(res);
      })
      .catch(() => setError('Profil publik cabang belum dapat dimuat.'))
      .finally(() => setLoading(false));
  }, [branchId, open]);

  const profile = data?.branch.publicProfile;
  const assetKeys = data?.assetKeys ?? [];


  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    const form = event.currentTarget;
    const formData = new FormData(form);

    setSaving(true);
    try {
      await request(`/api/v1/master/public-profiles/branch/${encodeURIComponent(branchId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          slug: String(formData.get('slug')).trim(),
          area: String(formData.get('area')).trim(),
          city: String(formData.get('city')).trim(),
          address: String(formData.get('address')).trim(),
          operationalEmail: String(formData.get('operationalEmail') ?? '').trim() || null,
          mapUrl: String(formData.get('mapUrl') ?? '').trim() || null,
          description: String(formData.get('description')).trim(),
          arrivalInformation: String(formData.get('arrivalInformation')).trim() || null,
          parkingInformation: String(formData.get('parkingInformation')).trim() || null,
          openingHours: list(formData, 'openingHours'),
          amenities: list(formData, 'amenities'),
          heroImageKey: String(formData.get('heroImageKey')).trim(),
          galleryImageKeys: list(formData, 'galleryImageKeys'),
          expectedVersion: profile.version,
        }),
      });
      setDirty(false);
      feedback.showToast({
        tone: 'success',
        title: 'Profil publik berhasil diperbarui',
        message: 'Konten cabang diperbarui pada halaman informasi publik.',
      });
      onSaved();
      onClose();
    } catch {
      feedback.showAlert({
        tone: 'danger',
        title: 'Gagal menyimpan profil publik',
        message: 'Periksa kelengkapan gambar atau format isian, lalu coba beberapa saat lagi.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={`Edit Profil Publik: ${branchName}`}
      description="Lengkapi informasi kontak, lokasi Google Maps, jam buka, dan foto untuk ditampilkan pada website publik."
      busy={saving || loading}
      dirty={dirty}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="branch-public-profile-form" loading={saving} disabled={!profile}>
            Simpan Profil Publik
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-4">
          <Feedback kind="error">{error}</Feedback>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          <div className="h-11 animate-pulse rounded-dd-md bg-dd-line/50" />
          <div className="h-11 animate-pulse rounded-dd-md bg-dd-line/50" />
          <div className="h-28 animate-pulse rounded-dd-md bg-dd-line/50" />
        </div>
      )}

      {!loading && profile && (
        <form
          id="branch-public-profile-form"
          className="grid gap-4"
          onChange={() => setDirty(true)}
          onSubmit={handleSave}
        >
          {/* Direct Image Upload Field for Hero Image */}
          <ImageUploadField
            name="heroImageKey"
            label="Foto Hero Utama Cabang"
            defaultValue={text(profile.heroImageKey)}
            description="Foto ini tampil di halaman cabang ini dan di halaman Lokasi publik (/locations). Perubahan terlihat di situs dalam beberapa menit."
            presetOptions={assetKeys.map((key) => ({ id: key, label: key }))}
            required
            onChange={() => setDirty(true)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Slug URL" name="slug" defaultValue={text(profile.slug)} required />
            <TextInput label="Area / Distrik" name="area" defaultValue={text(profile.area)} required />
            <TextInput label="Kota" name="city" defaultValue={text(profile.city)} required />
            <TextInput label="Alamat Lengkap" name="address" defaultValue={text(profile.address)} required />
            <TextInput
              label="Email Operasional Cabang"
              name="operationalEmail"
              type="email"
              defaultValue={text(profile.operationalEmail)}
              placeholder="studio.jakarta@dailydose.id"
              description="Email kontak untuk pertanyaan member cabang ini."
            />
            <TextInput
              label="URL Google Maps"
              name="mapUrl"
              type="url"
              defaultValue={text(profile.mapUrl)}
              placeholder="https://maps.app.goo.gl/…"
              description="Tautan peta navigasi langsung ke studio."
            />
          </div>

          <label className="text-sm font-semibold text-dd-ink">
            Deskripsi Studio
            <textarea
              name="description"
              defaultValue={text(profile.description)}
              required
              rows={3}
              className={`${controlClassName} min-h-24 resize-y mt-1.5`}
              placeholder="Ceritakan keunikan dan suasana studio ini…"
            />
          </label>

          <label className="text-sm font-semibold text-dd-ink">
            Panduan Kedatangan
            <textarea
              name="arrivalInformation"
              defaultValue={text(profile.arrivalInformation)}
              rows={2}
              className={`${controlClassName} min-h-20 resize-y mt-1.5`}
              placeholder="Petunjuk menuju lantai studio atau titik patokan…"
            />
          </label>

          <label className="text-sm font-semibold text-dd-ink">
            Informasi Parkir
            <textarea
              name="parkingInformation"
              defaultValue={text(profile.parkingInformation)}
              rows={2}
              className={`${controlClassName} min-h-20 resize-y mt-1.5`}
              placeholder="Ketersediaan parkir mobil, motor, atau valet…"
            />
          </label>

          <label className="text-sm font-semibold text-dd-ink">
            Jam Operasional
            <textarea
              name="openingHours"
              defaultValue={lines(profile.openingHours)}
              required
              rows={3}
              className={`${controlClassName} min-h-24 resize-y mt-1.5`}
              placeholder="Senin - Jumat: 06:00 - 21:00&#10;Sabtu - Minggu: 07:00 - 18:00"
            />
            <span className="mt-1 block text-xs font-normal text-dd-muted">
              Satu baris untuk setiap jadwal hari operasional.
            </span>
          </label>

          <label className="text-sm font-semibold text-dd-ink">
            Fasilitas Studio
            <textarea
              name="amenities"
              defaultValue={lines(profile.amenities)}
              required
              rows={3}
              className={`${controlClassName} min-h-24 resize-y mt-1.5`}
              placeholder="AC Ruangan&#10;Locker Pribadi&#10;Shower & Handuk&#10;Water Dispenser"
            />
            <span className="mt-1 block text-xs font-normal text-dd-muted">
              Satu baris untuk setiap fasilitas yang tersedia.
            </span>
          </label>

          <MultiImageGalleryField
            name="galleryImageKeys"
            label="Galeri Foto Cabang"
            defaultValue={profile.galleryImageKeys as string[]}
            description="Unggah foto suasana studio, fasilitas, atau ruangan cabang ini. Anda dapat mengunggah banyak foto sekaligus atau menyeret berkas ke area galeri."
            onChange={() => setDirty(true)}
          />

        </form>
      )}
    </Drawer>
  );
}
