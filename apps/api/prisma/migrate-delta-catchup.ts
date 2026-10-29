import {
  PrismaClient,
  Role,
  UserStatus,
  PackageStatus,
  PurchaseStatus,
  PaymentMethod,
  CustomerPackageStatus,
  ClassSlotStatus,
  BookingStatus,
  CheckInMethod,
} from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// Map branch V1 ID (1..5) to V2 Branch UUID
const BRANCH_MAP: Record<number, string> = {
  1: 'a1000000-0000-4000-8000-000000000001', // DD-GG
  2: 'a1000000-0000-4000-8000-000000000002', // DD-MK
  3: 'a1000000-0000-4000-8000-000000000003', // DD-SBY
  4: 'a1000000-0000-4000-8000-000000000004', // DD-UNTAR
  5: 'a1000000-0000-4000-8000-000000000005', // DD-PIK2
};
const DEFAULT_BRANCH_ID = 'a1000000-0000-4000-8000-000000000001';

// Map class type V1 ID (1..5) to V2 ClassType UUID
const CLASS_TYPE_MAP: Record<number, string> = {
  1: 'c1000000-0000-4000-8000-000000000001', // GROUP_CLASS
  2: 'c1000000-0000-4000-8000-000000000002', // PRIVATE_CLASS
  3: 'c1000000-0000-4000-8000-000000000003', // SEMI_PRIVATE
  4: 'c1000000-0000-4000-8000-000000000004', // PRIVATE_GROUP
  5: 'c1000000-0000-4000-8000-000000000005', // MEGAFORMER
};
const DEFAULT_CLASS_TYPE_ID = 'c1000000-0000-4000-8000-000000000001';

