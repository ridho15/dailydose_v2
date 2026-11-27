export type FrontendPageGroup =
  | 'Operasional Studio'
  | 'Member & Pelanggan'
  | 'Penjualan & Keuangan'
  | 'Pengaturan & Sistem';

export interface FrontendPageDefinition {
  href: string;
  label: string;
  shortLabel: string;
  description: string;
  group: FrontendPageGroup;
  capabilities: string[];
  mutationCapabilities?: string[];
  priority: number;
  /**
   * Cakupan cabang halaman: `topbar` mengikuti pemilih "Cabang aktif" di topbar; `global` mencakup
   * semua cabang yang diizinkan dan pemilih di topbar dinonaktifkan.
   */
  branchScope: 'topbar' | 'global';
  accent: 'brand' | 'info' | 'warning' | 'neutral';
  icon?: string;
  roleRelevance?: string[];
  queueBadgeSource?: string;
  dashboardDeepLink?: string;
  isAdvanced?: boolean;
  /** Tidak tampil di menu samping; halaman dibuka dari tombol di halaman lain. */
  hideFromNav?: boolean;
  isDormant?: boolean;
  /**
   * `preview`: halaman belum memakai penyimpanan/sumber data permanen. Diberi tag "Pratinjau" di
   * navigasi dan banner `previewNote` di header agar staf tidak menganggapnya catatan resmi.
   */
  maturity?: 'preview';
  previewNote?: string;
}

