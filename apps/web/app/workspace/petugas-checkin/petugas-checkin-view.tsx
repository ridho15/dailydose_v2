'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { Button } from '../../components/actions';
import { Modal } from '../../components/app-feedback';
import { SelectInput, TextInput } from '../../components/forms';
import { Feedback, Skeleton } from '../../ui';
import { useSessionContext } from '../../session-context';

export interface Petugas {
  userId: string;
  displayName: string;
  username: string | null;
  branchId: string;
  branchName: string | null;
  status: string;
  createdAt: string;
}

export interface PetugasClient {
  daftar(): Promise<{ items: Petugas[] }>;
  buat(input: { displayName: string; username: string; password: string; branchId: string }): Promise<Petugas>;
  gantiPassword(userId: string, password: string): Promise<unknown>;
  ubahStatus(userId: string, aktif: boolean): Promise<unknown>;
}

export const browserPetugasClient: PetugasClient = {
  daftar: () => apiFetch('/checkin-staff', { label: 'Memuat petugas check-in…' }),
  buat: (input) => apiFetch('/checkin-staff', { method: 'POST', body: JSON.stringify(input), label: 'Membuat akun petugas…' }),
  gantiPassword: (userId, password) =>
    apiFetch(`/checkin-staff/${encodeURIComponent(userId)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
      label: 'Mengganti kata sandi…',
    }),
  ubahStatus: (userId, aktif) =>
    apiFetch(`/checkin-staff/${encodeURIComponent(userId)}/${aktif ? 'reactivate' : 'deactivate'}`, {
      method: 'POST',
      label: aktif ? 'Mengaktifkan akun…' : 'Menonaktifkan akun…',
    }),
};

const PESAN: Record<string, string> = {
  USERNAME_TAKEN: 'Username itu sudah dipakai akun lain. Pilih username lain.',
  CHECKIN_STAFF_UNAVAILABLE: 'Fitur petugas check-in belum aktif di server (tabel petugas_checkin belum dibuat). Hubungi pengembang.',
  FORBIDDEN: 'Anda hanya bisa mengelola petugas untuk cabang Anda sendiri.',
};

async function pesanGalat(error: unknown): Promise<string> {
  const e = error as { data?: { code?: string; error?: { code?: string; details?: Array<{ field?: string; issue?: string }> } } };
  const code = e?.data?.error?.code ?? e?.data?.code ?? '';
  const detail = e?.data?.error?.details?.[0];
  if (PESAN[code]) return PESAN[code];
  if (detail?.field === 'username') return 'Username 3 sampai 32 karakter: huruf kecil, angka, titik, strip, atau garis bawah, tanpa spasi.';
  if (detail?.field === 'password') return 'Kata sandi minimal 8 karakter.';
  if (detail?.field === 'displayName') return 'Nama 2 sampai 80 karakter.';
  return 'Permintaan belum berhasil. Periksa koneksi lalu coba lagi.';
}

/**
 * Manager cabang dan Super Owner membuat akun Petugas Check-in (sales/OB). Akun ini hanya bisa
 * membuka layar check-in cabangnya: memindai QR dan mencatat kehadiran manual.
 */
export function PetugasCheckinView({ client = browserPetugasClient }: { client?: PetugasClient }) {
  const ctx = useSessionContext();
  const cabangList = (ctx?.session?.branches ?? []).map((b) => ({ id: b.id, name: b.name }));
  const [items, setItems] = useState<Petugas[] | null>(null);
  const [galat, setGalat] = useState('');
  const [info, setInfo] = useState('');
  const [form, setForm] = useState({ displayName: '', username: '', password: '', branchId: ctx?.activeBranchId || '' });
  const [sibuk, setSibuk] = useState(false);
  const [ganti, setGanti] = useState<Petugas | null>(null);
  const [sandiBaru, setSandiBaru] = useState('');

  const muat = useCallback(async () => {
    try {
      setItems((await client.daftar()).items);
    } catch (error) {
      setGalat(await pesanGalat(error));
      setItems([]);
    }
  }, [client]);
  useEffect(() => void muat(), [muat]);

  const siap =
    form.displayName.trim().length >= 2 && /^[a-z0-9][a-z0-9._-]{2,31}$/.test(form.username.trim().toLowerCase()) && form.password.length >= 8 && Boolean(form.branchId);

  const buat = async (e: FormEvent) => {
    e.preventDefault();
    if (!siap) return;
    setSibuk(true);
    setGalat('');
    setInfo('');
    try {
      const p = await client.buat({ ...form, displayName: form.displayName.trim(), username: form.username.trim().toLowerCase() });
      setInfo(`Akun ${p.displayName} dibuat. Login dengan username "${p.username}" dan kata sandi yang Anda isi.`);
      setForm((f) => ({ ...f, displayName: '', username: '', password: '' }));
      void muat();
    } catch (error) {
      setGalat(await pesanGalat(error));
    } finally {
      setSibuk(false);
    }
  };

  const ubahStatus = async (p: Petugas) => {
    setGalat('');
    try {
      await client.ubahStatus(p.userId, p.status !== 'ACTIVE');
      setInfo(p.status === 'ACTIVE' ? `Akun ${p.displayName} dinonaktifkan dan langsung keluar.` : `Akun ${p.displayName} aktif lagi.`);
      void muat();
    } catch (error) {
      setGalat(await pesanGalat(error));
    }
  };

  const simpanSandi = async () => {
    if (!ganti || sandiBaru.length < 8) return;
    setSibuk(true);
    try {
      await client.gantiPassword(ganti.userId, sandiBaru);
      setInfo(`Kata sandi ${ganti.displayName} diganti. Sesi lamanya keluar otomatis.`);
      setGanti(null);
      setSandiBaru('');
    } catch (error) {
      setGalat(await pesanGalat(error));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <main className="mx-auto grid max-w-4xl gap-5 p-4">
      <header>
        <h1 className="m-0 text-2xl font-semibold text-dd-ink">Petugas Check-in</h1>
        <p className="m-0 mt-1 text-[15px] text-dd-muted">
          Akun untuk sales atau OB yang hanya bertugas check-in. Mereka hanya bisa membuka layar check-in cabangnya:
          memindai QR member dan instruktur, dan mencatat kehadiran manual. Tidak bisa melihat penjualan, member, jadwal,
          atau keuangan.
        </p>
      </header>

      {info && <Feedback kind="status">{info}</Feedback>}
      {galat && <Feedback kind="error">{galat}</Feedback>}

      <form onSubmit={(e) => void buat(e)} className="grid gap-3 rounded-dd-lg border border-dd-line bg-white p-4 sm:grid-cols-2">
        <h2 className="m-0 text-lg font-semibold text-dd-ink sm:col-span-2">Tambah petugas</h2>
        <TextInput
          label="Nama"
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          maxLength={80}
        />
        <TextInput
          label="Username untuk login"
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          autoCapitalize="none"
          autoComplete="off"
          maxLength={32}
          description="Huruf kecil, angka, titik atau strip. Contoh: andi.gg"
        />
        <TextInput
          label="Kata sandi awal"
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          autoComplete="new-password"
          description="Minimal 8 karakter. Berikan langsung ke petugasnya."
        />
        <SelectInput label="Cabang" value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}>
          <option value="">Pilih cabang</option>
          {cabangList.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectInput>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!siap} loading={sibuk}>
            Buat akun petugas
          </Button>
        </div>
      </form>

      <section aria-labelledby="daftar-petugas" className="grid gap-2">
        <h2 id="daftar-petugas" className="m-0 text-lg font-semibold text-dd-ink">
          Daftar petugas
        </h2>
        {items === null && <Skeleton label="Memuat petugas check-in" />}
        {items?.length === 0 && !galat && (
          <p className="m-0 rounded-dd-lg border border-dd-line bg-white p-4 text-[15px] text-dd-muted">Belum ada petugas check-in.</p>
        )}
        {items && items.length > 0 && (
          <ul className="m-0 grid list-none gap-0 rounded-dd-lg border border-dd-line bg-white p-0">
            {items.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 border-b border-dd-line px-4 py-3 last:border-b-0">
                <div className="grid gap-0.5">
                  <span className="text-[15px] font-semibold text-dd-ink">{p.displayName}</span>
                  <span className="text-sm text-dd-muted">
                    {p.username ?? '-'} · {p.branchName ?? '-'} · {p.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setGanti(p)} disabled={p.status !== 'ACTIVE'}>
                    Ganti kata sandi
                  </Button>
                  <Button variant={p.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => void ubahStatus(p)}>
                    {p.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan lagi'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={ganti !== null}
        title={`Ganti kata sandi ${ganti?.displayName ?? ''}`}
        busy={sibuk}
        onClose={() => setGanti(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={sibuk} onClick={() => setGanti(null)}>
              Batal
            </Button>
            <Button disabled={sandiBaru.length < 8} loading={sibuk} onClick={() => void simpanSandi()}>
              Simpan kata sandi
            </Button>
          </div>
        }
      >
        <TextInput
          label="Kata sandi baru"
          type="password"
          value={sandiBaru}
          onChange={(e) => setSandiBaru(e.target.value)}
          autoComplete="new-password"
          description="Minimal 8 karakter. Petugas langsung keluar dari perangkat yang sedang dipakai."
        />
      </Modal>
    </main>
  );
}
