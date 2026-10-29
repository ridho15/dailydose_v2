/**
 * Pemeriksaan data jadwal setelah perpindahan V1 ke V2. HANYA MEMBACA; tidak ada data yang diubah.
 *
 * Jalankan di server:  node --import ./node_modules/tsx/dist/loader.mjs prisma/cek-data-jadwal.ts
 *
 * Yang dilaporkan (kelas yang belum berjalan, dari hari ini):
 *  1. Angka terisi tersimpan berbeda dengan jumlah booking yang benar-benar ada.
 *  2. Kapasitas kelas berbeda dengan kapasitas tipe kelasnya (mis. Private Group 8 orang).
 *  3. Booking berstatus Hadir padahal kelasnya belum berjalan (tanda "hadir" H-24 dari V1).
 *  4. Member yang punya lebih dari satu booking aktif di kelas yang sama.
 *  5. Kelas V1 dua minggu ke depan yang belum ada di V2 (bila database V1 ada di server yang sama).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MENEMPATI = ['BOOKED', 'ATTENDED', 'NO_SHOW'] as const;

const tgl = (d: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Jakarta',
  }).format(d);

async function main() {
  const now = new Date();
  const slots = await prisma.slotKelas.findMany({
    where: { startAt: { gte: now }, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      startAt: true,
      capacity: true,
      bookedCount: true,
      branch: { select: { name: true } },
      classType: { select: { name: true, defaultCapacity: true } },
      instructor: { select: { displayName: true } },
      _count: { select: { bookings: { where: { status: { in: [...MENEMPATI] } } } } },
    },
    orderBy: { startAt: 'asc' },
  });
  const label = (s: (typeof slots)[number]) =>
    `${tgl(s.startAt)} · ${s.branch.name} · ${s.classType.name} · ${s.instructor?.displayName ?? '-'}`;

  console.log(`\nKelas yang belum berjalan: ${slots.length}\n`);

  const selisih = slots.filter((s) => s.bookedCount !== s._count.bookings);
  console.log(`1. Angka terisi tidak cocok dengan booking: ${selisih.length} kelas`);
  for (const s of selisih.slice(0, 30))
    console.log(`   - ${label(s)}: tersimpan ${s.bookedCount}, booking nyata ${s._count.bookings}`);
  if (selisih.length > 30) console.log(`   … dan ${selisih.length - 30} lainnya`);
  console.log('   (Setelah update, timetable sudah memakai jumlah booking nyata.)\n');

  const kapasitas = slots.filter((s) => s.capacity !== s.classType.defaultCapacity);
  const perTipe = new Map<string, { jumlah: number; contoh: string[] }>();
  for (const s of kapasitas) {
    const kunci = `${s.classType.name}: kapasitas kelas ${s.capacity}, tipe kelas ${s.classType.defaultCapacity}`;
    const ada = perTipe.get(kunci) ?? { jumlah: 0, contoh: [] };
    ada.jumlah += 1;
    if (ada.contoh.length < 3) ada.contoh.push(label(s));
    perTipe.set(kunci, ada);
  }
  console.log(`2. Kapasitas berbeda dari tipe kelasnya: ${kapasitas.length} kelas`);
  for (const [kunci, v] of perTipe) {
    console.log(`   - ${kunci} (${v.jumlah} kelas), mis. ${v.contoh.join(' | ')}`);
  }
  console.log('');

  const hadirDini = await prisma.pemesananKelas.findMany({
    where: { status: 'ATTENDED', classSlot: { startAt: { gt: now } } },
    select: {
      bookingNumber: true,
      user: { select: { displayName: true } },
      classSlot: {
        select: {
          startAt: true,
          branch: { select: { name: true } },
          classType: { select: { name: true } },
        },
      },
    },
    orderBy: { classSlot: { startAt: 'asc' } },
  });
  console.log(`3. Booking "Hadir" untuk kelas yang belum berjalan: ${hadirDini.length}`);
  for (const b of hadirDini.slice(0, 30))
    console.log(
      `   - ${b.user.displayName} · ${tgl(b.classSlot.startAt)} · ${b.classSlot.branch.name} · ${b.classSlot.classType.name} (${b.bookingNumber})`,
    );
  if (hadirDini.length > 30) console.log(`   … dan ${hadirDini.length - 30} lainnya`);
  console.log('');

  const ganda: Array<{ userId: string; classSlotId: string; jumlah: bigint }> =
    await prisma.$queryRawUnsafe(`
    SELECT b.userId, b.classSlotId, COUNT(*) AS jumlah
    FROM pemesanan_kelas b
    JOIN slot_kelas s ON s.id = b.classSlotId
    WHERE b.status IN ('BOOKED', 'ATTENDED') AND s.startAt >= NOW()
    GROUP BY b.userId, b.classSlotId
    HAVING COUNT(*) > 1
  `);
  console.log(`4. Member dengan booking ganda di kelas yang sama: ${ganda.length}`);
  for (const g of ganda.slice(0, 30)) {
    const [u, s] = await Promise.all([
      prisma.user.findUnique({ where: { id: g.userId }, select: { displayName: true } }),
      prisma.slotKelas.findUnique({
        where: { id: g.classSlotId },
        select: { startAt: true, branch: { select: { name: true } } },
      }),
    ]);
    console.log(
      `   - ${u?.displayName} · ${s ? `${tgl(s.startAt)} · ${s.branch.name}` : g.classSlotId}: ${g.jumlah} booking`,
    );
  }
  console.log('');

  try {
    const v1: Array<{ jumlah: bigint; idTerbesar: number | null }> = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS jumlah, MAX(ka.id) AS idTerbesar
      FROM dailydose_v1.kelas_activities ka
      WHERE ka.deleted_at IS NULL
        AND ka.tanggal BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)
    `);
    const v2 = await prisma.slotKelas.count({
      where: {
        startAt: { gte: now, lte: new Date(now.getTime() + 14 * 86_400_000) },
        id: { startsWith: '70000000-0000-4000-8000-' },
      },
    });
    console.log(
      `5. Kelas V1 dua minggu ke depan: ${v1[0]?.jumlah ?? 0} (nomor terbesar ${v1[0]?.idTerbesar ?? '-'}); yang berasal dari V1 di V2: ${v2}`,
    );
    console.log(
      '   Bila jauh berbeda, jalankan ulang sinkronisasi dengan DELTA_KELAS_DARI dan DELTA_BOOKING_DARI yang lebih kecil.\n',
    );
  } catch {
    console.log('5. Database V1 tidak tersedia di server ini; bagian ini dilewati.\n');
  }
}

main()
  .catch((e) => {
    console.error('Pemeriksaan gagal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