export const frontendPages: FrontendPageDefinition[] = [
  // ==========================================
  // 1. OPERASIONAL STUDIO (Tugas Harian Staf)
  // ==========================================
  {
    href: '/workspace',
    label: 'Ringkasan',
    shortLabel: 'Dashboard',
    description: 'Konteks sesi, cabang aktif, dan pintasan pekerjaan sesuai hak akses.',
    group: 'Operasional Studio',
    capabilities: [],
    priority: 1,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'layout-dashboard',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER', 'FINANCE', 'INSTRUCTOR'],
  },
  {
    href: '/workspace/classes',
    label: 'Timetable kelas',
    shortLabel: 'Timetable kelas',
    description: 'Susun jadwal, tugaskan instruktur, lalu publikasikan atau batalkan kelas.',
    group: 'Operasional Studio',
    capabilities: ['class-slot:read'],
    mutationCapabilities: ['class-slot:manage'],
    priority: 2,
    branchScope: 'topbar',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'],
  },
  {
    href: '/workspace/bookings',
    label: 'Manajemen Booking',
    shortLabel: 'Booking',
    description: 'Booking bantuan, antrean perubahan jadwal, QR, dan kehadiran pelanggan.',
    group: 'Operasional Studio',
    capabilities: ['booking:read', 'reschedule:read'],
    mutationCapabilities: ['booking:create:assisted', 'reschedule:decide'],
    priority: 3,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'book-open-check',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'],
    queueBadgeSource: 'reschedules',
    dashboardDeepLink: '/workspace/bookings?tab=reschedules&status=PENDING',
  },
  {
    href: '/workspace/check-in',
    label: 'Check-in hari ini',
    shortLabel: 'Check-in',
    description:
      'Kartu check-in dengan foto selfie, kelas yang perlu diputuskan atau ditutup, dan peserta yang tidak hadir.',
    group: 'Operasional Studio',
    capabilities: ['attendance:manage', 'attendance:desk'],
    priority: 3,
    branchScope: 'topbar',
    accent: 'brand',
    roleRelevance: ['ADMIN', 'MANAGER', 'SUPER_OWNER', 'CHECKIN_STAFF'],
  },
  {
    href: '/workspace/availability',
    label: 'Ketersediaan Mengajar',
    shortLabel: 'Ketersediaan',
    description: 'Ajukan dan lihat jam Anda tersedia mengajar di cabang aktif.',
    group: 'Operasional Studio',
    capabilities: ['availability:self:read'],
    mutationCapabilities: ['availability:self:create'],
    priority: 7,
    branchScope: 'topbar',
    accent: 'brand',
    roleRelevance: ['INSTRUCTOR'],
  },
  {
    href: '/workspace/payroll',
    label: 'Payroll saya',
    shortLabel: 'Payroll',
    description: 'Honor dari kelas yang check-in Anda terverifikasi, koreksi jam, dan riwayatnya.',
    group: 'Operasional Studio',
    capabilities: ['attendance:self'],
    priority: 8,
    branchScope: 'global',
    accent: 'brand',
    roleRelevance: ['INSTRUCTOR'],
  },
  {
    href: '/workspace/reminders',
    label: 'Otomasi & Log Pengingat WhatsApp',
    shortLabel: 'Otomasi WA',
    description: 'Monitoring sistem auto-cancel kelas H-24 dan antrean notifikasi WhatsApp berjenjang.',
    group: 'Operasional Studio',
    capabilities: ['automation:read'],
    mutationCapabilities: ['automation:run'],
    priority: 6,
    branchScope: 'global',
    accent: 'brand',
    icon: 'message-square',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER'],
    isAdvanced: true,
  },
  {
    href: '/workspace/ulasan',
    label: 'Ulasan instruktur',
    shortLabel: 'Ulasan',
    description:
      'Nilai bintang dan catatan member untuk instruktur kelas yang mereka hadiri. Internal, tidak tampil di situs.',
    group: 'Operasional Studio',
    capabilities: ['instructor-review:read'],
    priority: 7,
    branchScope: 'topbar',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER'],
  },
  {
    href: '/help',
    label: 'Pusat Panduan & Bantuan',
    shortLabel: 'Panduan',
    description: 'Panduan lengkap dan resmi untuk Pelanggan, Admin Cabang, dan Super Owner.',
    group: 'Operasional Studio',
    capabilities: [],
    priority: 8,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'book-open',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER', 'ADMIN', 'FINANCE', 'INSTRUCTOR'],
    hideFromNav: true,
  },
  {
    href: '/workspace/guide',
    label: 'Panduan Operasional Staf',
    shortLabel: 'SOP Studio',
    description: 'Tata cara operasional Front Desk, Finance, dan Super Owner mengelola studio.',
    group: 'Operasional Studio',
    capabilities: [],
    priority: 8,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'book-open',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER', 'ADMIN', 'FINANCE', 'INSTRUCTOR'],
    // Dibuka dari ikon bantuan di bilah atas.
    hideFromNav: true,
  },

  // ==========================================
  // 2. MEMBER & PELANGGAN (Membership)
  // ==========================================
  {
    href: '/workspace/renewal',
    // Digabung ke Paket member (27 Nov 2026): tetap bisa dibuka lewat tautan, tidak tampil di menu.
    hideFromNav: true,
    label: 'Paket habis & renewal',
    shortLabel: 'Paket habis & renewal',
    description:
      'Siapa yang paketnya habis, berapa rupiah yang belum kembali, dan siapa yang perlu dihubungi lebih dulu.',
    group: 'Member & Pelanggan',
    capabilities: ['package:read'],
    priority: 1,
    branchScope: 'topbar',
    accent: 'warning',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'],
  },
  {
    href: '/customers',
    label: 'Data Pelanggan',
    shortLabel: 'Member & Paket',
    description: 'Profil pelanggan terpadu, keamanan akun, order, paket, booking, dan timeline.',
    group: 'Member & Pelanggan',
    capabilities: ['customer:read'],
    mutationCapabilities: [
      'customer:write',
      'customer:credential:initialize',
      'customer:security:manage',
    ],
    priority: 10,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'users',
    roleRelevance: ['SUPER_OWNER', 'MANAGER', 'ADMIN'],
  },
  {
    href: '/workspace/paket-member',
    label: 'Paket member',
    shortLabel: 'Paket member',
    description: 'Cari member, lihat semua paketnya, lalu ubah tanggal berakhir atau bekukan langsung dari kartunya.',
    group: 'Member & Pelanggan',
    capabilities: ['ledger:read'],
    mutationCapabilities: ['customer-package:manage'],
    priority: 10,
    branchScope: 'topbar',
    accent: 'brand',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER', 'ADMIN', 'FINANCE'],
  },
  {
    href: '/ledger',
    // Digabung ke Paket member (27 Nov 2026): tetap bisa dibuka lewat tautan, tidak tampil di menu.
    hideFromNav: true,
    label: 'Paket & Sesi Pelanggan',
    shortLabel: 'Paket & Sesi',
    description: 'Kelola sisa kuota latihan, masa berlaku paket, pembekuan sesi, dan riwayat kehadiran.',
    group: 'Member & Pelanggan',
    capabilities: ['ledger:read'],
    priority: 11,
    branchScope: 'topbar',
    accent: 'neutral',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'MANAGER', 'ADMIN', 'FINANCE'],
  },
  {
    href: '/identity-verifications',
    label: 'Verifikasi pelanggan',
    shortLabel: 'Verifikasi ID',
    description: 'Periksa foto selfie member; tolak foto yang tidak layak supaya member mengambil ulang.',
    group: 'Member & Pelanggan',
    capabilities: ['identity-verification:read'],
    mutationCapabilities: ['identity-verification:decide'],
    priority: 12,
    branchScope: 'global',
    accent: 'warning',
    queueBadgeSource: 'verifications',
    dashboardDeepLink: '/identity-verifications?status=PENDING',
  },
  {
    href: '/ledger/adjustments',
    // Digabung ke Paket member (27 Nov 2026): tetap bisa dibuka lewat tautan, tidak tampil di menu.
    hideFromNav: true,
    label: 'Penyesuaian Sesi',
    shortLabel: 'Penyesuaian Sesi',
    description: 'Pengajuan koreksi saldo sesi member dengan persetujuan manajer cabang.',
    group: 'Member & Pelanggan',
    capabilities: ['ledger:adjust:read'],
    mutationCapabilities: ['ledger:adjust:request', 'ledger:adjust:decide'],
    priority: 13,
    branchScope: 'topbar',
    accent: 'warning',
    queueBadgeSource: 'adjustments',
    dashboardDeepLink: '/ledger/adjustments?status=PENDING',
    roleRelevance: ['ADMIN', 'MANAGER', 'SUPER_OWNER'],
  },

  // ==========================================
  // 3. PENJUALAN & KEUANGAN (Billing & Kasir)
  // ==========================================
  {
    href: '/workspace/payments',
    label: 'Antrean Pembayaran',
    shortLabel: 'Pembayaran',
    description: 'Antrean pemeriksaan bukti transfer dan keputusan pembayaran.',
    group: 'Penjualan & Keuangan',
    capabilities: ['payment:review', 'purchase:review'],
    mutationCapabilities: ['payment:decide', 'purchase:decide'],
    priority: 20,
    branchScope: 'topbar',
    accent: 'warning',
    icon: 'credit-card',
    roleRelevance: ['ADMIN', 'MANAGER', 'FINANCE', 'SUPER_OWNER'],
    queueBadgeSource: 'payments',
    dashboardDeepLink: '/workspace/payments?status=PENDING',
  },
  {
    href: '/workspace/packages',
    label: 'Kelola Paket & Promo',
    shortLabel: 'Kelola Paket',
    description: 'Kelola harga normal, promo aktif, dan histori harga paket.',
    group: 'Penjualan & Keuangan',
    capabilities: ['package-promotion:read'],
    mutationCapabilities: ['package-promotion:manage'],
    priority: 21,
    branchScope: 'topbar',
    accent: 'warning',
    icon: 'package',
    roleRelevance: ['SUPER_OWNER', 'OWNER'],
  },
  {
    href: '/workspace/vouchers',
    label: 'Voucher & promo',
    shortLabel: 'Voucher',
    description: 'Kelola kode voucher, periode aktif, cakupan paket, dan penggunaannya.',
    group: 'Penjualan & Keuangan',
    capabilities: ['voucher:read'],
    mutationCapabilities: ['voucher:manage'],
    priority: 22,
    branchScope: 'global',
    accent: 'warning',
    icon: 'ticket-percent',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'FINANCE'],
  },
  {
    href: '/workspace/kas',
    label: 'Jurnal kas',
    shortLabel: 'Jurnal kas',
    description:
      'Uang masuk dari paket yang lunas dan pengeluaran cabang, termasuk pembelian barang yang dicatat admin.',
    group: 'Penjualan & Keuangan',
    capabilities: ['expense:create', 'finance:read'],
    mutationCapabilities: ['expense:create', 'finance:manage'],
    priority: 2,
    branchScope: 'topbar',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER', 'FINANCE'],
  },
  {
    href: '/workspace/stok-minuman',
    label: 'Stok minuman',
    shortLabel: 'Stok minuman',
    description:
      'Catat beli dan jual minuman per cabang. Pembelian jadi pengeluaran, penjualan masuk Penjualan minuman.',
    group: 'Penjualan & Keuangan',
    capabilities: ['inventory:read', 'inventory:record', 'inventory:manage'],
    mutationCapabilities: ['inventory:record', 'inventory:manage'],
    priority: 3,
    branchScope: 'topbar',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER', 'FINANCE'],
  },
  {
    href: '/workspace/koreksi-jam',
    label: 'Koreksi jam instruktur',
    shortLabel: 'Koreksi jam',
    description:
      'Tambah atau kurangi jam mengajar satu kelas dengan alasan dan bukti; masuk ke payroll bulan kelasnya.',
    group: 'Penjualan & Keuangan',
    capabilities: ['instructor:hours:adjust'],
    priority: 3,
    branchScope: 'topbar',
    accent: 'warning',
    roleRelevance: ['SUPER_OWNER', 'MANAGER'],
  },
  {
    href: '/finance',
    label: 'Keuangan',
    shortLabel: 'Keuangan',
    description: 'Rekonsiliasi transaksi, perbandingan cabang, selisih sesi, dan laporan keuangan.',
    group: 'Penjualan & Keuangan',
    capabilities: ['finance:reconcile'],
    mutationCapabilities: ['payment:decide', 'finance:export'],
    priority: 23,
    branchScope: 'topbar',
    accent: 'info',
    icon: 'landmark',
    roleRelevance: ['FINANCE', 'SUPER_OWNER'],
    dashboardDeepLink: '/finance',
  },
  {
    href: '/workspace/branch-performance',
    label: 'Performa Cabang',
    shortLabel: 'Performa Cabang',
    description: 'Omset cabang, estimasi profit, dan detail breakdown fee instruktur.',
    group: 'Penjualan & Keuangan',
    capabilities: ['finance:read'],
    priority: 24,
    branchScope: 'topbar',
    accent: 'brand',
    icon: 'circle-dollar-sign',
    roleRelevance: ['OWNER', 'SUPER_OWNER'],
  },

  // ==========================================
  // 4. PENGATURAN & SISTEM (Super Owner/Owner)
  // ==========================================
  {
    href: '/workspace/branches',
    label: 'Manajemen Cabang',
    shortLabel: 'Studio/Cabang',
    description: 'Kelola profil, rekening, jam buka, Area Studio, dan Ruangan.',
    group: 'Pengaturan & Sistem',
    capabilities: ['master:read'],
    mutationCapabilities: ['master:manage'],
    priority: 30,
    branchScope: 'global',
    accent: 'brand',
    icon: 'building',
  },
  {
    href: '/workspace/classes/salin',
    label: 'Salin Jadwal Minggu',
    shortLabel: 'Salin Jadwal',
    description: 'Salin kelas minggu ini ke minggu depan atau empat minggu ke depan, dengan rencana dan daftar bentrok.',
    group: 'Operasional Studio',
    capabilities: ['class-slot:manage'],
    priority: 3,
    branchScope: 'topbar',
    accent: 'info',
    icon: 'copy-plus',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'],
    // Dibuka dari tombol di halaman Timetable kelas.
    hideFromNav: true,
  },
  {
    href: '/workspace/classes/rutin',
    label: 'Jadwal Rutin',
    shortLabel: 'Jadwal Rutin',
    description: 'Buat kelas berulang sampai tiga bulan ke depan: pilih hari, jam, studio, tipe kelas, dan instruktur sekali saja.',
    group: 'Operasional Studio',
    capabilities: ['class-slot:manage'],
    priority: 4,
    branchScope: 'topbar',
    accent: 'info',
    icon: 'calendar-range',
    roleRelevance: ['SUPER_OWNER', 'OWNER', 'ADMIN', 'MANAGER'],
    // Dibuka dari tombol di halaman Timetable kelas.
    hideFromNav: true,
  },
  {
    href: '/instructors',
    label: 'Manajemen Instruktur',
    shortLabel: 'Instruktur',
    description: 'Profil instruktur, penugasan, jadwal, check-in, fee, dan kompensasi.',
    group: 'Pengaturan & Sistem',
    capabilities: ['assignment:read'],
    mutationCapabilities: ['assignment:manage'],
    priority: 31,
    branchScope: 'topbar',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'ADMIN', 'MANAGER', 'FINANCE'],
  },
  {
    href: '/users',
    label: 'Pengguna internal',
    shortLabel: 'Staf',
    description: 'Buat, atur role, dan nonaktifkan staf sesuai cakupan cabang.',
    group: 'Pengaturan & Sistem',
    capabilities: ['user:read'],
    mutationCapabilities: ['user:admin'],
    priority: 32,
    branchScope: 'topbar',
    accent: 'neutral',
  },
  {
    href: '/workspace/petugas-checkin',
    label: 'Petugas Check-in',
    shortLabel: 'Petugas Check-in',
    description: 'Akun sales atau OB yang hanya bisa membuka layar check-in cabangnya.',
    group: 'Pengaturan & Sistem',
    capabilities: ['checkin-staff:manage'],
    priority: 32,
    branchScope: 'global',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER', 'MANAGER'],
  },
  {
    href: '/users/roles-permissions',
    label: 'Peran & Hak Akses',
    shortLabel: 'Hak Akses',
    description: 'Matriks hak akses dan jalur pengelolaan peran staf.',
    group: 'Pengaturan & Sistem',
    capabilities: ['user:admin'],
    priority: 33,
    branchScope: 'global',
    accent: 'info',
    icon: 'shield-check',
    roleRelevance: ['SUPER_OWNER'],
    isAdvanced: true,
    maturity: 'preview',
    previewNote:
      'Peran dan izin ditetapkan oleh sistem (hanya baca). Membuat peran khusus dan pengecualian izin belum tersedia; yang dapat diubah di sini adalah peran langsung pengguna.',
  },
  {
    href: '/assignments',
    label: 'Penugasan',
    shortLabel: 'Penugasan',
    description: 'Periode penugasan Owner dan Instruktur per cabang.',
    group: 'Pengaturan & Sistem',
    capabilities: ['assignment:read'],
    mutationCapabilities: ['assignment:manage'],
    priority: 34,
    branchScope: 'topbar',
    accent: 'neutral',
    isAdvanced: true,
  },
  {
    href: '/master',
    label: 'Data Master',
    shortLabel: 'Data Master',
    description: 'Katalog tipe kelas global, kuota/kapasitas sesi, dan honor instruktur.',
    group: 'Pengaturan & Sistem',
    capabilities: ['master:read'],
    mutationCapabilities: ['master:manage'],
    priority: 35,
    branchScope: 'topbar',
    accent: 'neutral',
    isAdvanced: true,
  },
  {
    href: '/audit',
    label: 'Audit akses',
    shortLabel: 'Audit Akses',
    description: 'Riwayat perubahan pengguna, role, penugasan, dan sesi yang sudah dimasking.',
    group: 'Pengaturan & Sistem',
    capabilities: ['audit:read'],
    priority: 38,
    branchScope: 'topbar',
    accent: 'info',
    isAdvanced: true,
    maturity: 'preview',
    previewNote:
      'Saat ini yang tercatat: perubahan akun staf (dibuat, profil, peran, kata sandi, status). Aktivitas lain belum muncul di sini.',
  },
  {
    href: '/notification-management',
    label: 'Manajemen Notifikasi',
    shortLabel: 'Notifikasi',
    description: 'Template, event mapping, delivery, retry, dan antrean gagal.',
    group: 'Pengaturan & Sistem',
    capabilities: ['notification:manage'],
    priority: 39,
    branchScope: 'global',
    accent: 'info',
    roleRelevance: ['SUPER_OWNER'],
    isAdvanced: true,
  },
  {
    href: '/public-content-management',
    label: 'Manajemen Konten Publik',
    shortLabel: 'Konten',
    description: 'Draft, preview, publish, archive, dan versi konten situs.',
    group: 'Pengaturan & Sistem',
    capabilities: ['public-content:read'],
    mutationCapabilities: ['public-content:manage'],
    priority: 40,
    branchScope: 'global',
    accent: 'brand',
    roleRelevance: ['SUPER_OWNER'],
    isAdvanced: true,
  },
  {
    href: '/operations',
    label: 'Evaluasi kuota H-24',
    shortLabel: 'Kuota H-24',
    description: 'Pemantauan pembatalan otomatis untuk kelas yang tidak memenuhi kuota minimal 24 jam sebelum jadwal.',
    group: 'Pengaturan & Sistem',
    capabilities: ['operations:read'],
    mutationCapabilities: ['operations:recover'],
    priority: 41,
    branchScope: 'global',
    accent: 'warning',
    queueBadgeSource: 'jobs',
    dashboardDeepLink: '/operations?status=FAILED',
    isAdvanced: true,
  },
  {
    href: '/health',
    label: 'Status sistem',
    shortLabel: 'Status sistem',
    description: 'Kesiapan API dan dependency tanpa mengekspos detail koneksi.',
    group: 'Pengaturan & Sistem',
    capabilities: ['operations:read'],
    priority: 42,
    branchScope: 'global',
    accent: 'info',
    isAdvanced: true,
  },

  // ==========================================
  // CUSTOMER SELF-SERVICE PAGES
  // ==========================================
  {
    href: '/account',
    label: 'Dashboard pelanggan',
    shortLabel: 'Dashboard Saya',
    description: 'Status verifikasi, jadwal, paket, dan booking pelanggan.',
    group: 'Operasional Studio',
    capabilities: ['customer:self'],
    priority: 0,
    branchScope: 'global',
    accent: 'brand',
  },
  {
    href: '/account/verification',
    label: 'Verifikasi identitas',
    shortLabel: 'Verifikasi Saya',
    description: 'Foto selfie Anda: wajib sebelum membeli paket dan booking, bisa diganti kapan saja.',
    group: 'Operasional Studio',
    capabilities: ['customer:self'],
    priority: 0,
    branchScope: 'global',
    accent: 'warning',
  },
];

