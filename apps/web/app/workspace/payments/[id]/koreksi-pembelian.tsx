'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { Button } from '../../../components/actions';
import { Modal } from '../../../components/app-feedback';
import { SelectInput, Textarea, TextInput } from '../../../components/forms';
import { formatRupiah } from '../../../lib/formatters';
import { Feedback } from '../../../ui';

/**
 * Koreksi pembelian yang sudah lunas, khusus Super Owner: batalkan (void) atau pindahkan ke member
 * lain. API menolak role lain dengan 403; komponen ini hanya dirender untuk Super Owner.
 */

type Pratinjau = {
  purchaseId: string;
  invoiceNumber: string;
  status: string;
  member: { id: string; displayName: string };
  paket: { id: string; name: string };
  nominalRp: number;
  sisaSesi: number;
  sesiTerpakai: number;
  bookingAktif: number;
  riwayat: Array<{ id: string; jenis: string; kodeAlasan: string; alasan: string; createdAt: string }>;
};

const KODE_ALASAN: Array<{ value: string; label: string }> = [
  { value: 'SALAH_INPUT_AKUN', label: 'Salah input akun member' },
  { value: 'DUPLIKAT', label: 'Pembelian dobel' },
  { value: 'SALAH_PAKET', label: 'Salah paket' },
  { value: 'REFUND', label: 'Refund ke member' },
  { value: 'LAINNYA', label: 'Lainnya' },
];

const PESAN: Record<string, string> = {
  PURCHASE_HAS_ACTIVE_BOOKINGS: 'Paket ini masih punya booking aktif. Centang "Batalkan booking aktif" untuk melanjutkan.',
  PURCHASE_HAS_USED_SESSIONS: 'Sebagian sesi paket ini sudah terpakai.',
  PURCHASE_NOT_PAID: 'Hanya pembelian yang sudah lunas yang bisa dikoreksi.',
  SAME_MEMBER: 'Member tujuan sama dengan pemilik sekarang.',
  RESOURCE_NOT_FOUND: 'Member tujuan tidak ditemukan atau bukan akun member aktif.',
  FORBIDDEN: 'Hanya Super Owner yang bisa mengoreksi pembelian.',
  VALIDATION_ERROR: 'Lengkapi kode alasan dan alasan (minimal 20 karakter).',
};

const pesan = (error: unknown) =>
  (error instanceof ApiError && error.code && PESAN[error.code]) ||
  (error instanceof Error ? error.message : 'Koreksi gagal.');

type Mode = 'void' | 'pindah' | null;

