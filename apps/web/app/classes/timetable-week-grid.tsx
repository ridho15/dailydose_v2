'use client';

import { useState, type KeyboardEvent } from 'react';
import { Lock } from 'lucide-react';
import type { ClassSlot } from '@/api-clients/class-slot-client';
import { geserDenganPanah, nadaKeterisian, type PosisiKalender } from './class-slot-presenters';

/** Kelas yang ditampilkan di satu sel sebelum sisanya diringkas jadi "+N kelas lagi". */
const BATAS_TAMPIL = 2;

/** Ikon titik enam: tanda kelas yang belum ada pesertanya dan boleh diseret. */
function TitikEnam({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {[6, 12, 18].flatMap((y) =>
        [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />),
      )}
    </svg>
  );
}

export function labelHari(hari: string) {
  const tanggal = new Date(`${hari}T12:00:00Z`);
  const namaHari = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' }).format(
    tanggal,
  );
  return `${namaHari} ${tanggal.getUTCDate()}`;
}

/**
 * Kalender satu minggu: baris jam x kolom hari, seperti mockup.
 *
 * Pemindahan tidak langsung disimpan. Kelas yang diseret (atau digeser dengan panah) hanya
 * berpindah di layar dan bergaris putus-putus sampai staf menekan Simpan pemindahan; dengan begitu
 * satu seretan yang meleset tidak langsung mengubah jadwal yang sudah dilihat member.
 */