export const frontendPageGroups: FrontendPageGroup[] = [
  'Operasional Studio',
  'Member & Pelanggan',
  'Penjualan & Keuangan',
  'Pengaturan & Sistem',
];

/** Peran yang menentukan susunan menu staf; akun berperan ganda memakai yang tertinggi. */
export type PeranMenu = 'SUPER_OWNER' | 'OWNER' | 'MANAGER' | 'FINANCE' | 'ADMIN' | 'CHECKIN_STAFF';

const URUTAN_PERAN: readonly PeranMenu[] = ['SUPER_OWNER', 'OWNER', 'MANAGER', 'FINANCE', 'ADMIN', 'CHECKIN_STAFF'];

export interface MenuUtama {
  href: string;
  label: string;
}

/**
 * Menu utama per peran: hanya pekerjaan harian, maksimal enam. Halaman lain yang boleh dibuka
 * akun tidak hilang, tetapi dikumpulkan di bagian "Lainnya" (atau "Pengaturan" untuk Super Owner).
 */
export const MENU_PERAN: Record<PeranMenu, { utama: readonly MenuUtama[]; lainnyaLabel: string }> = {
  // Petugas Check-in (sales/OB): satu menu saja.
  CHECKIN_STAFF: {
    utama: [{ href: '/workspace/check-in', label: 'Check-in' }],
    lainnyaLabel: 'Lainnya',
  },
  ADMIN: {
    utama: [
      { href: '/workspace', label: 'Hari ini' },
      { href: '/workspace/classes', label: 'Jadwal' },
      { href: '/customers', label: 'Member' },
      { href: '/workspace/kas', label: 'Pengeluaran' },
    ],
    lainnyaLabel: 'Lainnya',
  },
  MANAGER: {
    utama: [
      { href: '/workspace', label: 'Beranda' },
      { href: '/workspace/check-in', label: 'Check-in' },
      { href: '/workspace/classes', label: 'Jadwal' },
      { href: '/customers', label: 'Member' },
      { href: '/workspace/kas', label: 'Pengeluaran' },
      { href: '/workspace/stok-minuman', label: 'Stok minuman' },
    ],
    lainnyaLabel: 'Lainnya',
  },
  OWNER: {
    utama: [
      { href: '/workspace', label: 'Beranda' },
      { href: '/workspace/branch-performance', label: 'Laporan' },
      { href: '/workspace/classes', label: 'Jadwal' },
    ],
    lainnyaLabel: 'Lainnya',
  },
  SUPER_OWNER: {
    utama: [
      { href: '/workspace', label: 'Beranda' },
      { href: '/workspace/classes', label: 'Jadwal' },
      { href: '/customers', label: 'Member' },
      { href: '/finance', label: 'Keuangan' },
      { href: '/workspace/packages', label: 'Paket & Promo' },
      { href: '/instructors', label: 'Instruktur & Staf' },
    ],
    lainnyaLabel: 'Pengaturan',
  },
  FINANCE: {
    utama: [
      { href: '/workspace', label: 'Beranda' },
      { href: '/finance', label: 'Keuangan' },
      { href: '/workspace/vouchers', label: 'Voucher' },
      { href: '/workspace/paket-member', label: 'Paket member' },
    ],
    lainnyaLabel: 'Lainnya',
  },
};

