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
  ClassModality,
} from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const V1_DB = process.env.V1_DB ?? 'dailydose_local';
const V2_DB = decodeURIComponent(new URL(process.env.DATABASE_URL ?? 'mysql://x@localhost/').pathname.slice(1));

// ============================================================================
// CONSTANTS & MAPPINGS
// ============================================================================

const BRANCH_MAP: Record<number, string> = {
  1: 'a1000000-0000-4000-8000-000000000001', // DD-GG
  2: 'a1000000-0000-4000-8000-000000000002', // DD-MK
  3: 'a1000000-0000-4000-8000-000000000003', // DD-SBY
  4: 'a1000000-0000-4000-8000-000000000004', // DD-UNTAR
  5: 'a1000000-0000-4000-8000-000000000005', // DD-PIK2
};
const DEFAULT_BRANCH_ID = 'a1000000-0000-4000-8000-000000000001';

const CLASS_TYPE_MAP: Record<number, string> = {
  1: 'c1000000-0000-4000-8000-000000000001', // GROUP_CLASS
  2: 'c1000000-0000-4000-8000-000000000002', // PRIVATE_CLASS
  3: 'c1000000-0000-4000-8000-000000000003', // SEMI_PRIVATE
  4: 'c1000000-0000-4000-8000-000000000004', // PRIVATE_GROUP
  5: 'c1000000-0000-4000-8000-000000000005', // MEGAFORMER
};
const DEFAULT_CLASS_TYPE_ID = 'c1000000-0000-4000-8000-000000000001';

// Studio ID to Room ID & Capacity Mapping (100% verified with studio branches & real bed counts)
const STUDIO_ROOM_MAP: Record<number, { roomId: string; capacity: number; branchId: string }> = {
  1: { roomId: 'c1000000-0000-4000-8000-000000000001', capacity: 5, branchId: 'a1000000-0000-4000-8000-000000000001' }, // GG Studio 1
  2: { roomId: 'c1000000-0000-4000-8000-000000000002', capacity: 5, branchId: 'a1000000-0000-4000-8000-000000000001' }, // GG Studio 2
  3: { roomId: 'c1000000-0000-4000-8000-000000000003', capacity: 2, branchId: 'a1000000-0000-4000-8000-000000000001' }, // GG Private Studio
  4: { roomId: 'c1000000-0000-4000-8000-000000000004', capacity: 2, branchId: 'a1000000-0000-4000-8000-000000000001' }, // GG Private Studio 2
  5: { roomId: 'c1000000-0000-4000-8000-000000000005', capacity: 8, branchId: 'a1000000-0000-4000-8000-000000000002' }, // MK Group Class
  6: { roomId: 'c1000000-0000-4000-8000-000000000006', capacity: 2, branchId: 'a1000000-0000-4000-8000-000000000002' }, // MK Private Studio
  7: { roomId: 'c1000000-0000-4000-8000-000000000007', capacity: 8, branchId: 'a1000000-0000-4000-8000-000000000003' }, // SBY Group Studio
  8: { roomId: 'c1000000-0000-4000-8000-000000000008', capacity: 2, branchId: 'a1000000-0000-4000-8000-000000000003' }, // SBY Private Studio
  9: { roomId: 'c1000000-0000-4000-8000-000000000009', capacity: 6, branchId: 'a1000000-0000-4000-8000-000000000004' }, // UNTAR Group Class
  10: { roomId: 'c1000000-0000-4000-8000-000000000010', capacity: 4, branchId: 'a1000000-0000-4000-8000-000000000002' }, // MK Semi Private
  11: { roomId: 'c1000000-0000-4000-8000-000000000011', capacity: 6, branchId: 'a1000000-0000-4000-8000-000000000005' }, // PIK2 Group Class
  12: { roomId: 'c1000000-0000-4000-8000-000000000012', capacity: 2, branchId: 'a1000000-0000-4000-8000-000000000005' }, // PIK2 Private
  13: { roomId: 'c1000000-0000-4000-8000-000000000013', capacity: 8, branchId: 'a1000000-0000-4000-8000-000000000003' }, // SBY Megaformer
};