export function KoreksiPembelian({ purchaseId, onSelesai }: { purchaseId: string; onSelesai(): void }) {
  const [data, setData] = useState<Pratinjau | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [langkah, setLangkah] = useState<1 | 2>(1);
  const [kodeAlasan, setKodeAlasan] = useState('SALAH_INPUT_AKUN');
  const [alasan, setAlasan] = useState('');
  const [batalkanBooking, setBatalkanBooking] = useState(false);
  const [cari, setCari] = useState('');
  const [hasilCari, setHasilCari] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [tujuan, setTujuan] = useState<{ id: string; label: string } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [gagal, setGagal] = useState('');

  const muat = () =>
    apiFetch<Pratinjau>(`/purchases/${encodeURIComponent(purchaseId)}/koreksi`, { label: 'Memuat koreksi…' })
      .then(setData)
      .catch(() => setData(null));

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId]);

  useEffect(() => {
    if (mode !== 'pindah' || cari.trim().length < 3) {
      setHasilCari([]);
      return;
    }
    const timer = window.setTimeout(() => {
      apiFetch<{ items: Array<{ id: string; label: string; description?: string }> }>(
        `/lookups/customers?${new URLSearchParams({ q: cari.trim(), limit: '8', includeWithoutPackage: 'true' })}`,
      )
        .then((res) => setHasilCari((res.items ?? []).filter((item) => item.id !== data?.member.id)))
        .catch(() => setHasilCari([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cari, mode, data?.member.id]);

  if (!data) return null;
  const lunas = data.status === 'PAID';
  const sebagian = data.sesiTerpakai > 0;

  const buka = (m: Mode) => {
    setMode(m);
    setLangkah(1);
    setAlasan('');
    setGagal('');
    setBatalkanBooking(false);
    setTujuan(null);
    setCari('');
  };

  const siap =
    alasan.trim().length >= 20 &&
    (mode === 'void' ? Boolean(kodeAlasan) : Boolean(tujuan)) &&
    (data.bookingAktif === 0 || batalkanBooking);

  const jalankan = async () => {
    setSibuk(true);
    setGagal('');
    try {
      if (mode === 'void')
        await apiFetch(`/purchases/${encodeURIComponent(purchaseId)}/void`, {
          method: 'POST',
          body: JSON.stringify({ kodeAlasan, alasan: alasan.trim(), batalkanBooking, sebagian }),
        });
      else
        await apiFetch(`/purchases/${encodeURIComponent(purchaseId)}/transfer`, {
          method: 'POST',
          body: JSON.stringify({
            keUserId: tujuan?.id,
            alasan: alasan.trim(),
            batalkanBooking,
            konfirmasiTerpakai: sebagian,
          }),
        });
      setMode(null);
      await muat();
      onSelesai();
    } catch (error) {
      setGagal(pesan(error));
      setLangkah(1);
    } finally {
      setSibuk(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-dd-line pt-4">
      <p className="m-0 text-sm font-semibold text-dd-ink">Koreksi pembelian (Super Owner)</p>
      {lunas ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => buka('pindah')}>
            Pindahkan ke member lain
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-dd-danger hover:bg-dd-danger-soft hover:text-dd-danger"
            onClick={() => buka('void')}
          >
            Batalkan pembelian
          </Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-dd-muted">Hanya pembelian yang sudah lunas yang bisa dibatalkan atau dipindahkan.</p>
      )}
      {data.riwayat.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0 text-xs text-dd-muted">
          {data.riwayat.map((r) => (
            <li key={r.id}>
              {new Date(r.createdAt).toLocaleString('id-ID')} · {r.jenis} · {r.kodeAlasan}: {r.alasan}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={mode !== null}
        title={mode === 'void' ? 'Batalkan pembelian' : 'Pindahkan ke member lain'}
        description={`${data.invoiceNumber} · ${data.paket.name} · ${data.member.displayName}`}
        busy={sibuk}
        onClose={() => setMode(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={sibuk} onClick={() => (langkah === 2 ? setLangkah(1) : setMode(null))}>
              {langkah === 2 ? 'Kembali' : 'Batal'}
            </Button>
            {langkah === 1 ? (
              <Button disabled={!siap} onClick={() => setLangkah(2)}>
                Lanjut
              </Button>
            ) : (
              <Button disabled={sibuk} onClick={() => void jalankan()}>
                {mode === 'void' ? 'Ya, batalkan pembelian' : 'Ya, pindahkan'}
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-3 text-sm">
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-dd-muted">Member</dt>
            <dd className="m-0 font-semibold">{data.member.displayName}</dd>
            <dt className="text-dd-muted">Paket</dt>
            <dd className="m-0">{data.paket.name}</dd>
            <dt className="text-dd-muted">Nominal</dt>
            <dd className="m-0">{formatRupiah(data.nominalRp)}</dd>
            <dt className="text-dd-muted">Sisa sesi</dt>
            <dd className="m-0">{data.sisaSesi}</dd>
            <dt className="text-dd-muted">Sesi terpakai</dt>
            <dd className="m-0">{data.sesiTerpakai}</dd>
            <dt className="text-dd-muted">Booking aktif</dt>
            <dd className="m-0">{data.bookingAktif}</dd>
          </dl>

          {sebagian && (
            <Feedback kind="warning">
              {mode === 'void'
                ? `${data.sesiTerpakai} sesi sudah terpakai, jadi pembelian ini dibatalkan sebagian: sisa sesi dinolkan, omzet tidak berubah.`
                : `${data.sesiTerpakai} sesi sudah terpakai oleh ${data.member.displayName}. Riwayat itu tetap atas namanya; yang pindah sisa sesinya.`}
            </Feedback>
          )}
          {data.bookingAktif > 0 && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={batalkanBooking} onChange={(e) => setBatalkanBooking(e.target.checked)} />
              <span>Batalkan {data.bookingAktif} booking aktif dari paket ini (wajib untuk melanjutkan).</span>
            </label>
          )}

          {langkah === 1 ? (
            <>
              {mode === 'void' ? (
                <SelectInput label="Kode alasan" value={kodeAlasan} onChange={(e) => setKodeAlasan(e.target.value)}>
                  {KODE_ALASAN.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </SelectInput>
              ) : (
                <div className="grid gap-2">
                  <TextInput
                    label="Member tujuan"
                    placeholder="Ketik nama atau nomor WhatsApp (min. 3 huruf)"
                    value={tujuan ? tujuan.label : cari}
                    onChange={(e) => {
                      setTujuan(null);
                      setCari(e.target.value);
                    }}
                  />
                  {!tujuan && hasilCari.length > 0 && (
                    <ul className="m-0 list-none divide-y divide-dd-line rounded-dd-md border border-dd-line p-0">
                      {hasilCari.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="w-full bg-transparent px-3 py-2 text-left hover:bg-dd-surface-muted"
                            onClick={() => setTujuan({ id: item.id, label: item.label })}
                          >
                            <span className="block font-semibold">{item.label}</span>
                            {item.description && <span className="block text-xs text-dd-muted">{item.description}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <Textarea
                label="Alasan (minimal 20 karakter)"
                rows={3}
                value={alasan}
                maxLength={500}
                onChange={(e) => setAlasan(e.target.value)}
              />
            </>
          ) : (
            <Feedback kind="warning">
              {mode === 'void'
                ? sebagian
                  ? `Sisa ${data.sisaSesi} sesi akan dinolkan. Tindakan ini tercatat di audit dan tidak bisa dibatalkan dari layar.`
                  : `Pembelian ${formatRupiah(data.nominalRp)} akan dibatalkan dan keluar dari omzet, dan paket ${data.member.displayName} tidak bisa dipakai lagi. Tindakan ini tercatat di audit.`
                : `Pembelian dan paket akan dipindahkan dari ${data.member.displayName} ke ${tujuan?.label}. Nominal, tanggal bayar, dan masa berlaku tetap. Tindakan ini tercatat di audit.`}
            </Feedback>
          )}
          {gagal && <Feedback kind="error">{gagal}</Feedback>}
        </div>
      </Modal>
    </div>
  );
}
