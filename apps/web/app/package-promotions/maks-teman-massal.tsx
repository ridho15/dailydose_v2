'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '../components/admin/admin-ui';
import { AlertBanner, Drawer, useAppFeedback } from '../components/app-feedback';
import { Button } from '../components/actions';
import { TextInput } from '../components/forms';
import {
  ALASAN_GAGAL_MASSAL,
  browserPackagePromotionClient,
  paketGagalMassal,
  promotionFailure,
  type KandidatMaksTeman,
} from '@/api-clients/package-promotion-client';

/** Batas yang sama dengan server (`MAKS_TEMAN_PAKET`). */
export const MAKS_TEMAN = 5;

/** Ringkasan paket terpilih: cukup untuk menampilkan nilai lama → nilai baru dan peringatan. */
export type PaketTerpilih = Pick<
  KandidatMaksTeman,
  'id' | 'name' | 'maksTeman' | 'effectiveState' | 'effectiveUntil' | 'perpanjanganMasaAktif'
>;

/** Paket yang tidak aktif atau sudah berakhir masa jualnya: boleh diubah, tetapi diberi peringatan. */
export function perluPeringatan(p: Pick<PaketTerpilih, 'effectiveState'>): string | null {
  if (p.effectiveState === 'INACTIVE' || p.effectiveState === 'ARCHIVED') return 'Tidak aktif';
  if (p.effectiveState === 'EXPIRED') return 'Berakhir';
  return null;
}

const labelTeman = (n: number) => (n === 0 ? 'Tidak bawa teman' : `${n} teman`);

/** Bar aksi yang muncul saat ada paket terpilih. */
export function BarAksiMassal({
  jumlah,
  onUbah,
  onBatal,
}: {
  jumlah: number;
  onUbah(): void;
  onBatal(): void;
}) {
  if (!jumlah) return null;
  return (
    <div
      role="region"
      aria-label="Aksi untuk paket terpilih"
      className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-dd-lg border border-dd-forest/30 bg-dd-surface p-3 shadow-lg"
    >
      <p className="m-0 text-sm font-semibold text-dd-ink" aria-live="polite">
        {jumlah} paket dipilih
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBatal}>
          Batalkan pilihan
        </Button>
        <Button onClick={onUbah}>Ubah maksimal teman ({jumlah} paket)</Button>
      </div>
    </div>
  );
}

/**
 * Dialog edit massal: angka baru, alasan (wajib, masuk audit log), dan ringkasan nilai lama → nilai
 * baru per paket. Perubahan ini metadata: tidak membuat revisi paket dan tidak mengubah order lama.
 */