/** Menu utama Admin Cabang (meja depan). */
export const MENU_FRONT_DESK = MENU_PERAN.ADMIN.utama.map((item) => item.href);

export function peranMenu(roles: readonly string[] | undefined): PeranMenu | null {
  return URUTAN_PERAN.find((peran) => roles?.includes(peran)) ?? null;
}

/**
 * Susunan menu staf untuk satu sesi: menu utama perannya (yang boleh dibuka) dan semua halaman
 * lain yang boleh dibuka, urut grup lalu prioritas, untuk bagian "Lainnya".
 */
export function menuStaf(session: { roles: readonly string[]; capabilities: readonly string[] }) {
  const peran = peranMenu(session.roles);
  if (!peran) return null;
  const capabilities = [...session.capabilities];
  const halaman = (href: string) => frontendPages.find((page) => page.href === href);
  const utama = MENU_PERAN[peran].utama
    .map((item) => ({ ...item, page: halaman(item.href) }))
    .filter((item): item is MenuUtama & { page: FrontendPageDefinition } =>
      Boolean(item.page && canReadPage(capabilities, item.page)),
    );
  const dipakai = new Set(utama.map((item) => item.href));
  const lainnya = frontendPages
    .filter(
      (page) =>
        !dipakai.has(page.href) &&
        !page.hideFromNav &&
        !page.isDormant &&
        page.capabilities.length > 0 &&
        !page.capabilities.includes('customer:self') &&
        canReadPage(capabilities, page),
    )
    .sort(
      (a, b) =>
        frontendPageGroups.indexOf(a.group) - frontendPageGroups.indexOf(b.group) ||
        a.priority - b.priority,
    );
  return { peran, utama, lainnya, lainnyaLabel: MENU_PERAN[peran].lainnyaLabel };
}