export function TimetableWeekGrid({
  days,
  hours,
  todayKey,
  slots,
  posisi,
  tertunda,
  selectedId,
  canMove,
  namaTipe,
  namaInstruktur,
  onSelect,
  onStage,
}: {
  days: readonly string[];
  hours: readonly number[];
  todayKey: string;
  slots: readonly ClassSlot[];
  /** Posisi kelas saat ini, sudah memperhitungkan pemindahan yang belum disimpan. */
  posisi(slot: ClassSlot): PosisiKalender;
  tertunda: Readonly<Record<string, PosisiKalender>>;
  selectedId: string | null;
  canMove: boolean;
  namaTipe(slot: ClassSlot): string;
  namaInstruktur(slot: ClassSlot): string;
  onSelect(slot: ClassSlot): void;
  /** `null` membatalkan pemindahan kelas itu. */
  onStage(slot: ClassSlot, tujuan: PosisiKalender | null): void;
}) {
  const [seret, setSeret] = useState<ClassSlot | null>(null);
  const [sasaran, setSasaran] = useState<string | null>(null);
  const [diangkat, setDiangkat] = useState<string | null>(null);
  const [selPenuh, setSelPenuh] = useState<Set<string>>(new Set());

  // Kelas dikelompokkan ke selnya sekali per render. Dulu setiap sel (7 hari x belasan jam)
  // menyaring semua kelas, sehingga minggu yang padat membuat satu klik terasa tertahan.
  const perSel = new Map<string, ClassSlot[]>();
  for (const slot of slots) {
    const p = posisi(slot);
    const kunci = `${p.hari}-${p.jam}`;
    const isi = perSel.get(kunci);
    if (isi) isi.push(slot);
    else perSel.set(kunci, [slot]);
  }

  const bisaDipindah = (slot: ClassSlot) =>
    canMove &&
    slot.bookedCount === 0 &&
    slot.status !== 'CANCELLED' &&
    slot.status !== 'AUTO_CANCELLED' &&
    slot.status !== 'COMPLETED';

  /** Enter mengangkat kelas kosong; panah memindahkannya; Enter lagi menaruh, Escape membatalkan. */
  const tekanTombol = (slot: ClassSlot, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!bisaDipindah(slot)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      setDiangkat((kini) => (kini === slot.id ? null : slot.id));
      return;
    }
    if (diangkat !== slot.id) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onStage(slot, null);
      setDiangkat(null);
      return;
    }
    const tujuan = geserDenganPanah(posisi(slot), event.key, days, hours);
    if (tujuan) {
      event.preventDefault();
      onStage(slot, tujuan);
    }
  };

  const chip = (slot: ClassSlot) => {
    const dibatalkan = slot.status === 'CANCELLED' || slot.status === 'AUTO_CANCELLED';
    const nada = nadaKeterisian(slot);
    const bebas = bisaDipindah(slot);
    const dipilih = selectedId === slot.id;
    const berpindah = Boolean(tertunda[slot.id]) || diangkat === slot.id;
    const kurangHariIni = !dibatalkan && nada === 'kurang' && posisi(slot).hari === todayKey;

    const bingkai = dibatalkan
      ? 'border border-dd-danger/50 bg-dd-danger-soft p-[7px]'
      : dipilih
        ? 'border-2 border-dd-forest bg-white p-[6px]'
        : berpindah
          ? 'border-2 border-dashed border-dd-forest bg-dd-success-soft p-[6px]'
          : kurangHariIni
            ? 'border border-dd-warning-line bg-dd-warning-soft p-[7px]'
            : bebas
              ? 'border border-dd-forest bg-dd-success-soft/60 p-[7px]'
              : 'border border-dd-border-interactive bg-white p-[7px]';

    const angka = dibatalkan
      ? 'Dibatalkan'
      : nada === 'kosong'
        ? `Kosong, 0/${slot.capacity}`
        : nada === 'penuh'
          ? `${slot.bookedCount}/${slot.capacity} penuh`
          : `${slot.bookedCount}/${slot.capacity}`;

    const status = dibatalkan
      ? 'kelas dibatalkan'
      : bebas
        ? diangkat === slot.id
          ? 'sedang dipindah, pakai panah lalu Enter'
          : 'belum ada peserta, bisa dipindah'
        : `${slot.bookedCount} peserta sudah booking, jadwal terkunci`;

    return (
      <button
        type="button"
        key={slot.id}
        draggable={bebas}
        aria-pressed={dipilih}
        aria-label={`${namaTipe(slot)}, ${namaInstruktur(slot)}. ${angka}, ${status}`}
        title={status}
        onClick={() => onSelect(slot)}
        onKeyDown={(event) => tekanTombol(slot, event)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          setSeret(slot);
        }}
        onDragEnd={() => {
          setSeret(null);
          setSasaran(null);
        }}
        className={`flex w-full min-w-0 flex-col overflow-hidden rounded-[7px] text-left transition focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] ${bingkai} ${
          bebas ? 'cursor-grab' : 'cursor-pointer hover:border-dd-forest'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {bebas ? (
            <TitikEnam className="size-[13px] shrink-0 text-dd-forest" />
          ) : (
            <Lock
              className="size-[13px] shrink-0 text-dd-muted"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          )}
          <span className="truncate text-[13px] font-bold text-dd-ink">{namaTipe(slot)}</span>
        </span>
        <span className="truncate text-[13px] text-dd-muted">{namaInstruktur(slot)}</span>
        <div className="flex items-center justify-between gap-1">
          <span
            className={`text-[13px] font-bold ${
              dibatalkan ? 'text-dd-danger' : nada === 'kurang' ? 'text-dd-warning' : 'text-dd-forest'
            }`}
          >
            {angka}
          </span>
          {slot.bookingCutoffHours != null && !dibatalkan && (
            <span
              className="rounded bg-dd-forest/10 px-1 py-0.2 text-[10px] font-semibold text-dd-forest"
              title={`Batas booking: ${slot.bookingCutoffHours} jam sebelum kelas`}
            >
              H-{Math.round(slot.bookingCutoffHours / 24) || 1}
            </span>
          )}
        </div>
      </button>
    );
  };

  const kolom = '62px repeat(7, minmax(0, 1fr))';

  return (
    <div
      className="min-w-[980px] overflow-hidden rounded-dd-md border border-dd-border-interactive bg-white"
      role="region"
      aria-label="Kalender kelas tujuh hari"
    >
      <div
        className="grid border-b border-dd-border-interactive bg-white"
        style={{ gridTemplateColumns: kolom }}
      >
        <span aria-hidden="true" />
        {days.map((day) => (
          <p
            key={day}
            className={`m-0 border-l border-dd-line/70 px-1 py-2.5 text-center text-[13px] font-bold ${
              day === todayKey ? 'bg-dd-success-soft text-dd-forest' : 'text-dd-muted'
            }`}
          >
            {labelHari(day)}
            {day === todayKey && <span className="block">hari ini</span>}
          </p>
        ))}
      </div>

      {hours.map((hour) => (
        <div
          key={hour}
          className="grid min-h-14 border-b border-dd-line/70 last:border-b-0"
          style={{ gridTemplateColumns: kolom }}
        >
          <p className="m-0 pr-2 pt-1.5 text-right text-[13px] text-dd-muted">
            {String(hour).padStart(2, '0')}.00
          </p>
          {days.map((day) => {
            const kunci = `${day}-${hour}`;
            const diSini = perSel.get(kunci) ?? [];
            const penuhkan = selPenuh.has(kunci) || diSini.length <= BATAS_TAMPIL + 1;
            const tampil = penuhkan ? diSini : diSini.slice(0, BATAS_TAMPIL);
            const tersembunyi = diSini.length - tampil.length;
            const jadiTujuan = seret !== null && sasaran === kunci;

            return (
              <div
                key={kunci}
                className={`flex min-w-0 flex-col gap-[3px] border-l border-dd-line/70 p-[3px] ${
                  day === todayKey ? 'bg-dd-success-soft/40' : ''
                }`}
                onDragOver={(event) => {
                  if (!seret) return;
                  // Tanpa preventDefault peramban menolak lepasan di sel ini.
                  event.preventDefault();
                  setSasaran(kunci);
                }}
                onDragLeave={() => setSasaran((kini) => (kini === kunci ? null : kini))}
                onDrop={(event) => {
                  event.preventDefault();
                  const dipindah = seret;
                  setSeret(null);
                  setSasaran(null);
                  if (dipindah) onStage(dipindah, { hari: day, jam: hour });
                }}
              >
                {tampil.map(chip)}
                {jadiTujuan && (
                  <div className="flex min-h-[50px] w-full items-center justify-center rounded-[7px] border-2 border-dashed border-dd-forest bg-dd-success-soft p-1">
                    <span className="text-center text-[13px] font-bold text-dd-forest">
                      Lepas di sini
                    </span>
                  </div>
                )}
                {tersembunyi > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelPenuh((kini) => new Set(kini).add(kunci))}
                    className="w-full rounded-[7px] border border-dashed border-dd-border-interactive px-1 py-1 text-[13px] font-bold text-dd-forest transition hover:border-dd-forest focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
                  >
                    +{tersembunyi} kelas lagi
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Keterangan dan tombol simpan di bawah kalender, seperti mockup. */
export function TimetableMoveBar({
  jumlahTertunda,
  saving,
  onSave,
  onCancel,
}: {
  jumlahTertunda: number;
  saving: boolean;
  onSave(): void;
  onCancel(): void;
}) {
  return (
    <div className="mt-3.5 flex flex-wrap items-start gap-3.5 rounded-dd-md border border-dd-border-interactive bg-white p-4">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 size-[22px] shrink-0 text-dd-forest"
        aria-hidden="true"
      >
        <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
      </svg>
      <div className="min-w-0 flex-[1_1_360px]">
        <p className="m-0 mb-2 text-base font-bold text-dd-ink">
          Hanya kelas yang belum ada pesertanya bisa dipindah
        </p>
        <div className="mb-2 flex flex-wrap gap-[18px]">
          <span className="flex items-center gap-[7px] text-[15px] text-dd-ink">
            <TitikEnam className="size-[15px] text-dd-forest" />
            Titik enam, kelas kosong, bisa diseret
          </span>
          <span className="flex items-center gap-[7px] text-[15px] text-dd-ink">
            <Lock className="size-[15px] text-dd-muted" strokeWidth={2.2} aria-hidden="true" />
            Gembok, sudah ada peserta, jadwal terkunci
          </span>
        </div>
        <p className="m-0 mb-1.5 text-[15px] leading-normal text-dd-muted">
          Begitu satu orang booking, kelas itu terkunci di jamnya. Memindahkannya berarti
          memindahkan jadwal orang yang sudah menyiapkan waktunya, dan itu bukan keputusan yang
          pantas diambil dengan seretan tangan.
        </p>
        <p className="m-0 text-[15px] text-dd-muted">
          Tanpa tetikus: pilih kelas kosong, tekan Enter, lalu pakai tombol panah untuk memindahkan.
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          disabled={jumlahTertunda === 0 || saving}
          onClick={onSave}
          className="min-h-11 rounded-[9px] border-0 bg-dd-forest px-4 text-[15px] font-bold text-white transition hover:bg-dd-forest-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? 'Menyimpan…'
            : jumlahTertunda > 1
              ? `Simpan ${jumlahTertunda} pemindahan`
              : 'Simpan pemindahan'}
        </button>
        <button
          type="button"
          disabled={jumlahTertunda === 0 || saving}
          onClick={onCancel}
          className="min-h-11 rounded-[9px] border border-dd-border-interactive bg-white px-4 text-[15px] font-bold text-dd-ink transition hover:border-dd-forest disabled:cursor-not-allowed disabled:opacity-50"
        >
          Batalkan
        </button>
      </div>
    </div>
  );
}