function userUuid(v1Id: number): string {
  if (v1Id === 1) return '00000000-0000-4000-8000-000000000100';
  return `10000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function packageUuid(v1Id: number): string {
  return `20000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function voucherUuid(v1Id: number): string {
  return `30000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function purchaseUuid(v1Id: number): string {
  return `40000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function customerPackageUuid(v1Id: number): string {
  return `50000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function slotUuid(v1Id: number): string {
  return `70000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function bookingUuid(v1Id: number): string {
  return `80000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || raw === 'NULL') return null;
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('0')) cleaned = '+62' + cleaned.slice(1);
  else if (cleaned.startsWith('62')) cleaned = '+' + cleaned;
  else if (!cleaned.startsWith('+') && cleaned.length >= 8) cleaned = '+62' + cleaned;
  if (cleaned.length < 9 || cleaned.length > 20) return null;
  return cleaned;
}

async function main() {
  console.log('================================================================================');
  console.log('🚀 EKSEKUSI DELTA CATCH-UP MIGRATION: V1 KE V2 (18 AGUSTUS - 15 SEPTEMBER 2026)');
  console.log('================================================================================\n');

  // --------------------------------------------------------------------------
  // TAHAP 1: Sinkronisasi 154 Member Baru (users)
  // --------------------------------------------------------------------------
  console.log('👤 [1/5] Memeriksa dan mengekstrak member baru dari dailydose_v1.users...');
  const existingUsers = await prisma.user.findMany({
    select: { id: true, email: true, phone: true },
  });
  const claimedEmails = new Set(existingUsers.map((u) => u.email?.toLowerCase().trim()).filter(Boolean));
  const claimedPhones = new Set(existingUsers.map((u) => u.phone).filter(Boolean));

  const deltaUsersRaw: any[] = await prisma.$queryRawUnsafe(`
    SELECT u.*
    FROM dailydose_v1.users u
    WHERE u.id >= 9110
    ORDER BY u.id ASC;
  `);
  console.log(`   ✓ Ditemukan ${deltaUsersRaw.length} baris pengguna baru di V1.`);

  let insertedUsersCount = 0;
  for (const u of deltaUsersRaw) {
    const v1Id = Number(u.id);
    const rawEmail = u.email ? String(u.email).toLowerCase().trim() : null;
    if (!rawEmail || claimedEmails.has(rawEmail)) continue;
    claimedEmails.add(rawEmail);

    const uuid = userUuid(v1Id);
    const normPhone = normalizePhone(u.no_hp);
    let finalPhone: string | null = null;
    if (normPhone && !claimedPhones.has(normPhone)) {
      claimedPhones.add(normPhone);
      finalPhone = normPhone;
    }

    const branchId = u.id_location ? (BRANCH_MAP[Number(u.id_location)] ?? null) : null;
    const createdAt = u.created_at ? new Date(u.created_at) : new Date();
    const updatedAt = u.updated_at ? new Date(u.updated_at) : createdAt;

    const genderStr = u.jenis_kelamin === 1 ? 'MALE' : u.jenis_kelamin === 2 ? 'FEMALE' : null;

    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: uuid },
        create: {
          id: uuid,
          email: rawEmail,
          phone: finalPhone,
          displayName: u.name ? String(u.name).trim() : 'Member Daily Dose',
          passwordHash: u.password || null,
          role: Role.MEMBER,
          status: UserStatus.ACTIVE,
          preferredBranchId: branchId,
          createdAt,
          updatedAt,
        },
        update: {},
      });

      await tx.profilPengguna.upsert({
        where: { userId: uuid },
        create: {
          id: randomUUID(),
          userId: uuid,
          fullName: u.name ? String(u.name).trim() : 'Member Daily Dose',
          gender: genderStr,
          birthDate: u.tanggal_lahir ? new Date(u.tanggal_lahir) : null,
          address: u.alamat || null,
          avatarUrl: u.foto || null,
          createdAt,
          updatedAt,
        },
        update: {},
      });
    });
    insertedUsersCount++;
  }
  console.log(`   ✅ Berhasil menyinkronkan ${insertedUsersCount} member baru ke V2.\n`);

  // --------------------------------------------------------------------------
  // TAHAP 2: Sinkronisasi 5 Katalog Paket Baru (pakets)
  // --------------------------------------------------------------------------
  console.log('📦 [2/5] Memeriksa dan mengekstrak katalog paket baru dari dailydose_v1.pakets...');
  const deltaPaketsRaw: any[] = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM dailydose_v1.pakets
    WHERE id >= 127
    ORDER BY id ASC;
  `);
  console.log(`   ✓ Ditemukan ${deltaPaketsRaw.length} paket baru di V1.`);

  let insertedPaketCount = 0;
  for (const p of deltaPaketsRaw) {
    const v1Id = Number(p.id);
    const uuid = packageUuid(v1Id);
    const classTypeId = CLASS_TYPE_MAP[Number(p.id_kelas)] || DEFAULT_CLASS_TYPE_ID;
    const createdAt = p.created_at ? new Date(p.created_at) : new Date();
    const updatedAt = p.updated_at ? new Date(p.updated_at) : createdAt;

    await prisma.paket.upsert({
      where: { id: uuid },
      create: {
        id: uuid,
        code: `PK-V1-${v1Id}`,
        name: String(p.nama).trim(),
        classTypeId,
        sessionCount: Number(p.jumlah_pertemuan),
        validityDays: Number(p.valid_day),
        priceRp: Number(p.harga),
        description: p.deskripsi ? String(p.deskripsi).trim() : null,
        status: p.deleted_at ? PackageStatus.ARCHIVED : PackageStatus.ACTIVE,
        createdAt,
        updatedAt,
      },
      update: {},
    });
    insertedPaketCount++;
  }
  console.log(`   ✅ Berhasil menyinkronkan ${insertedPaketCount} katalog paket baru ke V2.\n`);

  // --------------------------------------------------------------------------
  // TAHAP 3: Sinkronisasi 300 Transaksi Pembelian & Saldo Sesi (order_pakets)
  // --------------------------------------------------------------------------
  console.log('💳 [3/5] Memproses 300 order pembelian delta dan saldo kuota member...');
  const deltaOrdersRaw: any[] = await prisma.$queryRawUnsafe(`
    SELECT op.*, vc.id_voucher
    FROM dailydose_v1.order_pakets op
    LEFT JOIN dailydose_v1.voucher_customers vc ON vc.id_order_paket = op.id
    WHERE op.id > 16704
    ORDER BY op.id ASC;
  `);
  console.log(`   ✓ Ditemukan ${deltaOrdersRaw.length} order pesanan baru di V1.`);

  let insertedOrderCount = 0;
  let insertedProofCount = 0;
  let insertedCustPkgCount = 0;

  for (const op of deltaOrdersRaw) {
    const orderId = Number(op.id);
    const oUuid = purchaseUuid(orderId);
    const uUuid = userUuid(Number(op.id_user));
    const pUuid = packageUuid(Number(op.id_paket));
    const bUuid = BRANCH_MAP[Number(op.id_location)] || DEFAULT_BRANCH_ID;
    const vUuid = op.id_voucher ? voucherUuid(Number(op.id_voucher)) : null;

    const createdAt = op.created_at ? new Date(op.created_at) : new Date();
    const updatedAt = op.updated_at ? new Date(op.updated_at) : createdAt;
    const paidAt = op.status === 1 ? (op.tanggal_pembayaran ? new Date(op.tanggal_pembayaran) : createdAt) : null;
    const priceRp = Number(op.harga);

    let status: PurchaseStatus = PurchaseStatus.PENDING;
    if (op.status === 1) status = PurchaseStatus.PAID;
    else if (op.status === 2) status = PurchaseStatus.WAITING_VERIFICATION;
    else if (op.status === 0) status = PurchaseStatus.CANCELLED;

    // Pastikan voucherId valid jika ada
    let validVoucherId: string | null = null;
    if (vUuid) {
      const vExists = await prisma.voucher.findUnique({ where: { id: vUuid }, select: { id: true } });
      if (vExists) validVoucherId = vUuid;
    }

    await prisma.pembelian.upsert({
      where: { id: oUuid },
      create: {
        id: oUuid,
        invoiceNumber: `INV-V1-${String(orderId).padStart(6, '0')}`,
        userId: uUuid,
        branchId: bUuid,
        packageId: pUuid,
        voucherId: validVoucherId,
        subtotalRp: priceRp,
        discountRp: 0,
        totalAmountRp: priceRp,
        status,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paidAt,
        createdAt,
        updatedAt,
      },
      update: {},
    });
    insertedOrderCount++;

    // Bukti pembayaran
    if (op.bukti_pembayaran && String(op.bukti_pembayaran).trim() !== '' && op.bukti_pembayaran !== 'NULL') {
      await prisma.buktiPembayaran.upsert({
        where: { purchaseId: oUuid },
        create: {
          id: randomUUID(),
          purchaseId: oUuid,
          fileUrl: String(op.bukti_pembayaran).trim(),
          uploadedAt: createdAt,
        },
        update: {},
      });
      insertedProofCount++;
    }

    // Saldo Paket Pelanggan jika status = PAID
    if (op.status === 1) {
      const cpUuid = customerPackageUuid(orderId);
      const totalSessions = Number(op.jumlah_pertemuan);
      const remainingSessions = Number(op.sisa);
      const usedSessions = Math.max(0, totalSessions - remainingSessions);
      const validFrom = paidAt || createdAt;
      const validUntil = op.expired_date ? new Date(op.expired_date) : new Date('2026-12-31T23:59:59+07:00');

      let cpStatus: CustomerPackageStatus = CustomerPackageStatus.ACTIVE;
      if (remainingSessions === 0) {
        cpStatus = CustomerPackageStatus.DEPLETED;
      } else if (validUntil < new Date()) {
        cpStatus = CustomerPackageStatus.EXPIRED;
      }

      await prisma.paketPelanggan.upsert({
        where: { id: cpUuid },
        create: {
          id: cpUuid,
          purchaseId: oUuid,
          userId: uUuid,
          packageId: pUuid,
          totalSessions,
          remainingSessions,
          usedSessions,
          validFrom,
          validUntil,
          status: cpStatus,
          createdAt,
          updatedAt,
        },
        update: {},
      });
      insertedCustPkgCount++;
    }
  }
  console.log(
    `   ✅ Berhasil menyinkronkan ${insertedOrderCount} pembelian, ${insertedProofCount} bukti transfer, dan ${insertedCustPkgCount} paket saldo member.\n`,
  );

  // --------------------------------------------------------------------------
  // TAHAP 4: Sinkronisasi 1.483 Jadwal Slot Kelas Baru (kelas_activities)
  // --------------------------------------------------------------------------
  console.log('📅 [4/5] Memproses 1.483 slot jadwal kelas baru dari dailydose_v1.kelas_activities...');
  const studios = await prisma.studio.findMany({ select: { id: true, branchId: true } });
  const studioBranchMap = new Map(studios.map((s) => [s.id, s.branchId]));
  const defaultStudioId = studios[0]?.id;

  const deltaSlotsRaw: any[] = await prisma.$queryRawUnsafe(`
    SELECT ka.*
    FROM dailydose_v1.kelas_activities ka
    WHERE ka.id > 75768
    ORDER BY ka.id ASC;
  `);
  console.log(`   ✓ Ditemukan ${deltaSlotsRaw.length} jadwal sesi baru di V1.`);

  let insertedSlotCount = 0;
  for (const ka of deltaSlotsRaw) {
    const actId = Number(ka.id);
    const sUuid = slotUuid(actId);
    const studioNum = Number(ka.id_location_studio);
    const studioUuid = `b1000000-0000-4000-8000-${String(studioNum === 0 ? 1 : studioNum).padStart(12, '0')}`;
    const studioId = (studioBranchMap.has(studioUuid) ? studioUuid : defaultStudioId) || 'b1000000-0000-4000-8000-000000000001';
    const branchId = studioBranchMap.get(studioId) || DEFAULT_BRANCH_ID;

    const classTypeId = CLASS_TYPE_MAP[Number(ka.id_kelas)] || DEFAULT_CLASS_TYPE_ID;
    const coachIdNum = Number(ka.id_user);
    const instructorId = coachIdNum > 0 ? userUuid(coachIdNum) : null;

    const createdAt = ka.created_at ? new Date(ka.created_at) : new Date();
    const updatedAt = ka.updated_at ? new Date(ka.updated_at) : createdAt;

    let startAt: Date;
    if (ka.tanggal && ka.jam_mulai) {
      const tStr = String(ka.tanggal).slice(0, 10);
      const jStr = String(ka.jam_mulai).slice(0, 8);
      startAt = new Date(`${tStr}T${jStr}+07:00`);
      if (isNaN(startAt.getTime())) startAt = createdAt;
    } else {
      startAt = createdAt;
    }
    const endAt = new Date(startAt.getTime() + 50 * 60 * 1000);

    let status: ClassSlotStatus = ClassSlotStatus.COMPLETED;
    if (ka.deleted_at || ka.status === 4) {
      status = ClassSlotStatus.CANCELLED;
    } else if (startAt > new Date()) {
      status = ClassSlotStatus.PUBLISHED;
    }

    await prisma.slotKelas.upsert({
      where: { id: sUuid },
      create: {
        id: sUuid,
        branchId,
        studioId,
        classTypeId,
        instructorId,
        startAt,
        endAt,
        capacity: 10,
        bookedCount: 0,
        status,
        notes: ka.nama_latihan ? `Nama Latihan: ${String(ka.nama_latihan).trim()}` : null,
        createdAt,
        updatedAt,
      },
      update: {},
    });
    insertedSlotCount++;
  }
  console.log(`   ✅ Berhasil menyinkronkan ${insertedSlotCount} slot kelas baru ke V2.\n`);

  // --------------------------------------------------------------------------
  // TAHAP 5: Sinkronisasi 1.572 Pemesanan & Presensi (booking_kelas)
  // --------------------------------------------------------------------------
  console.log('🎟️ [5/5] Memproses 1.572 tiket booking dan riwayat presensi...');
  // Ambil paket pelanggan per user untuk relasi customerPackageId
  const allCustPackages = await prisma.paketPelanggan.findMany({
    select: { id: true, userId: true, validFrom: true, validUntil: true },
    orderBy: { createdAt: 'desc' },
  });
  const packagesByUser = new Map<string, typeof allCustPackages>();
  for (const cp of allCustPackages) {
    if (!packagesByUser.has(cp.userId)) packagesByUser.set(cp.userId, []);
    packagesByUser.get(cp.userId)!.push(cp);
  }

  const deltaBookingsRaw: any[] = await prisma.$queryRawUnsafe(`
    SELECT bk.*
    FROM dailydose_v1.booking_kelas bk
    WHERE bk.id > 132488
    ORDER BY bk.id ASC;
  `);
  console.log(`   ✓ Ditemukan ${deltaBookingsRaw.length} booking baru di V1.`);

  let insertedBookingCount = 0;
  let insertedAttendanceCount = 0;

  // V1 menandai booking yang lewat batas H-24 sebagai "hadir" walau kelasnya belum berjalan. Di V2
  // "Hadir" berarti sudah datang, jadi hanya kelas yang sudah selesai yang boleh berstatus hadir;
  // kelas yang belum berjalan tetap booking aktif dan masih bisa dibatalkan.
  const akhirKelas = new Map(
    (await prisma.slotKelas.findMany({ select: { id: true, endAt: true } })).map((s) => [s.id, s.endAt]),
  );
  const kelasSudahSelesai = (slotId: string) =>
    (akhirKelas.get(slotId)?.getTime() ?? 0) <= Date.now();

  for (const bk of deltaBookingsRaw) {
    const bkgId = Number(bk.id);
    const bUuid = bookingUuid(bkgId);
    const uUuid = userUuid(Number(bk.id_user));
    const sUuid = slotUuid(Number(bk.id_kelas_activity));
    const createdAt = bk.created_at ? new Date(bk.created_at) : new Date();
    const updatedAt = bk.updated_at ? new Date(bk.updated_at) : createdAt;

    // Cari paket kuota pelanggan
    let userPackages = packagesByUser.get(uUuid) || [];
    let customerPackageId = userPackages[0]?.id;
    if (userPackages.length > 1) {
      const match = userPackages.find((cp) => cp.validFrom <= createdAt && cp.validUntil >= createdAt);
      if (match) customerPackageId = match.id;
    }

    // Jika user belum punya paket sama sekali, buat paket komplementer
    if (!customerPackageId) {
      const compPkgId = `50000000-0000-4000-9000-${uUuid.slice(-12)}`;
      await prisma.paketPelanggan.upsert({
        where: { id: compPkgId },
        create: {
          id: compPkgId,
          userId: uUuid,
          packageId: '20000000-0000-4000-8000-000000000001',
          totalSessions: 1,
          remainingSessions: 0,
          usedSessions: 1,
          validFrom: new Date('2023-08-01T00:00:00+07:00'),
          validUntil: new Date('2026-12-31T23:59:59+07:00'),
          status: CustomerPackageStatus.DEPLETED,
        },
        update: {},
      });
      customerPackageId = compPkgId;
      packagesByUser.set(uUuid, [{ id: compPkgId, userId: uUuid, validFrom: createdAt, validUntil: createdAt }]);
    }

    const isAttended = bk.status_kehadiran === 1 && kelasSudahSelesai(sUuid);
    const isCancelled = Boolean(bk.deleted_at);

    let status: BookingStatus = BookingStatus.BOOKED;
    if (isAttended) status = BookingStatus.ATTENDED;
    else if (isCancelled) status = BookingStatus.CANCELLED;

    await prisma.pemesananKelas.upsert({
      where: { id: bUuid },
      create: {
        id: bUuid,
        bookingNumber: `BKG-V1-${String(bkgId).padStart(8, '0')}`,
        classSlotId: sUuid,
        userId: uUuid,
        customerPackageId,
        status,
        bookedAt: createdAt,
        createdAt,
        updatedAt,
      },
      update: {},
    });
    insertedBookingCount++;

    // Increment bookedCount pada slot kelas jika tidak dibatalkan
    if (!isCancelled) {
      await prisma.slotKelas.update({
        where: { id: sUuid },
        data: { bookedCount: { increment: 1 } },
      });
    }

    // Rekam Presensi
    if (isAttended) {
      await prisma.kehadiranPelanggan.upsert({
        where: { bookingId: bUuid },
        create: {
          id: randomUUID(),
          bookingId: bUuid,
          method: CheckInMethod.MANUAL_FRONTDESK,
          checkedInAt: createdAt,
          recordedById: '00000000-0000-4000-8000-000000000100',
          notes: bk.keterangan ? String(bk.keterangan).trim() : 'Presensi terverifikasi dari V1',
        },
        update: {},
      });
      insertedAttendanceCount++;
    }
  }
  console.log(
    `   ✅ Berhasil menyinkronkan ${insertedBookingCount} pemesanan kelas dan ${insertedAttendanceCount} riwayat presensi.\n`,
  );

  console.log('================================================================================');
  console.log('🎉 SELURUH TAHAPAN DELTA CATCH-UP MIGRATION SELESAI DENGAN SUKSES!');
  console.log('================================================================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Terjadi kesalahan saat migrasi delta:', e);
  await prisma.$disconnect();
  process.exit(1);
});