/**
 * Halaman yang isinya satu tema dan dulu terpisah di menu: ditampilkan sebagai tab di atas
 * halaman supaya terasa satu tempat, tanpa memindahkan isi atau rutenya.
 */
export const GRUP_TAB: readonly { label: string; hrefs: readonly string[] }[] = [
  { label: 'Keuangan', hrefs: ['/finance', '/workspace/kas', '/workspace/branch-performance'] },
  { label: 'Paket & Promo', hrefs: ['/workspace/packages', '/workspace/vouchers'] },
  { label: 'Instruktur & Staf', hrefs: ['/instructors', '/users', '/assignments'] },
  { label: 'Member', hrefs: ['/customers', '/workspace/paket-member'] },
  {
    label: 'Notifikasi & Otomasi',
    hrefs: ['/workspace/reminders', '/operations', '/notification-management', '/health'],
  },
];

/** Tab untuk halaman aktif: hanya halaman grup yang boleh dibuka; kosong bila kurang dari dua. */
export function tabUntuk(pathname: string, capabilities: readonly string[]) {
  const aktif = pageForPath(pathname);
  if (!aktif) return [];
  const grup = GRUP_TAB.find((g) => g.hrefs.includes(aktif.href));
  if (!grup) return [];
  const tab = grup.hrefs
    .map((href) => frontendPages.find((page) => page.href === href))
    .filter((page): page is FrontendPageDefinition =>
      Boolean(page && canReadPage([...capabilities], page)),
    )
    .map((page) => ({ href: page.href, label: page.shortLabel, aktif: page.href === aktif.href }));
  return tab.length >= 2 ? tab : [];
}