export function DialogMaksTemanMassal({
  open,
  paket,
  onClose,
  onKeluarkan,
  onSaved,
}: {
  open: boolean;
  paket: PaketTerpilih[];
  onClose(): void;
  /** Mengeluarkan paket dari pilihan (mis. paket perpanjangan). */
  onKeluarkan(ids: string[]): void;
  onSaved(jumlah: number): Promise<void>;
}) {
  const feedback = useAppFeedback();
  const [nilai, setNilai] = useState('');
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState('');
  const [gagal, setGagal] = useState<Array<{ id: string; issue: string }>>([]);

  useEffect(() => {
    if (!open) return;
    setNilai('');
    setAlasan('');
    setGalat('');
    setGagal([]);
  }, [open]);

  const angka = nilai === '' ? null : Number(nilai);
  const angkaValid = angka !== null && Number.isInteger(angka) && angka >= 0 && angka <= MAKS_TEMAN;
  const perpanjangan = useMemo(
    () => (angkaValid && angka! > 0 ? paket.filter((p) => p.perpanjanganMasaAktif) : []),
    [paket, angka, angkaValid],
  );
  const peringatan = paket.filter((p) => perluPeringatan(p));
  const berubah = angkaValid ? paket.filter((p) => p.maksTeman !== angka).length : 0;
  const bisaSimpan = angkaValid && alasan.trim().length >= 3 && paket.length > 0 && !perpanjangan.length && !busy;
  const nama = new Map(paket.map((p) => [p.id, p.name]));

  return (
    <Drawer
      open={open}
      title="Ubah maksimal teman per kelas"
      onClose={onClose}
      busy={busy}
      dirty={nilai !== '' || alasan !== ''}
      onDirtyClose={() =>
        feedback.confirm({
          tone: 'warning',
          title: 'Batalkan perubahan massal?',
          message: 'Angka dan alasan yang sudah diisi akan hilang.',
          confirmLabel: 'Buang perubahan',
        })
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form="maks-teman-massal-form" loading={busy} disabled={!bisaSimpan}>
            Simpan untuk {paket.length} paket
          </Button>
        </div>
      }
    >
      <form
        id="maks-teman-massal-form"
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!bisaSimpan || angka === null) return;
          setBusy(true);
          setGalat('');
          setGagal([]);
          try {
            const hasil = await browserPackagePromotionClient.simpanMaksTemanMassal({
              packageIds: paket.map((p) => p.id),
              maksTeman: angka,
              reason: alasan.trim(),
            });
            await onSaved(hasil.updated.length);
          } catch (error) {
            const daftar = paketGagalMassal(error);
            if (daftar.length) {
              setGagal(daftar);
              setGalat('Tidak ada paket yang diubah. Perbaiki paket di bawah ini lalu simpan lagi.');
            } else {
              setGalat(await promotionFailure(error, 'Perubahan belum tersimpan. Periksa koneksi lalu coba lagi.'));
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput
          name="maksTemanMassal"
          label="Maksimal teman per kelas"
          type="number"
          min={0}
          max={MAKS_TEMAN}
          step={1}
          inputMode="numeric"
          value={nilai}
          onChange={(event) => setNilai(event.target.value)}
          error={nilai !== '' && !angkaValid ? `Isi angka bulat 0 sampai ${MAKS_TEMAN}.` : undefined}
          description="0 = tidak boleh bawa teman, 2 = pemilik bisa datang bertiga. Tiap kursi teman memotong 1 sesi paket pemilik. Paket yang sudah dibeli member langsung memakai angka baru untuk booking berikutnya; booking yang sudah ada tidak berubah."
          required
        />
        <TextInput
          name="alasanMassal"
          label="Alasan perubahan (Audit Log)"
          placeholder="Contoh: TRIO PASS bisa datang bertiga"
          value={alasan}
          onChange={(event) => setAlasan(event.target.value)}
          minLength={3}
          maxLength={500}
          required
        />

        {galat && <AlertBanner tone="danger" title="Perubahan dibatalkan" message={galat} />}
        {gagal.length > 0 && (
          <ul className="m-0 grid gap-1 rounded-dd-md border border-dd-danger/40 bg-dd-danger/5 p-3 text-sm" aria-label="Paket yang gagal">
            {gagal.map((g) => (
              <li key={g.id}>
                <strong>{nama.get(g.id) ?? g.id}</strong>: {ALASAN_GAGAL_MASSAL[g.issue] ?? g.issue}
              </li>
            ))}
          </ul>
        )}
        {perpanjangan.length > 0 && (
          <div className="grid gap-2 rounded-dd-md border border-dd-warning/40 bg-dd-warning/10 p-3 text-sm">
            <p className="m-0">
              {perpanjangan.length} paket perpanjangan masa aktif tidak punya sesi, jadi tidak bisa membawa teman.
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => onKeluarkan(perpanjangan.map((p) => p.id))}>
                Keluarkan {perpanjangan.length} paket perpanjangan
              </Button>
            </div>
          </div>
        )}
        {peringatan.length > 0 && (
          <p className="m-0 flex items-start gap-2 rounded-dd-md border border-dd-warning/40 bg-dd-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {peringatan.length} paket berstatus Tidak aktif atau Berakhir ikut diubah. Pastikan memang disengaja.
          </p>
        )}

        <section aria-labelledby="ringkasan-massal-title" className="grid gap-2">
          <h3 id="ringkasan-massal-title" className="m-0 text-sm font-bold text-dd-ink">
            Paket yang akan berubah ({paket.length})
            {angkaValid && berubah < paket.length && (
              <span className="ml-1 font-normal text-dd-muted">· {paket.length - berubah} sudah bernilai {angka}</span>
            )}
          </h3>
          <ul className="m-0 grid max-h-80 list-none gap-0 overflow-y-auto rounded-dd-md border border-dd-line p-0">
            {paket.map((p) => {
              const tanda = perluPeringatan(p);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-dd-line px-3 py-2 text-sm last:border-b-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-dd-ink">{p.name}</span>
                    {tanda && <Badge tone="warning">{tanda}</Badge>}
                    {p.perpanjanganMasaAktif && <Badge tone="neutral">Perpanjangan</Badge>}
                  </span>
                  <span className="tabular-nums text-dd-muted">
                    {labelTeman(p.maksTeman)} → <strong className="text-dd-ink">{angkaValid ? labelTeman(angka!) : '…'}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </form>
    </Drawer>
  );
}