function userUuid(v1Id: number): string {
  if (v1Id === 1) return '00000000-0000-4000-8000-000000000100';
  return `10000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
}

function studioUuid(v1Id: number): string {
  return `b1000000-0000-4000-8000-${String(v1Id).padStart(12, '0')}`;
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

function parseStartAt(tanggal: any, jamMulai: any): Date {
  let dateStr = '2025-01-01';
  if (tanggal instanceof Date) {
    dateStr = tanggal.toISOString().slice(0, 10);
  } else if (typeof tanggal === 'string') {
    dateStr = tanggal.slice(0, 10);
  }

  let timeStr = '08:00:00';
  if (jamMulai instanceof Date) {
    timeStr = jamMulai.toISOString().slice(11, 19);
  } else if (typeof jamMulai === 'string') {
    timeStr = jamMulai.includes(':') ? jamMulai.slice(0, 8) : '08:00:00';
  }

  const d = new Date(`${dateStr}T${timeStr}+07:00`);
  return isNaN(d.getTime()) ? new Date('2025-01-01T08:00:00+07:00') : d;
}

async function chunkInsert<T>(
  items: T[],
  chunkSize: number,
  insertFn: (chunk: T[]) => Promise<any>,
  label: string
) {
  const total = items.length;
  let inserted = 0;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await insertFn(chunk);
    inserted += chunk.length;
    process.stdout.write(
      `\r   ... Ingesting ${label}: ${inserted}/${total} (${Math.round((inserted / total) * 100)}%)`
    );
  }
  console.log(`\n   ✓ Selesai ingesting ${total} ${label}.`);
}

// ============================================================================
// MAIN MIGRATION PROCEDURE (FROM EARLY 2025 ONWARDS)
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   DAILY DOSE PILATES: MIGRASI V1 KE V2 (DATA TAHUN 2025 AWAL KE ATAS)        ║');
  console.log(`   Sumber: ${V1_DB}  |  Target: ${V2_DB}`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const startTotal = Date.now();

  if (process.env.CONFIRM_TRUNCATE !== V2_DB) {
    throw new Error(
      `Menolak berjalan: skrip ini mengosongkan database "${V2_DB}". Jalankan dengan CONFIRM_TRUNCATE=${V2_DB} bila memang itu tujuannya.`,
    );
  }
  console.log(`🧹 [STEP 0/9] Mengosongkan seluruh tabel di database ${V2_DB}...`);
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');

  const tablesToTruncate = [
    'session_adjust_request',
    'session_ledger',
    'kehadiran_pelanggan',
    'kehadiran_instruktur',
    'instructor_check_in_token',
    'check_in_token',
    'ubah_jadwal',
    'pemesanan_kelas',
    'penugasan_instruktur',
    'instructor_fee',
    'instructor_availability',
    'slot_kelas',
    'bukti_pembayaran',
    'pembelian',
    'paket_pelanggan',
    'package_promotion',
    'paket',
    'voucher',
    'rekening_pembayaran',
    'owner_cabang',
    'profil_pengguna',
    'user_session',
    'password_action_token',
    'reminder_log',
    'support_case_note',
    'support_case',
    'email_delivery',
    'other_cost',
    'monthly_close',
    'correction_journal',
    'projection_rate',
    'min_quota_setting',
    'public_content',
    'notification_template',
    'ulasan_instruktur',
    'user',
    'ruangan',
    'studio',
    'jenis_kelas',
    'cabang',
  ];

  for (const tbl of tablesToTruncate) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${tbl}\`;`);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');
  console.log(`   ✓ Database ${V2_DB} berhasil dikosongkan.\n`);

  // --------------------------------------------------------------------------
  // STEP 1: FASILITAS (5 Cabang, 13 Studio, 13 Ruangan)
  // --------------------------------------------------------------------------
  console.log('🏢 [STEP 1/9] Memigrasikan Master Fasilitas (5 Cabang, 13 Studio, 13 Ruangan)...');

  const branches = [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      code: 'DD-GG',
      name: 'Daily Dose Green Garden',
      address: 'Komp. Ruko Green Garden Blk. A, Jl. Panjang No.30, Kedoya Utara, Kec. Kb. Jeruk, Kota Jakarta Barat, DKI Jakarta 11520',
      supportWhatsappE164: '+6281212327038',
      timezone: 'Asia/Jakarta',
      active: true,
      bankAccount: { bankName: 'Bank Central Asia', accountNumber: '6600482911', accountHolder: 'Gerald Reyner Liando' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      code: 'DD-MK',
      name: 'Daily Dose Muara Karang',
      address: 'Jalan Pluit Karang Timur No. 30 (Muara Karang Blok E 5 Timur No. 30) Pluit, Penjaringan, Jakarta Utara 14450',
      supportWhatsappE164: '+6287862151824',
      timezone: 'Asia/Jakarta',
      active: true,
      bankAccount: { bankName: 'Bank Central Asia', accountNumber: '6600491511', accountHolder: 'Gerald Reyner Liando' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000003',
      code: 'DD-SBY',
      name: 'Daily Dose Graha Family Surabaya',
      address: 'Jl. Taman Perkantoran TP 19-20, Jl. Raya Graha Famili Utara, Pradahkalikendal, Dukuhpakis, Surabaya 60277',
      supportWhatsappE164: '+62895340133103',
      timezone: 'Asia/Jakarta',
      active: true,
      bankAccount: { bankName: 'Bank Central Asia', accountNumber: '8651765765', accountHolder: 'CV SUKMEN SURABAYA PRATAMA' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000004',
      code: 'DD-UNTAR',
      name: 'Daily Dose Untar Kampus 2',
      address: 'Parking lot, Jl. Universitas Tarumanagara Kampus II No.11, Grogol petamburan, Jakarta Barat 11470',
      supportWhatsappE164: '+6289506909801',
      timezone: 'Asia/Jakarta',
      active: true,
      bankAccount: { bankName: 'Bank Central Asia', accountNumber: '08998801218', accountHolder: 'CV SUKMEN SAMAYA PRATAMA' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000005',
      code: 'DD-PIK2',
      name: 'Daily Dose Orange Groves PIK 2',
      address: 'Orange Groves PIK 2 Blok OG-08, Salembaran, Kec. Kosambi, Kabupaten Tangerang, Banten 15214',
      supportWhatsappE164: '+62895329736127',
      timezone: 'Asia/Jakarta',
      active: true,
      bankAccount: { bankName: 'Bank Central Asia', accountNumber: '8651807777', accountHolder: 'CV SUKMEN SAMATA PRATAMA' },
    },
  ];

  for (const b of branches) {
    await prisma.cabang.create({
      data: {
        id: b.id,
        code: b.code,
        name: b.name,
        address: b.address,
        supportWhatsappE164: b.supportWhatsappE164,
        timezone: b.timezone,
        active: b.active,
      },
    });

    await prisma.rekeningPembayaran.create({
      data: {
        id: randomUUID(),
        branchId: b.id,
        bankName: b.bankAccount.bankName,
        accountNumber: b.bankAccount.accountNumber,
        accountHolder: b.bankAccount.accountHolder,
        active: true,
      },
    });
  }

  const v1Studios: any[] = await prisma.$queryRawUnsafe(`
    SELECT ls.id, ls.id_location, ls.nama, ls.equipment, ls.image
    FROM ${V1_DB}.location_studios ls
    ORDER BY ls.id ASC;
  `);

  for (const s of v1Studios) {
    const sId = Number(s.id);
    const roomInfo = STUDIO_ROOM_MAP[sId] ?? {
      roomId: `c1000000-0000-4000-8000-${String(sId).padStart(12, '0')}`,
      capacity: 8,
      branchId: BRANCH_MAP[Number(s.id_location)] ?? DEFAULT_BRANCH_ID,
    };
    const stUuid = studioUuid(sId);

    await prisma.studio.create({
      data: {
        id: stUuid,
        branchId: roomInfo.branchId,
        code: `ST-${sId}`,
        name: s.nama,
        description: s.equipment ?? null,
        active: true,
      },
    });

    await prisma.ruangan.create({
      data: {
        id: roomInfo.roomId,
        studioId: stUuid,
        code: `RM-${sId}`,
        name: s.nama,
        capacityBed: roomInfo.capacity,
        active: true,
      },
    });
  }
  console.log(`   ✓ Tersimpan 5 Cabang, ${v1Studios.length} Studio, dan ${v1Studios.length} Ruangan.`);

  // --------------------------------------------------------------------------
  // STEP 2: JENIS KELAS
  // --------------------------------------------------------------------------
  console.log('\n🧘 [STEP 2/9] Memigrasikan Master Jenis Kelas...');
  const v1Kelas: any[] = await prisma.$queryRawUnsafe(`
    SELECT k.id, k.nama_kelas, k.min_anggota, k.max_anggota, k.duration, k.is_active
    FROM ${V1_DB}.kelas k
    ORDER BY k.id ASC;
  `);

  const modalityMap: Record<number, { code: string; modality: ClassModality; defaultCap: number }> = {
    1: { code: 'GROUP_CLASS', modality: ClassModality.GROUP, defaultCap: 8 },
    2: { code: 'PRIVATE_CLASS', modality: ClassModality.PRIVATE, defaultCap: 1 },
    3: { code: 'SEMI_PRIVATE', modality: ClassModality.SEMI_PRIVATE, defaultCap: 2 },
    4: { code: 'PRIVATE_GROUP', modality: ClassModality.GROUP, defaultCap: 6 },
    5: { code: 'MEGAFORMER', modality: ClassModality.GROUP, defaultCap: 8 },
  };

  for (const k of v1Kelas) {
    const kId = Number(k.id);
    const uuid = CLASS_TYPE_MAP[kId] ?? `c1000000-0000-4000-8000-${String(kId).padStart(12, '0')}`;
    const info = modalityMap[kId] ?? { code: `CLASS-${kId}`, modality: ClassModality.GROUP, defaultCap: 8 };

    await prisma.jenisKelas.create({
      data: {
        id: uuid,
        code: info.code,
        name: k.nama_kelas,
        modality: info.modality,
        durationMinutes: k.duration > 0 ? k.duration : 50,
        defaultCapacity: k.max_anggota > 0 ? k.max_anggota : info.defaultCap,
        active: k.is_active === 1,
      },
    });
  }
  console.log(`   ✓ Tersimpan ${v1Kelas.length} Jenis Kelas otentik.`);

  // --------------------------------------------------------------------------
  // STEP 3: SEMUA PENGGUNA & PROFIL (OPSI A: 9.404 PENGGUNA)
  // --------------------------------------------------------------------------
  console.log(`\n👤 [STEP 3/9] Memigrasikan Semua Pengguna & Profil dari ${V1_DB}.users (Opsi A)...`);
  const v1Users: any[] = await prisma.$queryRawUnsafe(`
    SELECT 
      u.*,
      r.name as role_name
    FROM ${V1_DB}.users u
    LEFT JOIN ${V1_DB}.model_has_roles mhr ON mhr.model_id = u.id
    LEFT JOIN ${V1_DB}.roles r ON r.id = mhr.role_id
    ORDER BY u.id ASC;
  `);

  const claimedPhones = new Set<string>();
  const usersToInsert: any[] = [];
  const profilesToInsert: any[] = [];

  for (const u of v1Users) {
    const v1Id = Number(u.id);
    const uuid = userUuid(v1Id);
    const rawEmail = u.email ? String(u.email).toLowerCase().trim() : null;

    const normPhone = normalizePhone(u.no_hp);
    let finalPhone: string | null = null;
    let duplicatePhoneNote: string | null = null;
    if (normPhone) {
      if (!claimedPhones.has(normPhone)) {
        claimedPhones.add(normPhone);
        finalPhone = normPhone;
      } else {
        duplicatePhoneNote = `Nomor HP V1 terduplikasi: ${normPhone}`;
      }
    }

    let role: Role = Role.CUSTOMER;
    const rName = u.role_name ? String(u.role_name).toLowerCase().trim() : '';
    if (v1Id === 1) {
      role = Role.SUPER_OWNER;
    } else if (rName.includes('super admin')) {
      role = Role.SUPER_OWNER;
    } else if (rName.includes('owner')) {
      role = Role.OWNER;
    } else if (rName.includes('admin')) {
      role = Role.ADMIN;
    } else if (rName.includes('finance')) {
      role = Role.FINANCE;
    } else if (rName.includes('instruktur') || rName.includes('instructor')) {
      role = Role.INSTRUCTOR;
    } else {
      role = Role.CUSTOMER;
    }

    const branchId = u.id_location ? (BRANCH_MAP[Number(u.id_location)] ?? null) : null;
    const createdAt = u.created_at ? new Date(u.created_at) : new Date();
    const updatedAt = u.updated_at ? new Date(u.updated_at) : createdAt;

    usersToInsert.push({
      id: uuid,
      email: rawEmail,
      phone: finalPhone,
      displayName: u.name || 'Member Daily Dose',
      passwordHash: u.password || null,
      role,
      status: u.deleted_at ? UserStatus.INACTIVE : UserStatus.ACTIVE,
      rememberToken: u.remember_token || null,
      preferredBranchId: branchId,
      createdAt,
      updatedAt,
    });

    profilesToInsert.push({
      id: randomUUID(),
      userId: uuid,
      fullName: u.name || null,
      gender: u.jenis_kelamin === 1 ? 'MALE' : u.jenis_kelamin === 2 ? 'FEMALE' : null,
      birthDate: u.tanggal_lahir ? new Date(u.tanggal_lahir) : null,
      address: u.alamat || null,
      nik: u.nik || null,
      ktpUrl: u.ktp || null,
      selfieUrl: u.selfie || null,
      avatarUrl: u.foto || null,
      notes: duplicatePhoneNote,
      createdAt,
      updatedAt,
    });
  }

  await chunkInsert(
    usersToInsert,
    2000,
    async (chunk) => {
      await prisma.user.createMany({ data: chunk, skipDuplicates: true });
    },
    'User'
  );

  await chunkInsert(
    profilesToInsert,
    2000,
    async (chunk) => {
      await prisma.profilPengguna.createMany({ data: chunk, skipDuplicates: true });
    },
    'ProfilPengguna'
  );

  await prisma.ownerCabang.createMany({
    data: [
      { id: randomUUID(), ownerId: userUuid(2628), branchId: 'a1000000-0000-4000-8000-000000000003' },
      { id: randomUUID(), ownerId: userUuid(8274), branchId: 'a1000000-0000-4000-8000-000000000002' },
    ],
    skipDuplicates: true,
  });

  // --------------------------------------------------------------------------
  // STEP 4: MASTER PAKET & VOUCHER
  // --------------------------------------------------------------------------
  console.log('\n📦 [STEP 4/9] Memigrasikan Master Paket dan Voucher...');
  const v1Pakets: any[] = await prisma.$queryRawUnsafe(`
    SELECT 
      p.*,
      pl.id_location
    FROM ${V1_DB}.pakets p
    LEFT JOIN (
      SELECT id_paket, MIN(id_location) as id_location
      FROM ${V1_DB}.paket_locations
      GROUP BY id_paket
    ) pl ON pl.id_paket = p.id
    ORDER BY p.id ASC;
  `);

  const packagesToInsert: any[] = [];
  for (const p of v1Pakets) {
    const pId = Number(p.id);
    const uuid = packageUuid(pId);
    const classTypeId = p.id_kelas ? (CLASS_TYPE_MAP[Number(p.id_kelas)] ?? DEFAULT_CLASS_TYPE_ID) : DEFAULT_CLASS_TYPE_ID;
    const branchId = p.id_location ? (BRANCH_MAP[Number(p.id_location)] ?? null) : null;
    const cleanCode = `PKG-${pId}-${p.nama.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase()}`;

    packagesToInsert.push({
      id: uuid,
      branchId,
      classTypeId,
      code: cleanCode,
      name: p.nama,
      sessionCount: Number(p.jumlah_pertemuan) || 1,
      validityDays: Number(p.valid_day) > 0 ? Number(p.valid_day) : 90,
      priceRp: Number(p.harga) || 0,
      description: null,
      status: p.deleted_at ? PackageStatus.ARCHIVED : PackageStatus.ACTIVE,
      createdAt: p.created_at ? new Date(p.created_at) : new Date(),
      updatedAt: p.updated_at ? new Date(p.updated_at) : new Date(),
    });
  }

  await prisma.paket.createMany({ data: packagesToInsert, skipDuplicates: true });
  console.log(`   ✓ Tersimpan ${packagesToInsert.length} Paket.`);

  const v1Vouchers: any[] = await prisma.$queryRawUnsafe(`
    SELECT v.*
    FROM ${V1_DB}.vouchers v
    ORDER BY v.id ASC;
  `);

  const vouchersToInsert: any[] = [];
  for (const v of v1Vouchers) {
    const vId = Number(v.id);
    const uuid = voucherUuid(vId);
    const isNominal = Number(v.disc_harga) > 0;

    vouchersToInsert.push({
      id: uuid,
      code: v.kode_voucher,
      name: v.nama,
      discountType: isNominal ? 'NOMINAL' : 'PERCENT',
      discountValue: isNominal ? Number(v.disc_harga) : Number(v.disc_percent) || 0,
      imageKey: v.image || null,
      description: v.deskripsi || null,
      minSpendRp: 0,
      maxDiscountRp: null,
      quota: 1000,
      usedCount: 0,
      validUntil: v.expired ? new Date(v.expired) : null,
      active: v.status === 1,
      createdAt: v.created_at ? new Date(v.created_at) : new Date(),
    });
  }

  await prisma.voucher.createMany({ data: vouchersToInsert, skipDuplicates: true });
  console.log(`   ✓ Tersimpan ${vouchersToInsert.length} Voucher.`);

  // --------------------------------------------------------------------------
  // STEP 5: PESANAN PEMBELIAN & BUKTI BAYAR (FILTER: TAHUN >= 2025 + PAKET AKTIF)
  // --------------------------------------------------------------------------
  console.log('\n💳 [STEP 5/9] Memigrasikan Pesanan Pembelian & Bukti Pembayaran (Filter: >= 2025 + Paket Aktif)...');
  const v1Orders: any[] = await prisma.$queryRawUnsafe(`
    SELECT op.*
    FROM ${V1_DB}.order_pakets op
    INNER JOIN ${V1_DB}.pakets p ON p.id = op.id_paket
    INNER JOIN ${V1_DB}.users u ON u.id = op.id_user
    WHERE op.created_at >= '2025-01-01'
       OR (op.is_active = 1 AND op.expired_date >= '2025-01-01' AND op.deleted_at IS NULL)
       OR (op.expired_date >= '2025-01-01' AND op.sisa > 0)
    ORDER BY op.id ASC;
  `);

  const purchasesToInsert: any[] = [];
  const paymentProofsToInsert: any[] = [];
  const customerPackagesToInsert: any[] = [];

  for (const op of v1Orders) {
    const opId = Number(op.id);
    const pUuid = purchaseUuid(opId);
    const uUuid = userUuid(Number(op.id_user));
    const pkgUuid = packageUuid(Number(op.id_paket));
    const bId = BRANCH_MAP[Number(op.id_location)] ?? DEFAULT_BRANCH_ID;
    const createdAt = op.created_at ? new Date(op.created_at) : new Date();
    const updatedAt = op.updated_at ? new Date(op.updated_at) : createdAt;

    let status: PurchaseStatus = PurchaseStatus.PENDING;
    if (op.status === 1) status = PurchaseStatus.PAID;
    else if (op.status === 2) status = PurchaseStatus.WAITING_VERIFICATION;
    else if (op.status === 3) status = PurchaseStatus.CANCELLED;
    if (op.deleted_at) status = PurchaseStatus.CANCELLED;

    const amount = Number(op.harga) || 0;
    const uniqueCode = amount >= 1000 && amount % 1000 > 0 ? amount % 1000 : null;
    const subtotalRp = uniqueCode ? amount - uniqueCode : amount;

    purchasesToInsert.push({
      id: pUuid,
      invoiceNumber: `INV-V1-${String(opId).padStart(8, '0')}`,
      userId: uUuid,
      branchId: bId,
      packageId: pkgUuid,
      voucherId: null,
      subtotalRp,
      discountRp: 0,
      uniqueCode,
      totalAmountRp: amount,
      status,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paidAt: op.tanggal_pembayaran ? new Date(op.tanggal_pembayaran) : status === PurchaseStatus.PAID ? createdAt : null,
      createdAt,
      updatedAt,
    });

    if (op.bukti_pembayaran && String(op.bukti_pembayaran).trim() !== '') {
      paymentProofsToInsert.push({
        id: randomUUID(),
        purchaseId: pUuid,
        fileUrl: String(op.bukti_pembayaran),
        bankName: null,
        accountHolder: null,
        notes: 'Bukti bayar historis V1',
        uploadedAt: op.tanggal_pembayaran ? new Date(op.tanggal_pembayaran) : createdAt,
      });
    }

    const totalSessions = Number(op.jumlah_pertemuan) || 1;
    const remainingSessions = Number(op.sisa) || 0;
    const usedSessions = Math.max(0, totalSessions - remainingSessions);

    const validUntilDate =
      op.expired_date && !isNaN(new Date(op.expired_date).getTime()) && new Date(op.expired_date).getFullYear() >= 2020
        ? new Date(op.expired_date)
        : new Date(createdAt.getTime() + 90 * 86400000);

    let cpStatus = CustomerPackageStatus.ACTIVE;
    if (remainingSessions <= 0) cpStatus = CustomerPackageStatus.DEPLETED;
    else if (validUntilDate < new Date() || status === PurchaseStatus.CANCELLED) cpStatus = CustomerPackageStatus.EXPIRED;
    else if (op.is_active === 0) cpStatus = CustomerPackageStatus.FROZEN;

    if (status === PurchaseStatus.WAITING_VERIFICATION || status === PurchaseStatus.PENDING) continue;

    customerPackagesToInsert.push({
      id: customerPackageUuid(opId),
      purchaseId: pUuid,
      userId: uUuid,
      packageId: pkgUuid,
      totalSessions,
      remainingSessions,
      usedSessions,
      validFrom: createdAt,
      validUntil: validUntilDate,
      status: cpStatus,
      createdAt,
      updatedAt,
    });
  }

  await chunkInsert(
    purchasesToInsert,
    2500,
    async (chunk) => {
      await prisma.pembelian.createMany({ data: chunk, skipDuplicates: true });
    },
    'Pembelian'
  );

  await chunkInsert(
    paymentProofsToInsert,
    2500,
    async (chunk) => {
      await prisma.buktiPembayaran.createMany({ data: chunk, skipDuplicates: true });
    },
    'BuktiPembayaran'
  );

  // --------------------------------------------------------------------------
  // STEP 6: SALDO & PAKET PELANGGAN
  // --------------------------------------------------------------------------
  console.log('\n🎟️ [STEP 6/9] Memigrasikan Saldo Paket Pelanggan...');
  await chunkInsert(
    customerPackagesToInsert,
    2500,
    async (chunk) => {
      await prisma.paketPelanggan.createMany({ data: chunk, skipDuplicates: true });
    },
    'PaketPelanggan'
  );

  // Paket pendamping untuk booking yang jadwalnya ada tetapi belum ada paket
  const usersWithPackage = new Set(customerPackagesToInsert.map((cp) => cp.userId));
  const usersWithBookings: any[] = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT bk.id_user
    FROM ${V1_DB}.booking_kelas bk
    INNER JOIN ${V1_DB}.kelas_activities ka ON ka.id = bk.id_kelas_activity
    WHERE ka.tanggal >= '2025-01-01';
  `);
  const usersWithBookingsNoOrders = usersWithBookings.filter((row) => !usersWithPackage.has(userUuid(Number(row.id_user))));

  for (const row of usersWithBookingsNoOrders) {
    const uId = userUuid(Number(row.id_user));
    const cpId = `50000000-0000-4000-9000-${uId.slice(-12)}`;
    await prisma.paketPelanggan.upsert({
      where: { id: cpId },
      create: {
        id: cpId,
        userId: uId,
        packageId: packageUuid(1),
        totalSessions: 1,
        remainingSessions: 0,
        usedSessions: 1,
        validFrom: new Date('2025-01-01T00:00:00+07:00'),
        validUntil: new Date('2028-12-31T23:59:59+07:00'),
        status: CustomerPackageStatus.DEPLETED,
      },
      update: {},
    });
  }
  console.log(`   ✓ Paket komplementer untuk ${usersWithBookingsNoOrders.length} pengguna siap.`);

  // --------------------------------------------------------------------------
  // STEP 7: JADWAL KELAS (FILTER: TANGGAL >= 2025-01-01)
  // --------------------------------------------------------------------------
  console.log('\n📅 [STEP 7/9] Memigrasikan Jadwal Kelas & Penugasan Instruktur (Filter: tanggal >= 2025-01-01)...');
  const v1Activities: any[] = await prisma.$queryRawUnsafe(`
    SELECT ka.*
    FROM ${V1_DB}.kelas_activities ka
    WHERE ka.tanggal >= '2025-01-01'
    ORDER BY ka.id ASC;
  `);

  const slotsToInsert: any[] = [];
  const instructorAssignments = new Set<string>();

  for (const ka of v1Activities) {
    const actId = Number(ka.id);
    const studioIdNum = ka.id_location_studio ? Number(ka.id_location_studio) : 1;
    const roomInfo = STUDIO_ROOM_MAP[studioIdNum] ?? {
      roomId: 'c1000000-0000-4000-8000-000000000001',
      capacity: 8,
      branchId: DEFAULT_BRANCH_ID,
    };

    const classTypeId = ka.id_kelas ? (CLASS_TYPE_MAP[Number(ka.id_kelas)] ?? DEFAULT_CLASS_TYPE_ID) : DEFAULT_CLASS_TYPE_ID;
    const instructorId = ka.id_user ? userUuid(Number(ka.id_user)) : null;

    if (instructorId && roomInfo.branchId) {
      instructorAssignments.add(`${instructorId}|${roomInfo.branchId}`);
    }

    const startAt = parseStartAt(ka.tanggal, ka.jam_mulai);
    const endAt = new Date(startAt.getTime() + 50 * 60 * 1000);

    let status = ClassSlotStatus.PUBLISHED;
    if (ka.deleted_at || !ka.id_location_studio) status = ClassSlotStatus.CANCELLED;
    else if (ka.status === 2) status = ClassSlotStatus.COMPLETED;
    else if (ka.status === 1) status = ClassSlotStatus.CONFIRMED;

    slotsToInsert.push({
      id: slotUuid(actId),
      branchId: roomInfo.branchId,
      studioId: studioUuid(studioIdNum),
      roomId: roomInfo.roomId,
      classTypeId,
      instructorId,
      startAt,
      endAt,
      capacity: roomInfo.capacity,
      bookedCount: 0,
      status,
      notes: ka.nama_latihan || null,
      createdAt: ka.created_at ? new Date(ka.created_at) : new Date(),
      updatedAt: ka.updated_at ? new Date(ka.updated_at) : new Date(),
    });
  }

  const assignRows = Array.from(instructorAssignments).map((pair) => {
    const [coachId, branchId] = pair.split('|');
    return {
      id: randomUUID(),
      coachId,
      branchId,
      active: true,
    };
  });
  await prisma.penugasanInstruktur.createMany({ data: assignRows, skipDuplicates: true });
  console.log(`   ✓ Terdaftar ${assignRows.length} penugasan instruktur cabang.`);

  await chunkInsert(
    slotsToInsert,
    2500,
    async (chunk) => {
      await prisma.slotKelas.createMany({ data: chunk, skipDuplicates: true });
    },
    'SlotKelas'
  );

  // --------------------------------------------------------------------------
  // STEP 8: RESERVASI BOOKING & PRESENSI (FILTER: JADWAL KELAS >= 2025)
  // --------------------------------------------------------------------------
  console.log('\n🎟️ [STEP 8/9] Memigrasikan Reservasi Booking & Presensi (Filter: Jadwal >= 2025)...');

  const allCustomerPackages = await prisma.paketPelanggan.findMany({
    select: { id: true, userId: true, validFrom: true, validUntil: true },
    orderBy: { validFrom: 'asc' },
  });
  const packagesByUser = new Map<string, Array<{ id: string; validFrom: Date; validUntil: Date }>>();
  allCustomerPackages.forEach((cp) => {
    if (!packagesByUser.has(cp.userId)) packagesByUser.set(cp.userId, []);
    packagesByUser.get(cp.userId)!.push(cp);
  });

  const v1Bookings: any[] = await prisma.$queryRawUnsafe(`
    SELECT bk.*
    FROM ${V1_DB}.booking_kelas bk
    INNER JOIN ${V1_DB}.kelas_activities ka ON ka.id = bk.id_kelas_activity
    WHERE ka.tanggal >= '2025-01-01'
    ORDER BY bk.id ASC;
  `);

  const bookingsToInsert: any[] = [];
  const attendancesToInsert: any[] = [];

  for (const bk of v1Bookings) {
    const bkId = Number(bk.id);
    const bUuid = bookingUuid(bkId);
    const uUuid = userUuid(Number(bk.id_user));
    const sUuid = slotUuid(Number(bk.id_kelas_activity));
    const createdAt = bk.created_at ? new Date(bk.created_at) : new Date();
    const updatedAt = bk.updated_at ? new Date(bk.updated_at) : createdAt;

    const userPackages = packagesByUser.get(uUuid);
    let matchedCpId: string;
    if (userPackages && userPackages.length > 0) {
      const match = userPackages.find((cp) => cp.validFrom <= createdAt && cp.validUntil >= createdAt);
      matchedCpId = match ? match.id : userPackages[0].id;
    } else {
      matchedCpId = `50000000-0000-4000-9000-${uUuid.slice(-12)}`;
    }

    let status = BookingStatus.BOOKED;
    if (bk.deleted_at) {
      status = BookingStatus.CANCELLED;
    } else if (bk.status_kehadiran === 1) {
      status = BookingStatus.ATTENDED;
    } else if (bk.status_kehadiran === 2) {
      status = BookingStatus.NO_SHOW;
    }

    bookingsToInsert.push({
      id: bUuid,
      bookingNumber: `BKG-V1-${String(bkId).padStart(8, '0')}`,
      classSlotId: sUuid,
      userId: uUuid,
      customerPackageId: matchedCpId,
      status,
      bookedAt: createdAt,
      cancelledAt: bk.deleted_at ? new Date(bk.deleted_at) : null,
      cancellationReason: bk.deleted_at ? 'Dibatalkan pada V1' : null,
      createdAt,
      updatedAt,
    });

    if (status === BookingStatus.ATTENDED) {
      attendancesToInsert.push({
        id: randomUUID(),
        bookingId: bUuid,
        method: CheckInMethod.QR_SCAN,
        checkedInAt: createdAt,
        notes: bk.keterangan || null,
      });
    }
  }

  await chunkInsert(
    bookingsToInsert,
    2500,
    async (chunk) => {
      await prisma.pemesananKelas.createMany({ data: chunk, skipDuplicates: true });
    },
    'PemesananKelas'
  );

  await chunkInsert(
    attendancesToInsert,
    2500,
    async (chunk) => {
      await prisma.kehadiranPelanggan.createMany({ data: chunk, skipDuplicates: true });
    },
    'KehadiranPelanggan'
  );

  // --------------------------------------------------------------------------
  // STEP 9: SINKRONISASI BOOKED COUNT PER SLOT & KYC MARKING
  // --------------------------------------------------------------------------
  console.log('\n📊 [STEP 9/9] Mengagregasikan Booked Count & Menandai Pelanggan Aktif KYC...');
  await prisma.$executeRawUnsafe(`
    UPDATE ${V2_DB}.slot_kelas sk
    JOIN (
      SELECT classSlotId, COUNT(*) as cnt
      FROM ${V2_DB}.pemesanan_kelas
      WHERE status IN ('BOOKED', 'ATTENDED')
      GROUP BY classSlotId
    ) b ON b.classSlotId = sk.id
    SET sk.bookedCount = b.cnt;
  `);
  console.log('   ✓ Booked count slot kelas berhasil disinkronkan.');

  const kycMarked = await prisma.$executeRawUnsafe(`
    UPDATE ${V2_DB}.profil_pengguna p
    SET p.notes = CASE WHEN p.notes IS NULL OR p.notes = '' THEN 'KYC_APPROVED' ELSE CONCAT(p.notes, ' | KYC_APPROVED') END
    WHERE (p.notes IS NULL OR p.notes NOT LIKE '%KYC_APPROVED%')
      AND p.userId IN (
        SELECT userId FROM ${V2_DB}.pembelian WHERE status = 'PAID'
        UNION
        SELECT userId FROM ${V2_DB}.pemesanan_kelas WHERE status = 'ATTENDED'
      );
  `);
  console.log(`   ✓ ${kycMarked} pelanggan lama ditandai KYC_APPROVED.`);

  const totalTime = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║   ✅ MIGRASI 2025 V1 KE V2 SELESAI DENGAN SUKSES DALAM ${totalTime} DETIK!               ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');
}

main()
  .catch((err) => {
    console.error('❌ FATAL ERROR PADA MIGRASI:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