/** Halaman registry yang paling spesifik untuk sebuah path (detail `/x/[id]` memakai halaman `/x`). */
export function pageForPath(pathname: string): FrontendPageDefinition | undefined {
  return [...frontendPages]
    .sort((left, right) => right.href.length - left.href.length)
    .find(
      (page) =>
        pathname === page.href ||
        (page.href !== '/workspace' && pathname.startsWith(`${page.href}/`)),
    );
}

export function canReadPage(capabilities: string[], page: FrontendPageDefinition) {
  return (
    page.capabilities.length === 0 ||
    page.capabilities.some((capability) => capabilities.includes(capability))
  );
}

/**
 * Pintasan Dashboard: halaman yang boleh dibaca akun, diprioritaskan lewat `roleRelevance`
 * (bila cukup relevan), urut menurut `priority`. Halaman dormant dan halaman customer dikecualikan.
 */
export function shortcutPagesFor(
  session: { roles: readonly string[]; capabilities: readonly string[] },
  limit = 6,
): FrontendPageDefinition[] {
  const readable = frontendPages.filter(
    (page) =>
      page.href !== '/workspace' &&
      page.href !== '/help' &&
      !page.isDormant &&
      !page.capabilities.includes('customer:self') &&
      canReadPage([...session.capabilities], page),
  );
  const relevant = readable.filter((page) =>
    page.roleRelevance?.some((role) => session.roles.includes(role)),
  );
  const pool = relevant.length >= 3 ? relevant : readable;
  return [...pool].sort((left, right) => left.priority - right.priority).slice(0, limit);
}

export function canMutatePage(capabilities: string[], page: FrontendPageDefinition) {
  return Boolean(
    page.mutationCapabilities?.some((capability) => capabilities.includes(capability)),
  );
}
