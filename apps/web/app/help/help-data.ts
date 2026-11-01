export type HelpAudienceRole = 'customer' | 'admin' | 'super-admin';

export interface HelpStep {
  number: number;
  title: string;
  description: string;
  tips?: string;
}

export interface HelpSuccessState {
  title: string;
  message: string;
  nextStep: string;
}

export interface HelpFailureState {
  code: string;
  title: string;
  message: string;
  cause: string;
  stepsToResolve: string[];
}

export interface HelpConstraint {
  label: string;
  limit: string;
  reason: string;
  alternative: string;
}

export interface HelpScreenshot {
  title: string;
  description: string;
  desktopUrl: string;
  mobileUrl?: string;
  secondaryTitle?: string;
  secondaryDesktopUrl?: string;
  secondaryMobileUrl?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  badge: string;
  purpose: string;
  prerequisites: string;
  requiredRole: string;
  steps: HelpStep[];
  successState: HelpSuccessState;
  failureStates: HelpFailureState[];
  constraints: HelpConstraint[];
  screenshot?: HelpScreenshot;
}

export interface HelpGlossaryItem {
  term: string;
  category: 'Member' | 'Operasional' | 'Keuangan & Sistem';
  definition: string;
}

export interface HelpFaqItem {
  question: string;
  audience: HelpAudienceRole | 'all';
  answer: string;
}

export interface HelpErrorCodeItem {
  code: string;
  httpStatus: number;
  audience: HelpAudienceRole | 'all';
  meaning: string;
  commonCause: string;
  resolution: string;
}

export const HELP_GLOSSARY: HelpGlossaryItem[] = [
  {
    term: 'Paket (Package)',
    category: 'Member',
    definition:
      'Produk sesi latihan berbayar dengan batas kedaluwarsa tertentu dan batasan studio/tipe kelas.',
  },
  {
    term: 'Sesi (Session)',
    category: 'Member',
    definition:
      'Unit kuota 1 kali kehadiran kelas latihan Pilates. 1 kehadiran = 1 kuota sesi dipotong dari paket.',
  },
  {
    term: 'Cutoff Booking H-2 Jam',
    category: 'Member',
    definition:
      'Batas akhir pemesanan kelas secara mandiri, yaitu maksimal 2 jam sebelum kelas dimulai.',
  },
  {
    term: 'Cutoff Reschedule & Cancel H-24 Jam',
    category: 'Member',
    definition:
      'Batas akhir perubahan jadwal atau pembatalan kelas, yaitu maksimal 24 jam sebelum jadwal kelas dimulai.',
  },
  {
    term: 'Jendela Presensi (Check-in Window)',
    category: 'Operasional',
    definition:
      'Waktu buka presensi: tautan mandiri ponsel buka H-60 menit, scanner studio buka H-30 menit hingga kelas selesai.',
  },
  {
    term: 'Assisted Booking (Walk-in)',
    category: 'Operasional',
    definition:
      'Pemesanan kelas yang dibantu langsung oleh staf meja depan untuk member yang datang langsung ke studio.',
  },
  {
    term: 'Pemisahan Wewenang (Prinsip 4-Mata)',
    category: 'Operasional',
    definition:
      'Prinsip kepatuhan di mana pembuat transaksi (staf input) dilarang menyetujui transaksi atau penyesuaian yang sama.',
  },
  {
    term: 'Penyesuaian Sesi (Session Adjustment)',
    category: 'Operasional',
    definition:
      'Pengajuan koreksi saldo sesi member (tambah/kurang) oleh Front Desk yang membutuhkan persetujuan Manajer Cabang.',
  },
  {
    term: 'Fast Review',
    category: 'Operasional',
    definition:
      'Mode tinjauan cepat dokumen selfie pelanggan menggunakan pintasan keyboard (tombol A untuk setujui, R untuk tolak).',
  },
  {
    term: 'Jurnal Kas & Biaya Cabang',
    category: 'Keuangan & Sistem',
    definition:
      'Catatan pengeluaran operasional cabang (seperti pembelian perlengkapan studio) yang dicatat staf dan diverifikasi Finance.',
  },
  {
    term: 'Settlement Porsi Owner',
    category: 'Keuangan & Sistem',
    definition:
      'Perhitungan bagi hasil laba cabang antar investor/Super Owner di akhir bulan berdasarkan basis poin kepemilikan.',
  },
  {
    term: 'Evaluasi Kuota H-24 (Auto-Cancel)',
    category: 'Keuangan & Sistem',
    definition:
      'Otomasi sistem untuk mengevaluasi apakah kelas memenuhi batas minimal peserta pada H-24. Jika tidak, kelas dibatalkan otomatis.',
  },
];

export const HELP_ERROR_CATALOG: HelpErrorCodeItem[] = [
  {
    code: 'IDENTITY_VERIFICATION_REQUIRED',
    httpStatus: 403,
    audience: 'customer',
    meaning: 'Verifikasi identitas diperlukan sebelum booking',
    commonCause:
      'Member belum mengunggah foto selfie atau foto selfie masih menunggu persetujuan admin',
    resolution:
      'Buka menu Verifikasi Akun (/account/verification), ambil foto selfie jelas, lalu tunggu verifikasi admin studio.',
  },
  {
    code: 'PURCHASE_NOT_PAID',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Pembelian paket belum lunas atau belum diverifikasi',
    commonCause:
      'Bukti transfer baru diunggah dan masih dalam antrean verifikasi tim Finance/Admin',
    resolution:
      'Pantau status pesanan di menu Pesanan (/orders). Hubungi admin cabang via WhatsApp jika bukti transfer sudah lebih dari 2 jam.',
  },
  {
    code: 'BOOKING_CUTOFF_PASSED',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Batas waktu pemesanan kelas telah ditutup',
    commonCause: 'Mencoba memesan kelas kurang dari 2 jam sebelum jadwal dimulai',
    resolution:
      'Pilih jadwal kelas lain yang belum melewati batas waktu pemesanan (minimal 2 jam mendatang).',
  },
  {
    code: 'RESCHEDULE_CUTOFF_PASSED',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Batas pengajuan reschedule H-24 terlewati',
    commonCause: 'Pengajuan perubahan jadwal dilakukan kurang dari 24 jam sebelum kelas dimulai',
    resolution:
      'Untuk alasan darurat medis mendesak, hubungi admin studio cabang terkait untuk pengajuan bantuan khusus.',
  },
  {
    code: 'CLASS_CAPACITY_FULL',
    httpStatus: 409,
    audience: 'all',
    meaning: 'Kapasitas kelas sudah penuh',
    commonCause: 'Seluruh mat/reformer pada slot kelas tersebut telah dipesan peserta lain',
    resolution: 'Pilih jadwal kelas lain atau jam berikutnya pada hari yang sama.',
  },
  {
    code: 'INSUFFICIENT_AVAILABLE_SESSIONS',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Saldo sesi paket tidak mencukupi',
    commonCause: 'Sisa kuota sesi habis atau sedang direservasi pada jadwal booking aktif lainnya',
    resolution:
      'Beli paket sesi baru di menu Paket (/packages) atau batalkan reservasi kelas lain yang tidak dihadiri.',
  },
  {
    code: 'PACKAGE_BRANCH_MISMATCH',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Paket tidak berlaku di cabang studio yang dipilih',
    commonCause:
      'Paket yang dimiliki terikat pada cabang spesifik (misal: cabang Surabaya) dan dicoba dipakai di Jakarta',
    resolution:
      'Pilih jadwal kelas di cabang yang sesuai dengan paket Anda, atau beli paket khusus cabang tersebut.',
  },
  {
    code: 'PACKAGE_CLASS_TYPE_MISMATCH',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Paket tidak sesuai dengan tipe kelas',
    commonCause: 'Paket Group Mat Pilates dipakai untuk memesan kelas Private Reformer',
    resolution: 'Pilih tipe kelas yang cocok dengan jenis paket yang Anda miliki.',
  },
  {
    code: 'CHECK_IN_TOO_EARLY',
    httpStatus: 409,
    audience: 'all',
    meaning: 'Presensi belum dibuka',
    commonCause:
      'Mencoba presensi sebelum waktu buka (tautan web buka H-60 menit, scanner studio buka H-30 menit)',
    resolution: 'Tunggu hingga memasuki jendela waktu presensi resmi sebelum memindai tiket.',
  },
  {
    code: 'CHECK_IN_WINDOW_CLOSED',
    httpStatus: 410,
    audience: 'all',
    meaning: 'Jendela waktu presensi telah berakhir',
    commonCause: 'Jam selesai kelas telah lewat',
    resolution:
      'Minta staf meja depan memeriksa absensi manual jika Anda hadir di studio sebelum toleransi H+2 jam berakhir.',
  },
  {
    code: 'ADMIN_BACKFILL_WINDOW_CLOSED',
    httpStatus: 410,
    audience: 'admin',
    meaning: 'Batas toleransi backfill absensi H+2 jam terlewati',
    commonCause: 'Admin mencoba mencatat kehadiran lebih dari 2 jam setelah kelas selesai',
    resolution: 'Eskalasikan ke Manajer Cabang atau Super Owner melalui menu Penyesuaian Sesi.',
  },
  {
    code: 'OUT_OF_GEOFENCE',
    httpStatus: 409,
    audience: 'customer',
    meaning: 'Lokasi Anda berada di luar area studio',
    commonCause:
      'GPS mendeteksi posisi Anda lebih jauh dari radius geofence cabang yang ditentukan',
    resolution:
      'Pastikan Anda telah tiba di dalam area studio fisik dan izinkan akurasi tinggi GPS pada ponsel Anda.',
  },
  {
    code: 'SEPARATION_OF_DUTIES_VIOLATION',
    httpStatus: 403,
    audience: 'admin',
    meaning: 'Pelanggaran aturan Pemisahan Wewenang (Prinsip 4-Mata)',
    commonCause: 'Staf mencoba menyetujui transaksi penjualan yang ia catat sendiri di kasir meja',
    resolution:
      'Minta staf Finance atau Manajer Cabang lain yang independen untuk memverifikasi dan menyetujui pembayaran tersebut.',
  },
  {
    code: 'SEPARATION_OF_DUTIES',
    httpStatus: 403,
    audience: 'admin',
    meaning: 'Pelanggaran otorisasi penyesuaian sesi',
    commonCause: 'Staf yang mengajukan penyesuaian sesi mencoba menyetujui pengajuannya sendiri',
    resolution: 'Persetujuan wajib diputuskan oleh Manajer Cabang atau Super Owner yang berbeda.',
  },
  {
    code: 'CHALLENGE_EXPIRED',
    httpStatus: 410,
    audience: 'customer',
    meaning: 'Token atau tautan telah kedaluwarsa',
    commonCause: 'Tautan reset password atau aktivasi akun telah melewati batas 15 menit',
    resolution:
      'Kirim ulang permintaan reset password dari halaman Lupa Password (/forgot-password).',
  },
  {
    code: 'RATE_LIMITED',
    httpStatus: 429,
    audience: 'all',
    meaning: 'Terlalu banyak percobaan dalam waktu singkat',
    commonCause: 'Gagal login lebih dari 5 kali dalam 15 menit atau permintaan reset berulang kali',
    resolution: 'Tunggu 15 menit sebelum mencoba kembali. Jangan menekan tombol berulang kali.',
  },
  {
    code: 'UPLOAD_REJECTED',
    httpStatus: 422,
    audience: 'all',
    meaning: 'Berkas unggahan tidak memenuhi syarat',
    commonCause: 'Format bukan JPG/PNG/WebP, file rusak/korup, atau ukuran melebihi batas 5MB',
    resolution:
      'Gunakan foto langsung dari kamera ponsel dengan format standar JPEG/PNG di bawah 5MB.',
  },
  {
    code: 'OFFLINE_OR_REQUEST_FAILED',
    httpStatus: 503,
    audience: 'all',
    meaning: 'Koneksi terputus atau server tidak dapat dijangkau',
    commonCause: 'Jaringan internet ponsel/studio bermasalah saat permintaan dikirim',
    resolution:
      'Periksa sinyal Wi-Fi/seluler Anda, lalu muat ulang halaman. Sistem menggunakan idempotensi aman sehingga data tidak terduplikasi.',
  },
  {
    code: 'SESSION_REVOKED',
    httpStatus: 401,
    audience: 'all',
    meaning: 'Sesi masuk telah dicabut atau berakhir',
    commonCause:
      'Token telah dirotasi, password baru saja diubah dari perangkat lain, atau mendeteksi pemakaian ulang token',
    resolution: 'Masuk kembali dengan email dan password Anda di halaman /sign-in.',
  },
];

export const HELP_SECTIONS_CUSTOMER: HelpSection[] = [
  {
    id: 'cust-register',
    title: '1. Pendaftaran & Aktivasi Akun',
    badge: 'Awal Mulai',
    purpose:
      'Membuka akun member baru untuk melihat jadwal studio dan membeli paket latihan Pilates.',
    prerequisites:
      'Memiliki nomor WhatsApp aktif (+62) dan alamat email valid yang belum pernah didaftarkan sebelumnya.',
    requiredRole: 'Publik / Calon Member',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Pendaftaran',
        description:
          'Buka menu "Daftar" di sudut kanan atas situs web Daily Dose atau langsung akses /register.',
      },
      {
        number: 2,
        title: 'Isi Data Diri Lengkap',
        description:
          'Masukkan nama lengkap, email, nomor WhatsApp aktif (+62), dan kata sandi minimal 8 karakter.',
        tips: 'Nomor WhatsApp wajib aktif untuk menerima konfirmasi booking dan pemberitahuan darurat studio.',
      },
      {
        number: 3,
        title: 'Konfirmasi Persetujuan Syarat & Ketentuan',
        description:
          'Centang persetujuan syarat ketentuan studio dan kebijakan privasi, lalu tekan tombol "Daftar Sekarang".',
      },
      {
        number: 4,
        title: 'Aktivasi Akun via Email',
        description:
          'Buka email Anda dan klik tautan aktivasi akun (/activate-account) dalam batas waktu 15 menit.',
      },
    ],
    successState: {
      title: 'Pendaftaran & Aktivasi Berhasil',
      message: 'Akun member Anda telah aktif dan dapat langsung digunakan untuk masuk ke aplikasi.',
      nextStep:
        'Lanjutkan ke verifikasi foto selfie wajah di menu Akun (/account/verification) untuk membuka hak booking kelas.',
    },
    failureStates: [
      {
        code: 'EMAIL_ALREADY_REGISTERED',
        title: 'Email Sudah Terdaftar',
        message: 'Email ini sudah terdaftar pada akun lain di sistem Daily Dose.',
        cause: 'Anda sebelumnya sudah pernah membuat akun menggunakan alamat email tersebut.',
        stepsToResolve: [
          'Gunakan halaman Masuk (/sign-in) untuk login ke akun yang sudah ada.',
          'Jika lupa kata sandi, gunakan tautan "Lupa password?" di halaman sign-in.',
        ],
      },
      {
        code: 'PHONE_ALREADY_REGISTERED',
        title: 'Nomor WhatsApp Sudah Digunakan',
        message: 'Nomor WhatsApp ini sudah terdaftar pada akun lain.',
        cause: 'Nomor telepon bersifat unik per akun dan tidak boleh ganda.',
        stepsToResolve: [
          'Pastikan digit nomor telepon yang Anda masukkan sudah benar.',
          'Hubungi staf meja depan studio via WhatsApp jika nomor Anda pernah didaftarkan oleh admin saat walk-in.',
        ],
      },
      {
        code: 'CHALLENGE_EXPIRED',
        title: 'Tautan Aktivasi Kedaluwarsa',
        message: 'Tautan atau token aktivasi akun telah melewati batas waktu 15 menit.',
        cause: 'Tautan aktivasi tidak segera dibuka setelah pendaftaran dibuat.',
        stepsToResolve: [
          'Buka kembali halaman /activate-account.',
          'Ketikkan email Anda lalu klik "Kirim Ulang Tautan Aktivasi".',
        ],
      },
    ],
    constraints: [
      {
        label: 'Format Password',
        limit: '8 - 128 karakter',
        reason: 'Standar keamanan akun terenkripsi Argon2id.',
        alternative: 'Gunakan kombinasi huruf, angka, dan simbol yang aman serta mudah diingat.',
      },
      {
        label: 'Masa Berlaku Link Aktivasi',
        limit: '15 Menit sejak pendaftaran',
        reason:
          'Mencegah penyalahgunaan pendaftaran akun oleh bot atau pihak tidak bertanggung jawab.',
        alternative: 'Gunakan fitur kirim ulang tautan aktivasi bila masa berlaku terlewati.',
      },
    ],
    screenshot: {
      title: 'Formulir Pendaftaran Member Baru',
      description: 'Layar pendaftaran dengan input nama, email, nomor WhatsApp, dan kata sandi.',
      desktopUrl: '/images/help/customer/c01-register-form-desktop.png',
      mobileUrl: '/images/help/customer/c01-register-form-mobile.png',
      secondaryTitle: 'Halaman Konfirmasi Aktivasi Akun Terkirim',
      secondaryDesktopUrl: '/images/help/customer/c01-activate-account-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c01-activate-account-mobile.png',
    },
  },
  {
    id: 'cust-sign-in',
    title: '2. Login & Autentikasi Pengguna',
    badge: 'Akses Akun',
    purpose:
      'Masuk ke akun member untuk mengakses jadwal studio, riwayat sesi, dan pemesanan kelas.',
    prerequisites: 'Akun member yang sudah diaktivasi dan kata sandi yang valid.',
    requiredRole: 'Publik / Member Terdaftar',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Masuk',
        description: 'Buka halaman /sign-in dari tombol "Masuk" di sudut kanan atas situs web.',
      },
      {
        number: 2,
        title: 'Masukkan Kredensial Akun',
        description:
          'Ketikkan Email, Username, atau nomor WhatsApp yang telah terdaftar pada kolom pertama.',
      },
      {
        number: 3,
        title: 'Ketikkan Kata Sandi',
        description:
          'Masukkan kata sandi Anda. Anda dapat menekan tombol "Lihat" untuk memastikan ketikan benar.',
      },
      {
        number: 4,
        title: 'Klik Masuk ke Akun',
        description:
          'Klik tombol "Masuk ke Akun". Sistem akan memverifikasi kredensial dan hak akses Anda.',
      },
    ],
    successState: {
      title: 'Autentikasi Berhasil',
      message:
        'Sistem berhasil memvalidasi kredensial dan mengarahkan Anda ke beranda atau jadwal studio.',
      nextStep: 'Buka menu Jadwal Kelas untuk melihat kuota kelas Pilates hari ini.',
    },
    failureStates: [
      {
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Kredensial Tidak Valid',
        message: 'Email, username/nomor WhatsApp, atau password tidak valid.',
        cause:
          'Salah mengetik alamat email, nomor telepon, atau kata sandi (perhatikan Caps Lock).',
        stepsToResolve: [
          'Periksa kembali ejaan email atau nomor WhatsApp Anda.',
          'Gunakan tombol "Lihat" pada kolom kata sandi untuk memastikan huruf besar/kecil tepat.',
          'Jika tetap tidak bisa masuk, klik tautan "Lupa password?" di bawah kolom formulir.',
        ],
      },
      {
        code: 'RATE_LIMITED',
        title: 'Percobaan Masuk Dibatasi',
        message: 'Terlalu banyak percobaan. Coba kembali nanti.',
        cause: 'Gagal memasukkan password lebih dari 5 kali berturut-turut dalam kurun 15 menit.',
        stepsToResolve: [
          'Tunggu 15 menit sebelum mencoba memasukkan password kembali.',
          'Gunakan alur reset password jika Anda ragu dengan kata sandi akun.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Batas Percobaan Login',
        limit: 'Maksimal 5 kali gagal berturut-turut',
        reason: 'Perlindungan keamanan dari serangan brute-force credential stuffing.',
        alternative: 'Manfaatkan pemulihan kata sandi daripada mencoba menebak berulang kali.',
      },
    ],
    screenshot: {
      title: 'Layar Masuk / Sign-in Member',
      description:
        'Formulir login dengan input kredensial, proteksi brute force, dan opsi pemulihan sandi.',
      desktopUrl: '/images/help/customer/c02-sign-in-form-desktop.png',
      mobileUrl: '/images/help/customer/c02-sign-in-form-mobile.png',
      secondaryTitle: 'Tampilan Pesan Error Kredensial Salah',
      secondaryDesktopUrl: '/images/help/customer/c02-sign-in-error-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c02-sign-in-error-mobile.png',
    },
  },
  {
    id: 'cust-forgot-password',
    title: '3. Lupa & Reset Kata Sandi',
    badge: 'Pemulihan Akun',
    purpose: 'Memulihkan akses akun secara mandiri jika Anda lupa kata sandi dengan aman.',
    prerequisites: 'Akses ke alamat email yang terdaftar pada akun Daily Dose Anda.',
    requiredRole: 'Publik / Member Terdaftar',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Lupa Password',
        description:
          'Klik tautan "Lupa password?" di halaman sign-in atau langsung buka /forgot-password.',
      },
      {
        number: 2,
        title: 'Kirim Permintaan Pemulihan',
        description: 'Ketikkan alamat email akun Anda, lalu klik tombol "Kirim tautan pemulihan".',
      },
      {
        number: 3,
        title: 'Buka Tautan Reset di Email',
        description:
          'Periksa kotak masuk (atau folder spam/promosi) email Anda, lalu klik tautan reset password yang dikirimkan.',
      },
      {
        number: 4,
        title: 'Simpan Kata Sandi Baru',
        description:
          'Ketikkan kata sandi baru minimal 8 karakter di halaman /reset-password, konfirmasi, dan simpan.',
      },
    ],
    successState: {
      title: 'Kata Sandi Berhasil Diperbarui',
      message:
        'Kata sandi baru telah disimpan. Seluruh sesi login di perangkat lain otomatis dicabut demi keamanan.',
      nextStep: 'Masuk kembali di halaman /sign-in menggunakan kata sandi baru Anda.',
    },
    failureStates: [
      {
        code: 'CHALLENGE_EXPIRED',
        title: 'Tautan Pemulihan Kedaluwarsa',
        message: 'Tautan reset password telah melewati batas waktu 15 menit.',
        cause: 'Tautan email tidak segera dibuka setelah permintaan dibuat.',
        stepsToResolve: [
          'Buka kembali halaman /forgot-password.',
          'Ketikkan email Anda dan minta tautan reset baru.',
          'Buka tautan segera setelah email masuk.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Masa Berlaku Token Reset',
        limit: '15 Menit sejak permintaan dibuat',
        reason: 'Standar keamanan akun untuk mencegah pembajakan tautan email.',
        alternative: 'Minta tautan baru jika token kedaluwarsa.',
      },
      {
        label: 'Pemakaian Token',
        limit: 'Single-use (Hanya dapat dipakai 1 kali)',
        reason: 'Mencegah pemakaian ulang tautan oleh pihak ketiga.',
        alternative: 'Ajukan permintaan baru bila proses reset terputus di tengah jalan.',
      },
    ],
    screenshot: {
      title: 'Layar Permintaan Lupa Password',
      description: 'Formulir input email untuk pengiriman instruksi setel ulang kata sandi.',
      desktopUrl: '/images/help/customer/c03-forgot-password-form-desktop.png',
      mobileUrl: '/images/help/customer/c03-forgot-password-form-mobile.png',
      secondaryTitle: 'Formulir Pembuatan Password Baru',
      secondaryDesktopUrl: '/images/help/customer/c03-reset-password-form-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c03-reset-password-form-mobile.png',
    },
  },
  {
    id: 'cust-verification',
    title: '4. Verifikasi Identitas (Foto Selfie Wajah)',
    badge: 'Wajib Booking',
    purpose:
      'Memastikan kecocokan wajah peserta saat hadir di studio agar sesi paket tidak disalahgunakan pihak lain.',
    prerequisites: 'Akun telah terdaftar dan ponsel memiliki kamera depan berfungsi normal.',
    requiredRole: 'Member Terdaftar (CUSTOMER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Verifikasi Akun',
        description:
          'Buka menu profil akun Anda lalu pilih submenu "Verifikasi Identitas" (/account/verification).',
      },
      {
        number: 2,
        title: 'Ambil Foto Selfie Wajah',
        description:
          'Posisikan wajah tegak lurus dengan pencahayaan cukup. Wajah tidak boleh tertutup masker atau kacamata hitam.',
        tips: 'Foto ini hanya disimpan privat untuk dicocokkan oleh staf meja depan saat Anda tiba di studio.',
      },
      {
        number: 3,
        title: 'Simpan & Kirim Foto',
        description:
          'Periksa pratinjau foto. Jika wajah terlihat jelas, klik tombol "Simpan Foto".',
      },
    ],
    successState: {
      title: 'Foto Selfie Tersimpan (APPROVED)',
      message: 'Status verifikasi identitas Anda aktif. Seluruh jadwal kelas kini dapat dipesan.',
      nextStep: 'Buka menu Paket untuk memilih paket kelas Pilates yang Anda minati.',
    },
    failureStates: [
      {
        code: 'BLURRY_OR_GLARE',
        title: 'Foto Buram atau Silau',
        message: 'Foto tidak terbaca dengan jelas karena goyang atau pantulan cahaya.',
        cause: 'Kamera bergerak saat mengambil foto atau lampu ruangan memantul berlebihan.',
        stepsToResolve: [
          'Ambil foto ulang di ruangan dengan pencahayaan terang merata.',
          'Pegang ponsel dengan stabil dan hindari membelakangi jendela terang (backlight).',
        ],
      },
      {
        code: 'UPLOAD_REJECTED',
        title: 'Ukuran Berkas Terlalu Besar',
        message: 'Format tidak didukung atau ukuran berkas melebihi batas 5MB.',
        cause: 'Ukuran file foto melebihi limit sistem atau format file korup.',
        stepsToResolve: [
          'Gunakan kamera browser langsung dari aplikasi Daily Dose tanpa kompresi aplikasi luar.',
          'Pastikan format gambar adalah JPG, PNG, atau WebP standar.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Batas Ukuran Berkas',
        limit: 'Maksimal 5 MB',
        reason:
          'Efisiensi enkripsi penyimpanan berkas identitas dan kecepatan pemuatan di meja depan.',
        alternative: 'Gunakan kamera bawaan ponsel standar dengan resolusi normal.',
      },
      {
        label: 'Dimensi Gambar',
        limit: 'Min 160x160 px, Max 12000x12000 px, Max 40MP',
        reason: 'Mencegah serangan dekompresi piksel berlebih (pixel flood) pada server.',
        alternative: 'Ambil foto selfie langsung via browser aplikasi.',
      },
    ],
    screenshot: {
      title: 'Layar Verifikasi Selfie Member',
      description:
        'Antarmuka pengambilan foto selfie dengan panduan pencahayaan dan tombol simpan.',
      desktopUrl: '/images/help/customer/c04-identity-verification-desktop.png',
      mobileUrl: '/images/help/customer/c04-identity-verification-mobile.png',
    },
  },
  {
    id: 'cust-locations',
    title: '5. Memilih Studio & Cabang Favorit',
    badge: 'Lokasi Studio',
    purpose:
      'Menentukan cabang studio latihan utama untuk melihat jadwal kelas dan ketersediaan fasilitas reformer.',
    prerequisites: 'Koneksi internet aktif.',
    requiredRole: 'Publik / Member',
    steps: [
      {
        number: 1,
        title: 'Buka Katalog Studio',
        description:
          'Buka menu "Studio" (/locations) dari navigasi utama untuk melihat seluruh cabang Daily Dose.',
      },
      {
        number: 2,
        title: 'Lihat Fasilitas & Rute Cabang',
        description:
          'Klik pada kartu cabang (misal Senopati atau PIK Avenue) untuk membaca alamat, jam buka, dan peta lokasi.',
      },
      {
        number: 3,
        title: 'Pilih Sebagai Studio Aktif',
        description:
          'Jadikan cabang tersebut sebagai preferensi latihan Anda agar jadwal kelas otomatis tersaring ke studio tersebut.',
      },
    ],
    successState: {
      title: 'Studio Cabang Terpilih',
      message: 'Preferensi studio Anda telah disimpan di sesi aplikasi.',
      nextStep: 'Buka menu Jadwal Kelas untuk melihat kelas yang tersedia di cabang pilihan Anda.',
    },
    failureStates: [
      {
        code: 'STUDIO_INACTIVE',
        title: 'Studio Sementara Tutup',
        message: 'Cabang studio yang dipilih sedang dalam perbaikan rutin atau libur operasional.',
        cause: 'Studio tidak menyelenggarakan kelas pada tanggal yang dipilih.',
        stepsToResolve: [
          'Pilih cabang studio alternatif terdekat.',
          'Hubungi nomor WhatsApp resmi cabang untuk informasi jadwal pembukaan kembali.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Cakupan Paket Cabang',
        limit: 'Paket berlaku di cabang terdaftar',
        reason: 'Alokasi instruktur dan kapasitas reformer dihitung per cabang fisik.',
        alternative: 'Pilih paket tipe All-Access bila Anda ingin berlatih lintas cabang.',
      },
    ],
    screenshot: {
      title: 'Katalog Lokasi Studio Daily Dose',
      description:
        'Daftar cabang studio aktif dengan informasi alamat, zona waktu, dan peta Google Maps.',
      desktopUrl: '/images/help/customer/c05-locations-catalog-desktop.png',
      mobileUrl: '/images/help/customer/c05-locations-catalog-mobile.png',
    },
  },
  {
    id: 'cust-packages',
    title: '6. Pembelian Paket & Unggah Bukti Bayar',
    badge: 'Pembayaran Resmi',
    purpose:
      'Membeli kuota sesi latihan Pilates via transfer bank ke rekening resmi studio cabang.',
    prerequisites:
      'Akun member aktif, verifikasi selfie tersimpan, dan rekening bank untuk transfer.',
    requiredRole: 'Member Terverifikasi',
    steps: [
      {
        number: 1,
        title: 'Pilih Paket Latihan',
        description:
          'Buka menu "Paket" (/packages), pilih studio cabang dan jumlah sesi yang diinginkan (misal Intro 10 Sessions atau Monthly Unlimited).',
      },
      {
        number: 2,
        title: 'Periksa Rincian Checkout',
        description:
          'Masukkan kode voucher promosi jika ada, lalu periksa rincian total nominal transfer di halaman /checkout.',
      },
      {
        number: 3,
        title: 'Transfer ke Rekening Resmi Cabang',
        description:
          'Lakukan transfer bank persis sesuai nominal pesanan ke nomor rekening resmi cabang yang tertera.',
        tips: 'Setiap cabang memiliki rekening bank terdaftar resmi demi keamanan transaksi keuangan Anda.',
      },
      {
        number: 4,
        title: 'Unggah Bukti Transfer',
        description:
          'Unggah tangkapan layar bukti transfer m-Banking sebelum batas waktu 60 menit berakhir, lalu klik "Kirim Bukti Pembayaran".',
      },
    ],
    successState: {
      title: 'Pembayaran Disetujui (PAID)',
      message:
        'Tim Finance telah menyetujui transaksi Anda. Kuota sesi paket langsung masuk ke saldo akun Anda.',
      nextStep: 'Buka menu Jadwal Kelas untuk memesan sesi latihan perdana Anda.',
    },
    failureStates: [
      {
        code: 'PROOF_INVALID',
        title: 'Bukti Transfer Tidak Terbaca',
        message: 'Status pesanan: Bukti ditolak - Bukti tidak valid atau terpotong.',
        cause:
          'Tangkapan layar m-Banking terpotong sehingga tanggal, jam, atau nominal tidak terlihat lengkap.',
        stepsToResolve: [
          'Buka menu Pesanan (/orders) di akun Anda.',
          'Pilih pesanan terkait dan klik tombol "Unggah Ulang Bukti".',
          'Pastikan nama bank tujuan, nominal rupiah, dan nomor referensi transaksi terlihat utuh.',
        ],
      },
      {
        code: 'AMOUNT_MISMATCH',
        title: 'Nominal Transfer Tidak Sesuai',
        message: 'Status pesanan: Nominal transfer berbeda dari total tagihan pesanan.',
        cause: 'Terjadi salah ketik digit nominal saat melakukan transfer antar bank.',
        stepsToResolve: [
          'Periksa kembali mutasi rekening bank Anda.',
          'Hubungi tim keuangan cabang via WhatsApp dengan melampirkan invoice pesanan.',
        ],
      },
      {
        code: 'ORDER_EXPIRED',
        title: 'Batas Waktu Pembayaran Habis',
        message: 'Pesanan telah dibatalkan otomatis karena melewati batas waktu 60 menit.',
        cause: 'Bukti transfer tidak diunggah dalam rentang 1 jam setelah checkout dibuat.',
        stepsToResolve: [
          'Buat pesanan paket baru dari katalog /packages.',
          'Segera transfer dan unggah bukti sebelum batas waktu 60 menit berakhir.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Batas Waktu Transfer (Abandoned TTL)',
        limit: '60 Menit sejak checkout dibuat',
        reason: 'Mengunci kuota promo dan menjaga keakuratan nomor referensi kas studio.',
        alternative: 'Lakukan transfer dan unggah bukti segera setelah membuat pesanan.',
      },
      {
        label: 'Ukuran Berkas Bukti Bayar',
        limit: 'Maksimal 10 MB',
        reason: 'Pemeriksaan keamanan pemindaian berkas anti-malware.',
        alternative: 'Gunakan file screenshot berukuran standar m-Banking (biasanya 500KB - 2MB).',
      },
    ],
    screenshot: {
      title: 'Katalog Paket Latihan Pilates',
      description: 'Daftar pilihan paket sesi, harga, masa berlaku hari, dan tombol beli paket.',
      desktopUrl: '/images/help/customer/c06-packages-catalog-desktop.png',
      mobileUrl: '/images/help/customer/c06-packages-catalog-mobile.png',
      secondaryTitle: 'Halaman Instruksi Transfer & Form Unggah Struk',
      secondaryDesktopUrl: '/images/help/customer/c06-checkout-instructions-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c06-checkout-instructions-mobile.png',
    },
  },
  {
    id: 'cust-booking',
    title: '7. Booking Kelas & Ketentuan Reschedule',
    badge: 'Reservasi Kelas',
    purpose:
      'Memesan tempat di kelas Pilates pilihan dan mengelola perubahan jadwal jika berhalangan.',
    prerequisites:
      'Verifikasi selfie APPROVED dan memiliki saldo kuota sesi paket aktif di cabang terkait.',
    requiredRole: 'Member Terverifikasi dengan Saldo Aktif',
    steps: [
      {
        number: 1,
        title: 'Pilih Jadwal Kelas',
        description:
          'Buka menu "Jadwal" (/classes), pilih cabang studio, tanggal latihan, dan tipe kelas (Reformer Flow, Cardio Jump, dll.).',
      },
      {
        number: 2,
        title: 'Pilih Slot Jam & Konfirmasi',
        description:
          'Klik slot jam yang diinginkan untuk melihat instruktur dan sisa matras. Klik "Booking", lalu konfirmasi pemotongan 1 sesi.',
      },
      {
        number: 3,
        title: 'Periksa Tiket di "Booking Saya"',
        description:
          'Setelah berhasil, tiket kelas akan muncul di menu "Booking Saya" (/bookings) dengan status BOOKED.',
      },
      {
        number: 4,
        title: 'Ketentuan Reschedule (Ubah Jadwal)',
        description:
          'Jika berhalangan hadir, tombol "Ubah Jadwal" dapat ditekan paling lambat 24 jam sebelum kelas dimulai (H-24).',
      },
    ],
    successState: {
      title: 'Booking Berhasil Dikonfirmasi',
      message:
        'Satu kuota matras telah direservasi untuk Anda. Tiket QR pass digital siap digunakan saat hari kelas.',
      nextStep:
        'Datang ke studio 15 menit sebelum kelas dimulai untuk pemanasan dan presensi masuk.',
    },
    failureStates: [
      {
        code: 'BOOKING_CUTOFF_PASSED',
        title: 'Waktu Booking Ditutup (H-2 Jam)',
        message: 'Waktu pemesanan mandiri untuk kelas ini sudah ditutup.',
        cause: 'Mencoba memesan kelas kurang dari 2 jam sebelum waktu kelas dimulai.',
        stepsToResolve: [
          'Pilih jadwal kelas berikutnya yang masih berada di atas batas H-2 jam.',
          'Atau datang langsung ke studio untuk menanyakan ketersediaan slot walk-in ke staf meja depan.',
        ],
      },
      {
        code: 'RESCHEDULE_CUTOFF_PASSED',
        title: 'Batas Reschedule Terlewati (H-24 Jam)',
        message: 'Batas pengajuan reschedule mandiri H-24 jam sudah terlewati.',
        cause:
          'Sistem mengunci perubahan jadwal dalam 24 jam sebelum kelas dimulai demi menjaga kuota minimal kelas bagi member lain.',
        stepsToResolve: [
          'Jika Anda mengalami kondisi darurat medis mendadak, siapkan surat izin istirahat dokter resmi.',
          'Hubungi admin studio via WhatsApp untuk permohonan bantuan asistensi tiket.',
        ],
      },
      {
        code: 'INSUFFICIENT_CREDITS',
        title: 'Saldo Sesi Tidak Mencukupi',
        message: 'Saldo kuota sesi Anda tidak mencukupi untuk memesan kelas ini.',
        cause: 'Kuota sesi paket Anda telah habis terpakai atau telah melewati masa kedaluwarsa.',
        stepsToResolve: ['Buka menu Paket (/packages) untuk melakukan pembelian paket sesi baru.'],
      },
    ],
    constraints: [
      {
        label: 'Cutoff Pemesanan Mandiri',
        limit: '2 Jam sebelum kelas dimulai (H-2)',
        reason: 'Memberikan kepastian roster kehadiran peserta bagi instruktur studio.',
        alternative:
          'Pemesanan dibantu staf meja depan (Assisted Booking) jika slot kelas masih tersedia.',
      },
      {
        label: 'Cutoff Perubahan Jadwal (Reschedule)',
        limit: '24 Jam sebelum kelas dimulai (H-24)',
        reason: 'Mencegah pembatalan mendadak yang merugikan kuota peserta lain.',
        alternative: 'Pengajuan bantuan darurat medis via admin meja depan dengan surat dokter.',
      },
    ],
    screenshot: {
      title: 'Kalender Jadwal Kelas Studio',
      description:
        'Tampilan kalender mingguan dengan status kuota matras terisi dan tombol booking.',
      desktopUrl: '/images/help/customer/c07-classes-schedule-desktop.png',
      mobileUrl: '/images/help/customer/c07-classes-schedule-mobile.png',
      secondaryTitle: 'Daftar Tiket Aktif di Menu Booking Saya',
      secondaryDesktopUrl: '/images/help/customer/c07-my-bookings-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c07-my-bookings-mobile.png',
    },
  },
  {
    id: 'cust-checkin',
    title: '8. Presensi Masuk (QR Pass Digital & Geofence)',
    badge: 'Presensi Masuk',
    purpose:
      'Mencatat kehadiran saat tiba di studio fisik Daily Dose untuk memulai latihan Pilates.',
    prerequisites: 'Memiliki tiket booking terkonfirmasi pada jadwal hari ini.',
    requiredRole: 'Member dengan Booking Aktif Hari Ini',
    steps: [
      {
        number: 1,
        title: 'Buka Tiket Check-In di Ponsel',
        description:
          'Buka menu "Booking Saya" di ponsel Anda dan klik kartu kelas hari ini untuk membuka QR Pass (/check-in-pass).',
      },
      {
        number: 2,
        title: 'Pindai di Meja Depan Studio',
        description:
          'Tunjukkan barcode QR di ponsel Anda kepada staf resepsionis studio untuk dipindai dengan scanner laser meja depan.',
      },
      {
        number: 3,
        title: 'Atau Konfirmasi Mandiri via GPS Ponsel',
        description:
          'Klik tombol "Konfirmasi Kehadiran Saya" pada ponsel saat berada di dalam ruangan studio dengan mengizinkan akses lokasi (GPS).',
        tips: 'Pastikan fitur lokasi ponsel aktif agar koordinat geofence studio dapat terbaca.',
      },
    ],
    successState: {
      title: 'Presensi Berhasil (VALID - BERHASIL)',
      message: 'Status tiket berubah menjadi ATTENDED. Kehadiran Anda telah resmi tercatat.',
      nextStep:
        'Simpan sepatu dan tas di loker studio, kenakan kaos kaki pilates grip, dan masuki ruang latihan.',
    },
    failureStates: [
      {
        code: 'CHECK_IN_TOO_EARLY',
        title: 'Presensi Belum Dibuka',
        message: 'QR belum aktif. Check-in dibuka 30 menit sebelum kelas.',
        cause: 'Mencoba memindai tiket lebih awal dari jendela pembukaan presensi.',
        stepsToResolve: [
          'Tunggu hingga masuk rentang waktu check-in (H-60 menit via tautan mandiri atau H-30 menit via scanner meja depan).',
          'Santai sejenak di area tunggu studio sambil menikmati minuman.',
        ],
      },
      {
        code: 'OUT_OF_GEOFENCE',
        title: 'Di Luar Area Studio',
        message:
          'Presensi ditolak karena Anda berada di luar radius area cabang studio yang telah ditentukan.',
        cause:
          'Sinyal GPS mendeteksi posisi ponsel berada di luar radius 100 meter dari titik koordinat cabang.',
        stepsToResolve: [
          'Pastikan Anda sudah berada di dalam ruangan/lobi studio.',
          'Jika sinyal GPS ponsel lemah di dalam gedung, minta staf meja depan memindai barcode QR Anda secara fisik.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Waktu Pembukaan Presensi',
        limit: 'Tautan mandiri: H-60 menit | Scanner meja: H-30 menit',
        reason:
          'Menghindari penumpukan antrean dan memastikan kedatangan tepat waktu sebelum pemanasan.',
        alternative: 'Pindai via scanner staf meja depan begitu Anda tiba di studio.',
      },
      {
        label: 'Radius Geofence GPS',
        limit: '100 Meter dari titik fisik cabang studio',
        reason: 'Mencegah presensi fiktif dari luar studio.',
        alternative: 'Pindai fisik QR dengan scanner barcode staf meja depan bila GPS bermasalah.',
      },
    ],
    screenshot: {
      title: 'Kartu QR Check-in Pass Digital',
      description:
        'Layar tiket check-in digital dengan barcode QR dinamis, nama instruktur, dan hitung mundur presensi.',
      desktopUrl: '/images/help/customer/c08-qr-check-in-open-desktop.png',
      mobileUrl: '/images/help/customer/c08-qr-check-in-open-mobile.png',
    },
  },
  {
    id: 'cust-sessions',
    title: '9. Sisa Sesi & Riwayat Kehadiran Paket',
    badge: 'Saldo & Kuota',
    purpose:
      'Memantau sisa kuota sesi latihan, masa berlaku paket, dan buku besar (ledger) riwayat kehadiran.',
    prerequisites: 'Akun member aktif yang pernah membeli paket kelas.',
    requiredRole: 'Member Terdaftar',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Paket Saya',
        description: 'Buka menu akun lalu pilih submenu "Paket Saya" (/account/packages).',
      },
      {
        number: 2,
        title: 'Periksa Saldo Kuota Sesi',
        description:
          'Lihat kartu paket aktif: total kuota awal, sesi terpakai, dan sisa sesi yang dapat digunakan untuk booking.',
      },
      {
        number: 3,
        title: 'Perhatikan Tanggal Kedaluwarsa',
        description:
          'Periksa tanggal batas akhir masa berlaku paket (Expires At) agar sesi tidak hangus.',
      },
      {
        number: 4,
        title: 'Cek Buku Besar Riwayat Sesi',
        description:
          'Gulir ke bawah untuk melihat riwayat pemotongan sesi per kelas beserta tanggal dan nama instruktur.',
      },
    ],
    successState: {
      title: 'Paket Aktif & Saldo Sesi Valid',
      message:
        'Seluruh riwayat debit sesi kelas dan penyesuaian tercatat transparan di buku besar akun Anda.',
      nextStep: 'Rencanakan booking latihan rutin sebelum masa berlaku paket berakhir.',
    },
    failureStates: [
      {
        code: 'PACKAGE_EXPIRED',
        title: 'Masa Berlaku Paket Telah Berakhir',
        message:
          'Paket ini telah melewati tanggal kedaluwarsa sehingga sisa sesi tidak dapat digunakan.',
        cause: 'Masa aktif paket (misal 30 hari atau 60 hari) telah habis.',
        stepsToResolve: [
          'Sisa sesi yang telah kedaluwarsa hangus otomatis sesuai syarat & ketentuan studio.',
          'Jika Anda memiliki surat izin istirahat dokter resmi selama masa aktif berlangsung, hubungi admin studio via WhatsApp untuk verifikasi pengajuan perpanjangan khusus.',
        ],
      },
      {
        code: 'SESSION_DEPLETED',
        title: 'Kuota Sesi Telah Habis',
        message: 'Seluruh sesi pada paket ini telah digunakan.',
        cause: 'Sisa kuota sesi bernilai 0.',
        stepsToResolve: [
          'Beli paket baru di katalog paket (/packages) untuk melanjutkan latihan Anda.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Masa Berlaku Kuota',
        limit: '30 hingga 90 Hari tergantung jenis paket',
        reason: 'Menjaga komitmen ritme latihan rutin member dan alokasi kapasitas studio.',
        alternative:
          'Perpanjangan hanya dapat diputuskan oleh Manajer Cabang dengan surat dokter resmi.',
      },
    ],
    screenshot: {
      title: 'Layar Rincian Paket & Kuota Sesi Member',
      description:
        'Kartu paket aktif menampilkan sisa sesi, tanggal kedaluwarsa, dan riwayat pemakaian sesi.',
      desktopUrl: '/images/help/customer/c09-account-packages-desktop.png',
      mobileUrl: '/images/help/customer/c09-account-packages-mobile.png',
    },
  },
  {
    id: 'cust-security',
    title: '10. Pengaturan Profil & Keamanan Akun',
    badge: 'Profil & Keamanan',
    purpose:
      'Memperbarui informasi kontak WhatsApp pribadi dan mengelola keamanan kata sandi akun member.',
    prerequisites: 'Login ke akun member.',
    requiredRole: 'Member Terdaftar',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Profil Saya',
        description:
          'Buka menu Akun -> "Profil Saya" (/account/profile) untuk memeriksa data diri.',
      },
      {
        number: 2,
        title: 'Perbarui Nomor WhatsApp',
        description:
          'Perbarui nomor WhatsApp jika berganti nomor agar pesan konfirmasi tetap Anda terima.',
      },
      {
        number: 3,
        title: 'Buka Menu Keamanan Akun',
        description:
          'Pilih submenu "Keamanan" (/account/security) untuk mengganti kata sandi secara berkala.',
      },
      {
        number: 4,
        title: 'Ketikkan Password Baru & Simpan',
        description:
          'Masukkan kata sandi lama, ketikkan kata sandi baru minimal 8 karakter, lalu klik "Simpan Password".',
      },
    ],
    successState: {
      title: 'Profil & Keamanan Berhasil Diperbarui',
      message:
        'Data profil Anda telah diperbarui dan kata sandi baru aktif. Sesi login di perangkat lain otomatis ditutup.',
      nextStep: 'Gunakan kata sandi baru saat masuk kembali pada perangkat berikutnya.',
    },
    failureStates: [
      {
        code: 'CURRENT_PASSWORD_INCORRECT',
        title: 'Kata Sandi Saat Ini Salah',
        message: 'Kata sandi saat ini yang Anda masukkan tidak sesuai.',
        cause: 'Salah mengetik kata sandi lama pada form keamanan.',
        stepsToResolve: [
          'Ketik ulang kata sandi lama dengan teliti.',
          'Gunakan alur /forgot-password jika Anda tidak mengingat kata sandi lama.',
        ],
      },
      {
        code: 'SESSION_REVOKED',
        title: 'Sesi Masuk Dicabut',
        message: 'Sesi login telah dicabut karena perubahan kata sandi.',
        cause:
          'Sistem secara otomatis menutup sesi aktif di seluruh perangkat demi mencegah akses ilegal.',
        stepsToResolve: [
          'Masuk kembali menggunakan email dan kata sandi baru di halaman /sign-in.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Keunikan Nomor Kontak',
        limit: 'Satu nomor WhatsApp per satu akun',
        reason: 'Keamanan otentikasi 2FA dan konfirmasi reservasi kelas.',
        alternative: 'Pastikan nomor WhatsApp Anda pribadi dan bukan nomor kantor/bersama.',
      },
    ],
    screenshot: {
      title: 'Layar Profil Akun Member',
      description:
        'Formulir data diri member dengan informasi nama, email, dan nomor kontak terdaftar.',
      desktopUrl: '/images/help/customer/c10-account-profile-desktop.png',
      mobileUrl: '/images/help/customer/c10-account-profile-mobile.png',
      secondaryTitle: 'Formulir Pengaturan Keamanan & Ganti Sandi',
      secondaryDesktopUrl: '/images/help/customer/c10-account-security-desktop.png',
      secondaryMobileUrl: '/images/help/customer/c10-account-security-mobile.png',
    },
  },
];

export const HELP_SECTIONS_ADMIN: HelpSection[] = [
  {
    id: 'admin-assisted-booking',
    title: '1. Booking Bantuan (Assisted Booking) & Antrean Reschedule',
    badge: 'Reservasi & Meja',
    purpose:
      'Membantu pelanggan yang memesan langsung di studio (walk-in) dan meninjau permohonan reschedule kelas darurat.',
    prerequisites:
      'Hak akses booking:create, booking:reschedule, dan booking:read pada cabang aktif.',
    requiredRole: 'Admin Meja Depan (ADMIN), Manajer Cabang (MANAGER)',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Manajemen Booking',
        description:
          'Buka menu "Manajemen Booking" (/workspace/bookings) atau klik tombol "+ Walk-in" dari meja depan.',
      },
      {
        number: 2,
        title: 'Cari Profil Pelanggan',
        description:
          'Ketik nama, nomor telepon WhatsApp, atau alamat email member terdaftar pada kolom pencarian pelanggan.',
      },
      {
        number: 3,
        title: 'Pilih Kelas & Sumber Paket',
        description:
          'Pilih jadwal kelas hari ini yang masih memiliki kapasitas reformer, lalu tentukan paket sesi aktif milik member yang akan dipotong.',
      },
      {
        number: 4,
        title: 'Konfirmasi Pemesanan Sesi',
        description:
          'Periksa ringkasan booking lalu klik "Konfirmasi Booking". Tiket kelas otomatis berstatus BOOKED.',
      },
      {
        number: 5,
        title: 'Tinjau Antrean Reschedule',
        description:
          'Buka tab "Antrean Reschedule" (/workspace/antrean), periksa alasan pengajuan member (seperti darurat medis), lalu putuskan (Setujui / Tolak).',
      },
    ],
    successState: {
      title: 'Pemesanan Bantuan Berhasil Dikonfirmasi',
      message:
        'Member resmi terdaftar pada daftar peserta kelas studio dan saldo sesi otomatis terpotong.',
      nextStep:
        'Arahkan member ke loker penyimpanan barang dan persilakan menunggu hingga sesi kelas dimulai.',
    },
    failureStates: [
      {
        code: 'CLASS_ALREADY_ENDED',
        title: 'Kelas Sudah Selesai',
        message: 'Kelas ini sudah selesai dan tidak dapat menerima pemesanan baru.',
        cause: 'Mencoba mendaftarkan walk-in pada jadwal jam yang telah lewat.',
        stepsToResolve: ['Pilih jadwal kelas berikutnya hari ini yang belum selesai.'],
      },
      {
        code: 'SELF_APPROVAL_FORBIDDEN',
        title: 'Dilarang Menyetujui Reschedule Sendiri',
        message: 'Permintaan reschedule tidak boleh disetujui oleh pemohon yang sama.',
        cause:
          'Staf mengajukan reschedule untuk akun pribadinya sendiri dan mencoba menyetujuinya.',
        stepsToResolve: [
          'Minta staf admin lain atau Manajer Cabang untuk meninjau dan memutuskan permohonan reschedule Anda.',
        ],
      },
      {
        code: 'INSUFFICIENT_CREDITS',
        title: 'Saldo Sesi Tidak Cukup',
        message: 'Member tidak memiliki saldo kuota sesi yang aktif untuk cabang ini.',
        cause: 'Kuota paket member telah habis atau masa berlaku paket telah kedaluwarsa.',
        stepsToResolve: [
          'Arahkan member untuk membeli paket sesi baru terlebih dahulu di kasir meja depan.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Syarat Walk-in',
        limit: 'Wajib memiliki akun aktif terdaftar',
        reason:
          'Sistem mencatat riwayat kehadiran dan pemotongan sesi berbasis profil unik terverifikasi.',
        alternative: 'Buatkan akun member baru terlebih dahulu melalui form pendaftaran cepat.',
      },
      {
        label: 'Pemisahan Wewenang Reschedule',
        limit: 'Dilarang menyetujui tiket akun sendiri',
        reason: 'Mencegah manipulasi kuota kelas oleh staf internal studio.',
        alternative: 'Minta Manajer Cabang untuk melakukan otorisasi.',
      },
    ],
    screenshot: {
      title: 'Layar Assisted Booking & Pemesanan Walk-in',
      description:
        'Antarmuka pencarian profil member, pemilihan paket, dan konfirmasi reservasi kelas.',
      desktopUrl: '/images/help/admin/a01-assisted-bookings-desktop.png',
      mobileUrl: '/images/help/admin/a01-assisted-bookings-mobile.png',
      secondaryTitle: 'Antrean Pengajuan Reschedule Member',
      secondaryDesktopUrl: '/images/help/admin/a01-reschedule-queue-desktop.png',
      secondaryMobileUrl: '/images/help/admin/a01-reschedule-queue-mobile.png',
    },
  },
  {
    id: 'admin-timetable',
    title: '2. Timetable Kelas Studio & Pengelolaan Kuota',
    badge: 'Penjadwalan',
    purpose:
      'Menyusun jadwal kelas mingguan, menugaskan instruktur, dan mengontrol kapasitas reformer studio.',
    prerequisites: 'Hak akses class-slot:read dan class-slot:manage pada cabang aktif.',
    requiredRole: 'Admin Cabang (ADMIN), Manajer Cabang (MANAGER), Owner (OWNER)',
    steps: [
      {
        number: 1,
        title: 'Pilih Cabang Aktif di Topbar',
        description:
          'Pastikan pemilih cabang di bagian atas navigasi menunjukkan cabang studio yang ingin Anda kelola.',
      },
      {
        number: 2,
        title: 'Buka Menu Timetable Kelas',
        description:
          'Pilih menu "Timetable kelas" (/workspace/classes) untuk melihat kalender 7 hari.',
      },
      {
        number: 3,
        title: 'Tambah atau Salin Jadwal',
        description:
          'Gunakan tombol "+ Slot Kelas" untuk membuat kelas baru, atau "Salin Jadwal Minggu" (/workspace/classes/salin) untuk mereplikasi jadwal minggu lalu.',
      },
      {
        number: 4,
        title: 'Tugaskan Instruktur & Ruangan Studio',
        description:
          'Pilih tipe kelas (Reformer Flow, Power Reformer), ruangan studio, instruktur bertugas, dan kapasitas reformer.',
      },
      {
        number: 5,
        title: 'Simpan & Publikasikan Jadwal',
        description:
          'Klik "Simpan Slot Kelas". Jadwal otomatis tampil di aplikasi pelanggan dan siap dipesan.',
      },
    ],
    successState: {
      title: 'Jadwal Kelas Terpublikasi',
      message: 'Kelas langsung tampil di kalender aplikasi pelanggan dan siap dipesan.',
      nextStep: 'Pantau keterisian kuota matras reformer melalui panel roster peserta kelas.',
    },
    failureStates: [
      {
        code: 'SCHEDULE_CONFLICT',
        title: 'Bentrok Jadwal Instruktur atau Ruangan',
        message:
          'Jadwal tidak dapat disimpan karena instruktur atau ruangan sudah terpakai pada jam tersebut.',
        cause: 'Instruktur telah ditugaskan di kelas lain atau ruangan sedang digunakan sesi lain.',
        stepsToResolve: [
          'Ganti ruangan studio atau pilih instruktur pengganti yang tersedia.',
          'Gunakan fitur Jadwal Rutin untuk melihat pratinjau bentrok secara otomatis.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Cakupan Cabang',
        limit: 'Terscope ke Cabang Aktif Staf',
        reason: 'Pemisahan tanggung jawab operasional antar cabang studio.',
        alternative:
          'Pilih cabang lain melalui dropdown topbar bila Anda memegang hak akses multi-cabang.',
      },
      {
        label: 'Batas Kapasitas Reformer',
        limit: 'Maksimal unit reformer fisik di ruangan studio',
        reason: 'Keamanan dan kenyamanan ruang gerak latihan member.',
        alternative: 'Buka sesi kelas tambahan di jam berbeda bila minat peserta tinggi.',
      },
    ],
    screenshot: {
      title: 'Layar Timetable Kelas Mingguan Studio',
      description:
        'Grid kalender 7 hari dengan slot kelas terisi, nama instruktur, dan indikator kapasitas.',
      desktopUrl: '/images/help/admin/a02-classes-timetable-desktop.png',
      mobileUrl: '/images/help/admin/a02-classes-timetable-mobile.png',
    },
  },
  {
    id: 'admin-payments-cashier',
    title: '3. Pemeriksaan Pembayaran & Pemisahan Wewenang (Prinsip 4-Mata)',
    badge: 'Verifikasi Bayar',
    purpose:
      'Meninjau keaslian bukti transfer member dan mencatat transaksi kasir meja studio dengan kepatuhan tata kelola.',
    prerequisites:
      'Hak akses purchase:review (Admin/Pengaju). Keputusan approval dipegang Finance / Super Owner (Penyetuju).',
    requiredRole: 'Admin Meja Depan (ADMIN - Pengaju), Finance Lead (FINANCE - Penyetuju)',
    steps: [
      {
        number: 1,
        title: 'Buka Antrean Pembayaran',
        description:
          'Buka menu "Pembayaran" (/workspace/payments) untuk melihat daftar bukti transfer yang masuk.',
      },
      {
        number: 2,
        title: 'Periksa Rincian Bukti Transfer',
        description:
          'Klik baris transaksi untuk melihat foto struk bank, nama pembeli, paket, dan nominal rupiah persis.',
      },
      {
        number: 3,
        title: 'Pencatatan Penjualan Kasir Meja',
        description:
          'Bila member membayar di meja (tunai/EDC), catat transaksi via form penjualan meja dengan melampirkan referensi.',
      },
      {
        number: 4,
        title: 'Teruskan Catatan ke Tim Finance',
        description:
          'Berikan catatan review hasil pemeriksaan awal. Transaksi diteruskan ke antrean keputusan persetujuan Finance.',
      },
    ],
    successState: {
      title: 'Pemeriksaan Pembayaran Diteruskan',
      message:
        'Catatan review staf meja depan tersimpan dan transaksi diteruskan ke antrean approval Finance.',
      nextStep:
        'Tim Finance mencocokkan mutasi rekening koran bank cabang dan menyetujui penerbitan paket.',
    },
    failureStates: [
      {
        code: 'SEPARATION_OF_DUTIES_VIOLATION',
        title: 'Pelanggaran Pemisahan Wewenang',
        message: 'Purchase tidak boleh diputus oleh requestor yang sama.',
        cause:
          'Staf yang mencatat transaksi kasir meja mencoba menekan tombol persetujuan pembayaran sendiri.',
        stepsToResolve: [
          'Biarkan transaksi ditinjau oleh staf Finance atau Manajer Cabang.',
          'Aturan ini diterapkan sistem untuk mencegah manipulasi keuangan kasir studio.',
        ],
      },
      {
        code: 'PROOF_UNREADABLE',
        title: 'Bukti Transfer Tidak Terbaca',
        message:
          'Foto struk transfer yang diunggah buram, terpotong, atau tidak menampilkan nominal jelas.',
        cause: 'Member mengunggah tangkapan layar m-Banking yang tidak utuh.',
        stepsToResolve: [
          'Klik tombol "Minta Unggah Ulang Bukti" dengan menyertakan catatan kepada member.',
          'Hubungi member via WhatsApp cabang bila membutuhkan konfirmasi cepat.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Pemisahan Wewenang Bertingkat',
        limit: 'Admin hanya Pengaju (Catat & Tinjau), bukan Penyetuju (Pemutus)',
        reason: 'Standar kepatuhan keuangan kasir studio Daily Dose.',
        alternative: 'Finance dan Manajer bertindak sebagai Penyetuju.',
      },
      {
        label: 'Batas Verifikasi',
        limit: 'Wajib diproses pada hari operasional yang sama',
        reason: 'Memastikan saldo sesi member segera aktif sebelum jadwal kelas dimulai.',
        alternative: 'Prioritaskan antrean member yang memiliki jadwal latihan hari ini.',
      },
    ],
    screenshot: {
      title: 'Layar Antrean Verifikasi Pembayaran Studio',
      description:
        'Daftar bukti transfer masuk dengan detail nominal, tanggal, status pengajuan, dan panel review.',
      desktopUrl: '/images/help/admin/a03-payments-queue-desktop.png',
      mobileUrl: '/images/help/admin/a03-payments-queue-mobile.png',
    },
  },
  {
    id: 'admin-checkin-desk',
    title: '4. Scanner Check-in Meja & Validasi Foto Selfie',
    badge: 'Presensi Meja Depan',
    purpose:
      'Memindai tiket kehadiran member saat tiba di studio dan memverifikasi wajah secara tatap muka.',
    prerequisites: 'Hak akses attendance:scan dan attendance:manual pada cabang aktif.',
    requiredRole: 'Admin Meja Depan (ADMIN), Manajer Cabang (MANAGER)',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Check-In Meja',
        description:
          'Buka menu "Check-in" (/workspace/check-in) pada tablet atau komputer resepsionis meja depan.',
      },
      {
        number: 2,
        title: 'Pindai Barcode QR Member',
        description:
          'Arahkan barcode scanner laser ke layar ponsel member (atau tekan tombol "Gunakan Kamera").',
      },
      {
        number: 3,
        title: 'Validasi Wajah dengan Foto Selfie',
        description:
          'Sistem langsung menampilkan nama kelas, nomor matras, dan foto selfie terverifikasi member di layar. Pastikan orang yang hadir adalah member yang sah.',
      },
      {
        number: 4,
        title: 'Konfirmasi Presensi Selesai',
        description:
          'Layar menampilkan banner hijau "VALID - BERHASIL" dan kuota sesi member otomatis terpotong di buku besar.',
      },
    ],
    successState: {
      title: 'Presensi Tercatat (VALID - BERHASIL)',
      message: 'Data kehadiran tercatat di log audit studio secara real-time.',
      nextStep: 'Arahkan member menuju loker dan persilakan memasuki ruangan kelas.',
    },
    failureStates: [
      {
        code: 'CHECK_IN_TOO_EARLY',
        title: 'Presensi Terlalu Awal (H-30 Menit)',
        message: 'QR belum aktif. Scanner meja depan dibuka 30 menit sebelum kelas.',
        cause: 'Member memindai tiket lebih awal dari batas 30 menit sebelum jadwal kelas dimulai.',
        stepsToResolve: [
          'Minta member menunggu hingga masuk rentang waktu H-30 menit.',
          'Santai di area tunggu studio sambil menikmati minuman.',
        ],
      },
      {
        code: 'ATTENDANCE_ALREADY_RECORDED',
        title: 'Presensi Sudah Pernah Dicatat',
        message: 'Kehadiran member pada kelas ini sudah tercatat sebelumnya.',
        cause: 'Member terpindai dua kali atau sudah dikonfirmasi oleh staf lain.',
        stepsToResolve: [
          'Periksa daftar kehadiran di bawah layar untuk memastikan waktu jam masuk member.',
        ],
      },
      {
        code: 'ADMIN_BACKFILL_WINDOW_CLOSED',
        title: 'Batas Toleransi Backfill H+2 Jam Terlewati',
        message:
          'Batas toleransi backfill absensi admin adalah maksimal H+2 jam setelah kelas selesai.',
        cause:
          'Pencatatan manual kehadiran dilakukan terlambat (melebihi 2 jam setelah kelas selesai).',
        stepsToResolve: ['Hubungi Manajer Cabang untuk diajukan koreksi absensi khusus.'],
      },
    ],
    constraints: [
      {
        label: 'Batas Waktu Buka Scanner',
        limit: 'H-30 Menit sebelum kelas',
        reason: 'Menjaga ketertiban antrean sesi sebelumnya di studio.',
        alternative: 'Minta member menunggu hingga 30 menit sebelum jadwal.',
      },
      {
        label: 'Toleransi Input Tertinggal (Backfill)',
        limit: 'Maksimal H+2 Jam setelah kelas selesai',
        reason: 'Integritas data honor instruktur dan penutupan kelas harian.',
        alternative: 'Gunakan permohonan penyesuaian sesi via Manajer Cabang.',
      },
    ],
    screenshot: {
      title: 'Layar Scanner Check-in Front Desk',
      description:
        'Layar pemindai tiket dengan kartu foto selfie member, detail kelas, dan indikator status hijau.',
      desktopUrl: '/images/help/admin/a04-scan-check-in-desk-desktop.png',
      mobileUrl: '/images/help/admin/a04-scan-check-in-desk-mobile.png',
    },
  },
  {
    id: 'admin-ledger-adjust',
    title: '5. Ledger Paket & Pengajuan Penyesuaian Sesi (Adjustment)',
    badge: 'Penyesuaian Sesi',
    purpose:
      'Mengajukan koreksi saldo sesi member (karena kompensasi studio atau darurat medis) untuk disetujui Manajer.',
    prerequisites: 'Hak akses ledger:read dan ledger:adjust:request pada cabang aktif.',
    requiredRole: 'Admin Cabang (ADMIN - Pengaju), Manajer Cabang (MANAGER - Penyetuju)',
    steps: [
      {
        number: 1,
        title: 'Buka Detail Paket Member',
        description:
          'Buka menu "Buku Besar & Sesi" (/ledger), cari nama member terkait, dan klik "Lihat Detail".',
      },
      {
        number: 2,
        title: 'Buka Form Penyesuaian',
        description: 'Pilih tombol "Ajukan Penyesuaian Sesi" (/ledger/adjustments).',
      },
      {
        number: 3,
        title: 'Isi Jumlah Sesi & Alasan Lengkap',
        description:
          'Tentukan delta sesi (+1 untuk kompensasi, -1 untuk koreksi), pilih kode alasan resmi (STUDIO_COMPENSATION, MEDICAL_EMERGENCY), dan ketik catatan penjelasan.',
      },
      {
        number: 4,
        title: 'Kirim Permohonan Otorisasi',
        description:
          'Permohonan masuk ke antrean persetujuan Manajer Cabang sesuai aturan 4-Eyes Principle.',
      },
    ],
    successState: {
      title: 'Pengajuan Penyesuaian Terkirim',
      message: 'Status penyesuaian: PENDING (Menunggu Persetujuan Manajer Cabang).',
      nextStep: 'Manajer Cabang akan memeriksa alasan dan menyetujui perubahan saldo kuota sesi.',
    },
    failureStates: [
      {
        code: 'MAKER_CHECKER_VIOLATION',
        title: 'Memerlukan Persetujuan Pengguna Berbeda',
        message:
          'Permintaan harus diputuskan oleh Manager atau Super Owner yang berbeda dari staf yang mengajukan.',
        cause: 'Mencoba menyetujui pengajuan sesi buatan sendiri.',
        stepsToResolve: [
          'Minta Manajer Cabang membuka menu Penyesuaian Sesi untuk melakukan otorisasi.',
        ],
      },
      {
        code: 'LEDGER_INVARIANT_VIOLATION',
        title: 'Saldo Tidak Cukup untuk Booking Aktif',
        message: 'Perubahan akan membuat kuota tidak cukup untuk booking kelas yang masih aktif.',
        cause:
          'Mencoba mengurangi sesi melebihi kuota yang sedang direservasi untuk kelas mendatang.',
        stepsToResolve: [
          'Batalkan booking mendatang member terlebih dahulu jika kuota sesi ingin ditarik.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Aturan 4-Eyes Principle',
        limit: 'Wajib 2 orang berbeda (Pemohon vs Pemutus)',
        reason: 'Mencegah manipulasi kuota sesi gratis tanpa izin manajemen.',
        alternative: 'Super Owner memegang hak audit atas seluruh penyesuaian sesi.',
      },
    ],
    screenshot: {
      title: 'Form Pengajuan Penyesuaian Sesi',
      description: 'Modal input delta sesi, pilihan alasan penyesuaian, dan pratinjau saldo akhir.',
      desktopUrl: '/images/help/admin/a05-ledger-overview-desktop.png',
      mobileUrl: '/images/help/admin/a05-ledger-overview-mobile.png',
    },
  },
  {
    id: 'admin-scoped-users',
    title: '6. Manajemen Pengguna Cabang Terscope',
    badge: 'Pengguna Cabang',
    purpose:
      'Melihat dan mengelola akun pelanggan serta staf operasional yang terdaftar di cabang studio aktif.',
    prerequisites: 'Hak akses user:read pada cabang yang ditugaskan.',
    requiredRole: 'Admin Cabang (ADMIN), Manajer Cabang (MANAGER), Owner (OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Pengguna Studio',
        description: 'Buka menu "Pengguna" (/users) atau direktori pelanggan (/customers).',
      },
      {
        number: 2,
        title: 'Filter Otomatis Berdasarkan Cabang Aktif',
        description:
          'Sistem secara otomatis menampilkan pengguna yang terdaftar pada cabang aktif staf di topbar navigasi.',
      },
      {
        number: 3,
        title: 'Cari Pelanggan atau Staf',
        description:
          'Gunakan kolom pencarian cepat untuk mencari pengguna via nama lengkap, email, atau nomor WhatsApp.',
      },
      {
        number: 4,
        title: 'Periksa Detail & Status Verifikasi',
        description:
          'Klik baris pengguna untuk melihat status verifikasi foto selfie, paket aktif, dan riwayat presensi.',
      },
    ],
    successState: {
      title: 'Data Pengguna Cabang Terbaca',
      message: 'Informasi profil member, paket latihan, dan riwayat presensi tampil lengkap.',
      nextStep: 'Berikan pendampingan reservasi atau perbarui data kontak bila diminta pelanggan.',
    },
    failureStates: [
      {
        code: 'FORBIDDEN_BRANCH_SCOPE',
        title: 'Akses Cabang Lain Ditolak',
        message:
          'Akses terbatas: Anda tidak memiliki izin untuk melihat data pengguna di luar cabang penugasan.',
        cause: 'Mencoba mengakses ID pengguna yang terikat ke cabang lain tanpa izin multi-cabang.',
        stepsToResolve: [
          'Ganti cabang aktif di topbar navigasi sesuai cabang penugasan Anda.',
          'Hubungi Super Owner jika Anda membutuhkan penugasan peran ke cabang tambahan.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Pembatasan Wilayah (Branch Scoping)',
        limit: 'Terscope ke cabang aktif yang ditugaskan',
        reason: 'Privasi data pelanggan dan pemisahan operasional antar studio fisik.',
        alternative: 'Super Owner memegang akses global lintas cabang.',
      },
    ],
    screenshot: {
      title: 'Layar Daftar Pengguna Cabang Aktif',
      description:
        'Tabel daftar pengguna tersaring cabang dengan indikator role, status aktif, dan tombol detail.',
      desktopUrl: '/images/help/admin/a06-scoped-users-list-desktop.png',
      mobileUrl: '/images/help/admin/a06-scoped-users-list-mobile.png',
    },
  },
  {
    id: 'admin-support-cases',
    title: '7. Kasus Support, Reminder & Workspace Operasional Cabang',
    badge: 'Dasbor Operasional',
    purpose:
      'Memantau pengingat operasional studio, kasus kendala member, dan renewal paket yang hampir habis.',
    prerequisites: 'Hak akses operasional cabang aktif.',
    requiredRole: 'Admin Cabang (ADMIN), Manajer Cabang (MANAGER)',
    steps: [
      {
        number: 1,
        title: 'Buka Dasbor Workspace Cabang',
        description:
          'Buka menu Dasbor Cabang (/workspace) untuk memantau aktivitas studio hari ini.',
      },
      {
        number: 2,
        title: 'Pantau Metrik Harian & Antrean',
        description:
          'Periksa jumlah kelas hari ini, tingkat keterisian matras reformer, dan antrean verifikasi bukti transfer.',
      },
      {
        number: 3,
        title: 'Buka Tab Pengingat Renewal',
        description:
          'Periksa daftar paket member yang akan habis masa berlakunya dalam 7 hari (/workspace/reminders).',
      },
      {
        number: 4,
        title: 'Tangani Kasus Bantuan Member',
        description:
          'Tindak lanjuti kendala pelanggan atau instruktur yang berhalangan dengan menghubungi member terkait.',
      },
    ],
    successState: {
      title: 'Kasus Operasional Tertangani',
      message: 'Notifikasi darurat dan kendala member berhasil diselesaikan.',
      nextStep: 'Periksa kembali kalender kelas hari berikutnya untuk memastikan kesiapan studio.',
    },
    failureStates: [
      {
        code: 'REMINDER_SYNC_FAILED',
        title: 'Gagal Memuat Pengingat Otomatis',
        message: 'Koneksi jaringan terputus saat memuat daftar pengingat pembaruan paket.',
        cause: 'Gangguan jaringan sementara di studio.',
        stepsToResolve: [
          'Tekan tombol refresh pada peramban.',
          'Pastikan koneksi internet studio aktif dan stabil.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Komunikasi Resmi',
        limit: 'Wajib menggunakan WhatsApp resmi cabang',
        reason: 'Menjaga profesionalitas dan rekam jejak bantuan pelanggan.',
        alternative: 'Gunakan template pesan resmi studio Daily Dose.',
      },
    ],
    screenshot: {
      title: 'Dasbor Operasional Workspace Cabang',
      description:
        'Ringkasan metrik kelas harian studio, status antrean kasir, dan kartu kasus operasional.',
      desktopUrl: '/images/help/admin/a07-workspace-dashboard-desktop.png',
      mobileUrl: '/images/help/admin/a07-workspace-dashboard-mobile.png',
    },
  },
];

export const HELP_SECTIONS_SUPER_ADMIN: HelpSection[] = [
  {
    id: 'super-users-roles',
    title: '1. Manajemen Pengguna, Staf & Matriks Hak Akses (RBAC)',
    badge: 'Tata Kelola & Keamanan',
    purpose:
      'Mengelola akun staf internal studio, penetapan peran (ADMIN, MANAGER, FINANCE, INSTRUCTOR), dan memverifikasi batas wewenang cabang vs global pada matriks kapabilitas resmi.',
    prerequisites: 'Hak akses user:admin, user:read, dan role-permission:manage.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Staf & Pengguna',
        description: 'Buka menu "Staf & Pengguna" (/users) dari bilah navigasi utama.',
      },
      {
        number: 2,
        title: 'Tambah Akun Staf Baru',
        description:
          'Klik "+ Tambah Pengguna", isi nama lengkap, alamat email resmi, nomor WhatsApp aktif, dan pilih peran yang relevan.',
      },
      {
        number: 3,
        title: 'Tentukan Cakupan Cabang',
        description:
          'Untuk peran terikat cabang (ADMIN, MANAGER, INSTRUCTOR), tetapkan cabang studio tempat staf bertugas. Peran FINANCE dan SUPER_OWNER berlaku otomatis lintas seluruh cabang.',
      },
      {
        number: 4,
        title: 'Tinjau Matriks Hak Akses',
        description:
          'Buka menu "Peran & Hak Akses" (/users/roles-permissions) untuk memverifikasi daftar kapabilitas sistem granular per peran sesuai prinsip least-privilege.',
      },
      {
        number: 5,
        title: 'Revoke Sesi & Nonaktifkan Akses',
        description:
          'Jika masa tugas staf selesai atau terjadi pergantian personel, gunakan tombol "Revoke Sesi" untuk memutuskan token seketika dan "Nonaktifkan Akun" guna memblokir login.',
      },
    ],
    successState: {
      title: 'Akun Staf & Penugasan Peran Berhasil Disimpan',
      message:
        'Tautan pengaturan kata sandi dikirimkan ke email staf, dan izin operasional langsung aktif sesuai matriks cabang.',
      nextStep:
        'Arahkan staf baru untuk memeriksa kotak masuk email dan mengaktifkan autentikasi akun.',
    },
    failureStates: [
      {
        code: 'STALE_VERSION',
        title: 'Konflik Pembaruan Data Pengguna',
        message:
          'Data pengguna telah berubah sejak terakhir dimuat. Muat ulang sebelum melanjutkan.',
        cause:
          'Administrator lain baru saja memperbarui profil atau status staf yang sama secara bersamaan.',
        stepsToResolve: [
          'Muat ulang halaman /users untuk mengambil data versi terbaru.',
          'Terapkan kembali penyesuaian peran atau status akun.',
        ],
      },
      {
        code: 'CANNOT_DEACTIVATE_SELF',
        title: 'Dilarang Menonaktifkan Akun Sendiri',
        message: 'Anda tidak dapat menonaktifkan akun Super Owner yang sedang aktif digunakan.',
        cause:
          'Mencoba menonaktifkan akun sendiri, yang berpotensi memicu penguncian administratif sistem (lockout).',
        stepsToResolve: [
          'Minta Super Owner lain untuk menonaktifkan akun Anda jika terjadi pergantian penanggung jawab utama.',
        ],
      },
      {
        code: 'CROSS_BRANCH_ASSIGNMENT_DENIED',
        title: 'Pelanggaran Batas Wilayah Peran Cabang',
        message: 'Peran ADMIN atau MANAGER wajib diasosiasikan dengan tepat satu cabang aktif.',
        cause:
          'Mencoba membuat akun admin tanpa memilih cabang atau mengaitkan cabang yang sedang nonaktif.',
        stepsToResolve: ['Pilih cabang studio yang aktif pada menu dropdown cabang penugasan.'],
      },
    ],
    constraints: [
      {
        label: 'Pemisahan Ruang Lingkup Peran',
        limit: 'ADMIN, MANAGER, OWNER, INSTRUCTOR terikat cabang; FINANCE & SUPER_OWNER global',
        reason: 'Kerahasiaan data operasional studio dan isolasi keuangan antar cabang pemilik.',
        alternative: 'Gunakan SUPER_OWNER bila membutuhkan otorisasi penuh di semua cabang.',
      },
      {
        label: 'Proteksi Akun Super Owner Terakhir',
        limit: 'Minimal 1 akun SUPER_OWNER wajib selalu aktif',
        reason: 'Mencegah kegagalan tata kelola sistem permanen.',
        alternative:
          'Buat akun Super Owner pengganti terlebih dahulu sebelum menonaktifkan akun lama.',
      },
    ],
    screenshot: {
      title: 'Layar Matriks Hak Akses & Kapabilitas RBAC',
      description: 'Tabel matriks izin granular sistem Daily Dose Pilates untuk peran staf studio.',
      desktopUrl: '/images/help/super-admin/s01-roles-permissions-matrix-desktop.png',
      mobileUrl: '/images/help/super-admin/s01-roles-permissions-matrix-mobile.png',
    },
  },
  {
    id: 'super-identity-review',
    title: '2. Antrean Peninjauan Cepat Identitas Nasional (Fast Review KTP/Selfie)',
    badge: 'Kepatuhan & KYC',
    purpose:
      'Memvalidasi foto selfie dan identitas member studio secara cepat dengan antrean khusus dan pintasan keyboard atau menghapus berkas foto sensitif demi kepatuhan privasi data.',
    prerequisites: 'Hak akses identity-verification:read dan identity-verification:decide.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Antrean Verifikasi Identitas',
        description:
          'Buka menu "Verifikasi Pelanggan" (/identity-verifications) untuk melihat antrean dokumen berstatus PENDING.',
      },
      {
        number: 2,
        title: 'Masuk ke Mode Fast Review',
        description:
          'Klik tombol "Review Cepat" (/identity-verifications/cepat) untuk memeriksa dokumen dengan tampilan satu per satu layar penuh beresolusi tinggi.',
      },
      {
        number: 3,
        title: 'Putuskan dengan Pintasan Keyboard',
        description:
          'Tekan tombol "A" pada keyboard untuk Menyetujui (Approve), atau tekan "R" untuk Menolak (Reject).',
        tips: 'Pintasan keyboard mempercepat verifikasi tanpa perlu memindahkan kursor mouse.',
      },
      {
        number: 4,
        title: 'Tentukan Alasan Penolakan Resmi',
        description:
          'Jika menolak, pilih alasan standar (BLURRY, GLARE, CROPPED, FACE_MISMATCH, atau OTHER_REQUIRES_NOTE dengan catatan deskriptif wajib).',
      },
      {
        number: 5,
        title: 'Penghapusan Berkas Sensitif',
        description:
          'Untuk dokumen salah unggah atau atas permohonan privasi, gunakan fitur hapus permanen dengan memasukkan alasan audit resmi.',
      },
    ],
    successState: {
      title: 'Dokumen Berhasil Diputuskan',
      message: 'Status verifikasi member diperbarui seketika dan tercatat di riwayat audit.',
      nextStep: 'Member otomatis menerima hak memesan kelas studio dan notifikasi dikirimkan.',
    },
    failureStates: [
      {
        code: 'IDENTITY_DOCUMENT_NOT_READY',
        title: 'Dokumen Belum Siap Diproses',
        message: 'Berkas foto identitas masih dalam antrean pemrosesan penyimpanan privat.',
        cause:
          'Sistem penyimpanan berkas S3/MinIO sedang melakukan sinkronisasi asinkron objek foto.',
        stepsToResolve: ['Tunggu beberapa detik lalu muat ulang antrean verifikasi.'],
      },
      {
        code: 'VALIDATION_ERROR',
        title: 'Alasan Penolakan Wajib Dipilih',
        message:
          'Penolakan verifikasi wajib menyertakan kode alasan resmi dan catatan jika memilih OTHER.',
        cause: 'Form penolakan dikirimkan tanpa memilih reasonCode.',
        stepsToResolve: [
          'Pilih salah satu kode alasan: BLURRY, GLARE, CROPPED, atau FACE_MISMATCH.',
          'Jika memilih OTHER_REQUIRES_NOTE, ketik penjelasan minimal 10 karakter.',
        ],
      },
      {
        code: 'STORAGE_UNAVAILABLE',
        title: 'Penyimpanan Privat Tidak Dapat Diakses',
        message: 'Layanan penyimpanan MinIO/S3 privat mengalami timeout koneksi.',
        cause: 'Gangguan koneksi jaringan atau kredensial bucket penyimpanan internal.',
        stepsToResolve: [
          'Periksa status probe private-storage pada menu Status Sistem (/health).',
          'Coba kembali setelah layanan storage berstatus READY.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Alasan Penolakan Wajib',
        limit: 'Alasan audit wajib dicatat di log sistem',
        reason:
          'Memberikan transparansi kepada pelanggan agar mengetahui bagian foto yang harus diperbaiki.',
        alternative: 'Gunakan catatan khusus jika kasus ketidaksesuaian bersifat spesifik.',
      },
      {
        label: 'Retensi Berkas & Privasi',
        limit: 'Maksimal 30 hari retensi dokumen',
        reason: 'Kepatuhan terhadap regulasi privasi data perlindungan konsumen.',
        alternative:
          'Foto wajah selfie yang disetujui tetap diarsipkan untuk pencocokan presensi meja.',
      },
    ],
    screenshot: {
      title: 'Layar Antrean Peninjauan Cepat Identitas Member',
      description: 'Antarmuka Fast Review dokumen verifikasi identitas dan pintasan keputusan.',
      desktopUrl: '/images/help/super-admin/s02-identity-verifications-queue-desktop.png',
      mobileUrl: '/images/help/super-admin/s02-identity-verifications-queue-mobile.png',
    },
  },
  {
    id: 'super-branches-master',
    title: '3. Manajemen Master Cabang, Rekening Bank & Kontak Cabang',
    badge: 'Master Data',
    purpose:
      'Mengonfigurasi data master studio, koordinat geofence presensi, nomor WhatsApp/email layanan pelanggan, dan rekening bank penerima pembayaran.',
    prerequisites:
      'Hak akses master:manage, master:read, payment-account:manage, dan payment-account:read.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Master Cabang',
        description:
          'Buka menu "Manajemen Cabang" (/workspace/branches) untuk melihat daftar cabang aktif dan nonaktif.',
      },
      {
        number: 2,
        title: 'Atur Informasi Studio & Geofence',
        description:
          'Lengkapi nama studio, kode unik cabang, zona waktu (WIB/WITA/WIT), koordinat lintang & bujur GPS, serta radius toleransi geofence presensi (default 100 meter).',
      },
      {
        number: 3,
        title: 'Atur Kontak Dukungan Resmi',
        description:
          'Masukkan nomor WhatsApp resmi format internasional E.164 (+62...) dan alamat email dukungan cabang (supportEmail). Bila dikosongkan, sistem otomatis menerapkan fallback ke kontak pusat.',
      },
      {
        number: 4,
        title: 'Kelola Rekening Bank Penerima',
        description:
          'Pada tab "Rekening Bank", daftarkan rekening bank studio (BCA, Mandiri, BNI, BRI) atau QRIS. Nomor rekening otomatis dienkripsi dengan standar AES-256-GCM.',
      },
      {
        number: 5,
        title: 'Transisi Status Cabang',
        description:
          'Gunakan fitur Nonaktifkan Cabang jika studio sedang renovasi sementara. Transaksi historis tetap aman dan utuh.',
      },
    ],
    successState: {
      title: 'Konfigurasi Cabang & Rekening Disimpan',
      message:
        'Pengaturan geofence, kontak eskalasi, dan rekening bank langsung aktif di portal pelanggan.',
      nextStep:
        'Lakukan uji pemesanan paket pada cabang tersebut untuk memverifikasi tampilan nomor rekening checkout.',
    },
    failureStates: [
      {
        code: 'BRANCH_CODE_EXISTS',
        title: 'Kode Cabang Sudah Digunakan',
        message: 'Kode cabang harus unik di seluruh sistem Daily Dose Pilates.',
        cause: 'Memasukkan kode singkatan cabang yang sudah pernah didaftarkan sebelumnya.',
        stepsToResolve: [
          'Gunakan kode cabang unik lain yang belum terdaftar (contoh: JKT-BRT, SBY-TMR).',
        ],
      },
      {
        code: 'VALIDATION_ERROR',
        title: 'Format Nomor Telepon Tidak Valid',
        message: 'Nomor WhatsApp wajib menggunakan format internasional E.164 (+62...).',
        cause: 'Mengetikkan nomor ponsel dengan awalan 08 tanpa kode negara +62.',
        stepsToResolve: ['Gunakan awalan +62 (contoh: +6281234567890).'],
      },
      {
        code: 'CANNOT_DELETE_ACCOUNT_IN_USE',
        title: 'Rekening Masih Terhubung ke Transaksi',
        message: 'Rekening bank yang memiliki riwayat mutasi pembayaran tidak dapat dihapus.',
        cause: 'Mencoba menghapus rekening aktif yang sudah digunakan member untuk transfer.',
        stepsToResolve: [
          'Gunakan tombol "Nonaktifkan Rekening" agar rekening tidak lagi muncul pada transaksi baru namun riwayat keuangan tetap terjaga.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Enkripsi Rekening Bank',
        limit: 'Enkripsi AES-256-GCM pada level basis data',
        reason: 'Melindungi kerahasiaan nomor rekening perbankan dari akses langsung basis data.',
        alternative: 'Nomor rekening ditampilkan dengan penyamaran bintang pada antarmuka biasa.',
      },
      {
        label: 'Batas Geofence Presensi',
        limit: 'Radius 50 meter hingga 500 meter',
        reason:
          'Menjamin akurasi presensi member hanya dapat dilakukan di dalam gedung studio Pilates.',
        alternative: 'Gunakan scanner barcode meja depan jika member mengalami kendala GPS ponsel.',
      },
    ],
    screenshot: {
      title: 'Layar Pengaturan Master Cabang & Rekening Studio',
      description:
        'Formulir pengaturan lokasi, kontak eskalasi WhatsApp/Email, dan rekening pembayaran resmi.',
      desktopUrl: '/images/help/super-admin/s03-branches-master-desktop.png',
      mobileUrl: '/images/help/super-admin/s03-branches-master-mobile.png',
    },
  },
  {
    id: 'super-audit-trail',
    title: '4. Log Jejak Audit Sistem Immutable & Pelacakan Korelasi',
    badge: 'Keamanan & Audit',
    purpose:
      'Memeriksa seluruh log mutasi data sistem secara transparan tanpa risiko manipulasi, menelusuri aktor pengubah kebijakan, serta menyensor otomatis data pribadi (PII).',
    prerequisites: 'Hak akses audit:read.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Log Audit Terpusat',
        description:
          'Buka menu "Audit Akses" (/audit) untuk memantau rekaman kronologis seluruh perubahan data penting sistem.',
      },
      {
        number: 2,
        title: 'Terapkan Filter Penelusuran',
        description:
          'Saring rekaman berdasarkan rentang tanggal, jenis objek (User, Package, Payment, Ledger), cabang, atau aktor staf.',
      },
      {
        number: 3,
        title: 'Lacak Melalui CorrelationId',
        description:
          'Gunakan ID korelasi unik pada setiap permintaan API untuk menghubungkan log audit dengan log server backend.',
      },
      {
        number: 4,
        title: 'Tinjau Perubahan Sebelum & Sesudah (Diff)',
        description:
          'Klik baris entri audit untuk melihat nilai beforeMasked dan afterMasked secara rinci.',
      },
      {
        number: 5,
        title: 'Ekspor Laporan Kepatuhan',
        description:
          'Unduh rekap audit ke format CSV / JSON untuk kebutuhan audit kepatuhan tahunan.',
      },
    ],
    successState: {
      title: 'Entri Audit Terkonfirmasi Sah & Utuh',
      message: 'Seluruh riwayat modifikasi terekam dalam tabel auditLog yang bersifat append-only.',
      nextStep: 'Simpan CorrelationId jika perlu melakukan investigasi mendalam bersama tim IT.',
    },
    failureStates: [
      {
        code: 'AUDIT_LOG_IMMUTABLE',
        title: 'Jejak Audit Bersifat Permanen',
        message: 'Sistem menolak mutasi UPDATE atau DELETE pada tabel audit log.',
        cause: 'Percobaan modifikasi atau penghapusan catatan audit sistem.',
        stepsToResolve: [
          'Jejak audit dirancang tidak dapat diubah (immutable) demi kepatuhan hukum dan forensik digital.',
        ],
      },
      {
        code: 'QUERY_RANGE_TOO_LARGE',
        title: 'Rentang Waktu Terlalu Panjang',
        message: 'Pencarian log tanpa filter spesifik melebihi 90 hari.',
        cause: 'Permintaan data audit yang terlalu besar dapat membebani basis data produksi.',
        stepsToResolve: [
          'Persempit rentang tanggal pencarian atau tambahkan filter aktor/objek spesifik.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Penyensoran Data Sensitif (PII Scrubbing)',
        limit: 'Password, token, NIK, dan nomor rekening disensor otomatis (scrubAuditValue)',
        reason: 'Kepatuhan standar ISO 27001 dan perlindungan privasi data pengguna.',
        alternative: 'Informasi teknis tetap dapat ditelusuri melalui correlationId unik.',
      },
      {
        label: 'Basis Data Append-Only',
        limit: 'Tabel auditLog tidak mendukung operasi penghapusan baris',
        reason: 'Menjamin bukti audit tidak dapat dimanipulasi oleh siapa pun.',
        alternative:
          'Arsipkan data lawas ke penyimpanan dingin (cold storage) jika kapasitas penuh.',
      },
    ],
    screenshot: {
      title: 'Layar Jejak Audit Transaksi & Keamanan Sistem',
      description:
        'Tabel riwayat tindakan dengan aktor, cabang, correlationId, dan nilai modifikasi data.',
      desktopUrl: '/images/help/super-admin/s04-audit-trail-desktop.png',
      mobileUrl: '/images/help/super-admin/s04-audit-trail-mobile.png',
    },
  },
  {
    id: 'super-public-content',
    title: '5. Pengaturan Konten Publik, Banner Hero Carousel & FAQ',
    badge: 'Manajemen Konten',
    purpose:
      'Mengatur materi promosi pada halaman beranda publik, slide carousel hero Pilates, dan konten pertanyaan umum (FAQ) pelanggan.',
    prerequisites: 'Hak akses public-content:read dan public-content:manage.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Manajemen Konten Publik',
        description:
          'Buka menu "Konten Publik" (/public-content-management) lalu pilih tab "Slider Banner" atau "FAQ Beranda".',
      },
      {
        number: 2,
        title: 'Tambah atau Sunting Slide Banner',
        description:
          'Tentukan judul slide, teks subjudul, tautan ajakan aksi (CTA), dan interval rotasi otomatis (standar 5.000 ms).',
      },
      {
        number: 3,
        title: 'Unggah Visual Banner',
        description:
          'Pilih berkas foto banner rasio horizontal yang ideal untuk desktop dan mobile dengan ukuran maksimal 5 MB.',
      },
      {
        number: 4,
        title: 'Kelola Butir Pertanyaan FAQ',
        description:
          'Pada tab "FAQ Beranda", tambahkan pertanyaan umum seputar kelas reformer, busana latihan, dan ketentuan pembatalan.',
      },
      {
        number: 5,
        title: 'Simpan & Publikasikan',
        description:
          'Klik "Simpan Konten". Perubahan langsung aktif di landing page publik tanpa perlu melakukan restart server.',
      },
    ],
    successState: {
      title: 'Konten Publik Berhasil Diperbarui',
      message:
        'Slide banner promosi dan daftar FAQ langsung diperbarui di portal depan pengunjung.',
      nextStep:
        'Buka beranda (/) pada tab penyamaran (incognito) untuk memverifikasi tampilan visual.',
    },
    failureStates: [
      {
        code: 'IMAGE_TOO_LARGE',
        title: 'Ukuran Gambar Melebihi Batas Maksimal',
        message: 'Ukuran berkas banner melebihi batas 5 MB yang ditentukan.',
        cause: 'Mengunggah foto resolusi mentah kamera tanpa kompresi.',
        stepsToResolve: [
          'Kompres gambar menggunakan format WebP atau JPEG dengan ukuran di bawah 5 MB.',
        ],
      },
      {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        title: 'Format Gambar Tidak Didukung',
        message: 'Sistem hanya menerima berkas gambar bertipe JPEG, PNG, atau WebP.',
        cause: 'Mengunggah berkas format PDF, GIF, atau SVG.',
        stepsToResolve: ['Konversi berkas ke format WebP atau PNG sebelum diunggah.'],
      },
      {
        code: 'VALIDATION_ERROR',
        title: 'Kolom Wajib Belum Terisi',
        message: 'Judul banner dan URL gambar tidak boleh kosong.',
        cause: 'Menyimpan form slide tanpa mengisi judul atau gambar.',
        stepsToResolve: ['Lengkapi judul slide dan pastikan gambar telah selesai diunggah.'],
      },
    ],
    constraints: [
      {
        label: 'Batas Ukuran Berkas Media',
        limit: 'Maksimal 5 MB per gambar',
        reason: 'Menjaga kecepatan pemuatan halaman muka dan skor LCP Core Web Vitals.',
        alternative:
          'Gunakan format WebP untuk kompresi visual terbaik tanpa mengurangi ketajaman.',
      },
      {
        label: 'Interval Rotasi Slider',
        limit: 'Minimal 3.000 ms hingga maksimal 15.000 ms',
        reason: 'Memberikan jeda baca yang nyaman bagi calon member studio.',
        alternative: 'Pengunjung tetap dapat menggeser banner secara manual.',
      },
    ],
    screenshot: {
      title: 'Layar Editor Slider Hero & Banner Publik',
      description: 'Form pengaturan carousel gambar beranda, teks ajakan (CTA), dan daftar FAQ.',
      desktopUrl: '/images/help/super-admin/s05-public-content-management-desktop.png',
      mobileUrl: '/images/help/super-admin/s05-public-content-management-mobile.png',
    },
  },
  {
    id: 'super-notifications',
    title: '6. Manajemen Template Notifikasi WhatsApp & Email Massal',
    badge: 'Komunikasi Pelanggan',
    purpose:
      'Menyusun dan mengonfigurasi template pesan otomatis WhatsApp gateway serta email transaksional studio.',
    prerequisites: 'Hak akses notification:manage.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Menu Template Notifikasi',
        description:
          'Buka menu "Manajemen Notifikasi" (/notification-management) untuk melihat daftar template transaksional.',
      },
      {
        number: 2,
        title: 'Pilih Kanal & Acara Notifikasi',
        description:
          'Pilih kanal (WhatsApp atau Email) dan jenis acara seperti Pembelian Paket, Tiket Booking, Presensi, atau Pengingat H-24.',
      },
      {
        number: 3,
        title: 'Gunakan Variabel Dinamis Resmi',
        description:
          'Sisipkan variabel resmi dengan kurung ganda, seperti {{nama}}, {{namaKelas}}, {{jam}}, {{lokasi}}, dan {{kodeBooking}}.',
      },
      {
        number: 4,
        title: 'Periksa Batasan Panjang Teks',
        description:
          'Pastikan isi pesan WhatsApp tidak melebihi 1.000 karakter, subjek email maksimal 200 karakter, dan intro email maksimal 800 karakter.',
      },
      {
        number: 5,
        title: 'Simpan Template & Uji Coba',
        description:
          'Klik "Simpan Template". Kirimkan pesan uji coba ke kontak staf internal untuk memeriksa rendering variabel.',
      },
    ],
    successState: {
      title: 'Template Notifikasi Berhasil Disimpan',
      message:
        'Perubahan template langsung diterapkan untuk seluruh pesan otomatis yang dikirimkan sistem.',
      nextStep: 'Pantau status keberhasilan pengiriman pada antrean gateway WhatsApp.',
    },
    failureStates: [
      {
        code: 'UNKNOWN_VARIABLE',
        title: 'Variabel Dinamis Tidak Dikenal',
        message: 'Template memuat variabel yang tidak didukung untuk jenis acara ini.',
        cause: 'Mengetik variabel yang tidak ada pada daftar variabel resmi template.',
        stepsToResolve: [
          'Gunakan hanya variabel resmi yang tertera pada panduan samping formulir.',
        ],
      },
      {
        code: 'MALFORMED_PLACEHOLDER',
        title: 'Format Penulisan Variabel Rusak',
        message: 'Terdapat kurung ganda yang tidak ditutup dengan lengkap.',
        cause: 'Mengetik {{nama tanpa diakhiri tanda kurung tutup }}.',
        stepsToResolve: ['Pastikan setiap variabel diawali {{ dan diakhiri }} (contoh: {{nama}}).'],
      },
      {
        code: 'TOO_LONG',
        title: 'Panjang Teks Melebihi Batas Maksimal',
        message: 'Panjang isi pesan melebihi batas karakter yang diizinkan.',
        cause:
          'Isi teks pesan WhatsApp melebihi 1.000 karakter atau subjek email melebihi 200 karakter.',
        stepsToResolve: ['Persingkat teks pesan agar sesuai dengan batas maksimal karakter.'],
      },
    ],
    constraints: [
      {
        label: 'Batas Karakter WhatsApp',
        limit: 'Maksimal 1.000 karakter',
        reason: 'Mencegah pemotongan pesan dan penalti pengiriman oleh gateway WhatsApp.',
        alternative: 'Sertakan tautan ringkas ke portal web untuk detail informasi yang panjang.',
      },
      {
        label: 'Batas Subjek Email',
        limit: 'Maksimal 200 karakter',
        reason: 'Mencegah email masuk ke folder promosi atau spam penerima.',
        alternative: 'Tempatkan detail tambahan pada bagian tubuh email.',
      },
    ],
    screenshot: {
      title: 'Layar Konfigurasi Template Notifikasi Otomatis',
      description: 'Editor template teks WhatsApp dan Email dengan panduan variabel dinamis.',
      desktopUrl: '/images/help/super-admin/s06-notification-management-desktop.png',
      mobileUrl: '/images/help/super-admin/s06-notification-management-mobile.png',
    },
  },
  {
    id: 'super-system-health',
    title: '7. Diagnostik Kesehatan Sistem, Probe Dependensi & Evaluasi H-24',
    badge: 'Keandalan Sistem',
    purpose:
      'Memantau kesiapan operasional server secara real-time melalui 5 probe dependensi inti dan mengevaluasi eksekusi cron pembatalan otomatis kelas di bawah kuota H-24.',
    prerequisites: 'Hak akses operations:read, operations:recover, dan automation:run.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Halaman Status Sistem',
        description:
          'Buka menu "Status Sistem" (/health) untuk memeriksa indikator kesiapan operasional server (READY, DEGRADED, atau NOT_READY).',
      },
      {
        number: 2,
        title: 'Evaluasi 5 Probe Dependensi',
        description:
          'Periksa status komponen utama: API Server, Database MySQL (Prisma), Penjadwal Otomatis (Scheduler/Cron), Penyimpanan Privat (MinIO/S3), dan Pemindai Bukti Bayar.',
      },
      {
        number: 3,
        title: 'Pantau Log Evaluasi Kuota Kelas H-24',
        description:
          'Buka menu "Operasi" (/operations) untuk memeriksa apakah tugas cron pemantau kelas berjalan tepat waktu 24 jam sebelum jam kelas dimulai.',
      },
      {
        number: 4,
        title: 'Pulihkan Dependensi Degraded',
        description:
          'Jika salah satu dependensi berstatus DEGRADED, klik tombol "Coba Pulihkan Koneksi" atau periksa log error detailCode.',
      },
      {
        number: 5,
        title: 'Trigger Manual Darurat',
        description:
          'Jika cron terjeda karena pemeliharaan server, jalankan pemicu manual untuk memproses pembatalan kelas di bawah kuota minimum.',
      },
    ],
    successState: {
      title: 'Seluruh Dependensi Sistem Berstatus Siap (READY)',
      message:
        'API, basis data, penyimpanan privat, dan worker cron beroperasi dengan latensi normal dan tanpa kendala.',
      nextStep: 'Tidak ada tindakan perbaikan yang diperlukan, sistem berjalan optimal.',
    },
    failureStates: [
      {
        code: 'SERVICE_UNAVAILABLE',
        title: 'Konektivitas Dependensi Terputus',
        message:
          'Salah satu layanan inti seperti basis data MySQL atau Redis cache tidak merespons.',
        cause: 'Timeout koneksi melebihi 5 detik pada probe dependensi.',
        stepsToResolve: [
          'Periksa kontainer infrastruktur basis data dan cache Redis.',
          'Lakukan restart pada pod atau service yang mengalami kendala.',
        ],
      },
      {
        code: 'SCHEDULER_HEARTBEAT_MISSED',
        title: 'Penjadwal Otomatis Terhenti',
        message: 'Detak jantung background worker cron H-24 terhenti.',
        cause: 'Worker cron crash atau terkendala memori pada background runner.',
        stepsToResolve: [
          'Periksa log scheduler pada menu Operasi.',
          'Jalankan trigger manual evaluasi kuota jika waktu H-24 mendesak.',
        ],
      },
      {
        code: 'STORAGE_CONNECT_TIMEOUT',
        title: 'Koneksi Penyimpanan Privat Gagal',
        message: 'Penyimpanan MinIO/S3 tidak dapat dihubungi.',
        cause: 'Sertifikat SSL kedaluwarsa atau firewall memblokir port storage.',
        stepsToResolve: ['Periksa kredensial akses S3 dan konektivitas endpoint storage.'],
      },
    ],
    constraints: [
      {
        label: 'Batas Waktu Health Check Timeout',
        limit: 'Maksimal 5.000 ms per probe',
        reason: 'Mencegah health probe membebani siklus proses server.',
        alternative: 'Probe yang melewati batas waktu otomatis dilaporkan sebagai DEGRADED.',
      },
      {
        label: 'Otomasi H-24 Cutoff',
        limit: 'Eksekusi evaluasi tepat 24 jam sebelum kelas dimulai',
        reason:
          'Memberikan kepastian pengembalian kuota sesi kepada pelanggan jika kelas dibatalkan karena kuota minimal tidak tercapai.',
        alternative: 'Staf manajer dapat mengevaluasi manual di atas toleransi sistem.',
      },
    ],
    screenshot: {
      title: 'Layar Status Kesehatan Dependensi & Server',
      description:
        'Panel pemantauan status probe API, Database, Scheduler, Private Storage, dan OCR Scanner.',
      desktopUrl: '/images/help/super-admin/s07-system-health-desktop.png',
      mobileUrl: '/images/help/super-admin/s07-system-health-mobile.png',
    },
  },
  {
    id: 'super-migration-reconciliation',
    title: '8. Rekonsiliasi Migrasi V1 & Pembetulan Saldo Historis',
    badge: 'Integritas Data Historis',
    purpose:
      'Memeriksa catatan transaksi dan saldo member yang diimpor dari sistem warisan (V1), memverifikasi alias peran lawas, dan melakukan pembetulan saldo kuota yang sah.',
    prerequisites: 'Hak akses migration:read, ledger:adjust:approve, dan user:admin.',
    requiredRole: 'Super Owner (SUPER_OWNER)',
    steps: [
      {
        number: 1,
        title: 'Buka Tab Riwayat Transaksi Historis',
        description:
          'Aktifkan opsi "Sertakan Transaksi Historis V1" (includeHistorical=true) pada peninjauan buku besar paket member.',
      },
      {
        number: 2,
        title: 'Verifikasi Pemetaan ID & Alias Peran',
        description:
          'Pastikan peran warisan (seperti SUPERADMIN) telah dialihkan ke penamaan kanonik V2 (SUPER_OWNER) oleh layanan otomatis RoleAliasMigrationService.',
      },
      {
        number: 3,
        title: 'Lakukan Rekonsiliasi Saldo Member',
        description:
          'Bandingkan catatan mutasi sesi fisik kartu lama dengan total saldo kredit digital di buku besar Daily Dose V2.',
      },
      {
        number: 4,
        title: 'Eksekusi Pembetulan Saldo Resmi',
        description:
          'Jika terdapat selisih kuota hasil migrasi, catat entri penyesuaian khusus berjenis MIGRATION_CORRECTION dengan menyertakan nomor tiket audit fisik.',
      },
      {
        number: 5,
        title: 'Kunci Status Rekonsiliasi',
        description:
          'Pastikan seluruh paket warisan yang kedaluwarsa ditandai ARCHIVED agar tidak dapat digunakan untuk reservasi baru.',
      },
    ],
    successState: {
      title: 'Rekonsiliasi Data Historis V1 Berhasil Divalidasi',
      message:
        'Seluruh saldo member warisan tercatat akurat dan tersinkronisasi penuh dengan buku besar V2.',
      nextStep:
        'Member migrasi dapat langsung melakukan reservasi kelas menggunakan saldo sesi resmi yang telah divalidasi.',
    },
    failureStates: [
      {
        code: 'HISTORICAL_DATA_LOCKED',
        title: 'Data Migrasi Bersifat Terkunci',
        message:
          'Transaksi historis V1 yang telah ditutup tidak dapat diubah kembali secara langsung.',
        cause: 'Mencoba mengedit mutasi saldo lama yang telah berstatus final pada batch migrasi.',
        stepsToResolve: [
          'Buat entri penyesuaian buku besar baru bertipe MIGRATION_CORRECTION untuk mengoreksi selisih saldo.',
        ],
      },
      {
        code: 'UNMATCHED_LEGACY_REFERENCE',
        title: 'Nomor Referensi V1 Tidak Ditemukan',
        message: 'Kode transaksi atau member warisan tidak cocok dengan berkas pemetaan migrasi.',
        cause: 'Salah memasukkan nomor referensi kartu fisik V1.',
        stepsToResolve: ['Periksa kembali nomor kartu fisik pada lembar serah terima data awal.'],
      },
      {
        code: 'MIGRATION_AUDIT_MISMATCH',
        title: 'Selisih Nilai Rekonsiliasi Terdeteksi',
        message: 'Total sesi yang diajukan tidak seimbang dengan mutasi awal yang diimpor.',
        cause: 'Jumlah sesi yang diklaim melebihi batas saldo kartu yang tercatat.',
        stepsToResolve: [
          'Verifikasi ulang riwayat pemakaian kelas di kartu fisik sebelum menyetujui pembetulan kuota.',
        ],
      },
    ],
    constraints: [
      {
        label: 'Kewajiban Referensi Audit Fisik',
        limit: 'Wajib menyertakan nomor bukti kartu V1 pada setiap mutasi MIGRATION_CORRECTION',
        reason: 'Mencegah penambahan saldo fiktif yang tidak berdasar pada buku besar studio.',
        alternative: 'Lampirkan foto kartu fisik member pada tiket eskalasi manajer.',
      },
      {
        label: 'Hak Akses Eksklusif Migration',
        limit: 'Hanya akun dengan kapabilitas migration:read yang dapat menampilkan data lawas',
        reason:
          'Menjaga kebersihan antarmuka operasional staf harian dari tumpukan data non-aktif.',
        alternative:
          'Staf meja depan dapat meminta bantuan Super Owner untuk mengecek status kartu lama.',
      },
    ],
    screenshot: {
      title: 'Layar Log Jejak Audit & Rekonsiliasi Sistem',
      description:
        'Audit trail immutable yang merekam penyesuaian migrasi data paket dan alias peran sistem.',
      desktopUrl: '/images/help/super-admin/s04-audit-trail-desktop.png',
      mobileUrl: '/images/help/super-admin/s04-audit-trail-mobile.png',
      secondaryTitle: 'Status Dependensi & Kesiapan Server',
      secondaryDesktopUrl: '/images/help/super-admin/s07-system-health-desktop.png',
      secondaryMobileUrl: '/images/help/super-admin/s07-system-health-mobile.png',
    },
  },
];

export const HELP_FAQS: HelpFaqItem[] = [
  {
    question: 'Bagaimana jika saya tidak sempat hadir di kelas yang sudah saya booking?',
    audience: 'customer',
    answer:
      'Jika pembatalan dilakukan sebelum batas H-24, sesi paket Anda akan dikembalikan utuh ke saldo akun Anda. Jika kelas dilewatkan tanpa pembatalan (No-Show) atau dibatalkan kurang dari H-24, sesi dianggap terpakai sesuai aturan studio.',
  },
  {
    question: 'Berapa lama masa berlaku paket Pilates saya?',
    audience: 'customer',
    answer:
      'Masa berlaku paket bervariasi mulai dari 30 hari hingga 180 hari sejak tanggal pembelian disahkan oleh tim studio. Anda dapat memeriksa tanggal kedaluwarsa persis di menu "Paket Saya" (/account/packages).',
  },
  {
    question: 'Mengapa menu manajemen studio saya tidak muncul di navigasi?',
    audience: 'admin',
    answer:
      'Staf Meja Depan (Front Desk) memiliki 4 menu utama: Hari Ini (/workspace), Timetable (/workspace/classes), Booking (/workspace/bookings), dan Kasir Kas (/workspace/kas). Menu lanjutan hanya terbuka bila akun Anda diberi peran Manager, Finance, atau Super Owner dan telah memilih Cabang Aktif di bilah atas.',
  },
  {
    question: 'Apa yang harus dilakukan jika staf kasir salah mencatat nominal penjualan tunai?',
    audience: 'admin',
    answer:
      'Transaksi yang belum disetujui dapat ditolak oleh tim Finance/Manager dengan alasan AMOUNT_MISMATCH, lalu staf meja depan mencatat ulang transaksi dengan nominal yang benar.',
  },
  {
    question: 'Bagaimana cara menambahkan porsi pembagian hasil cabang untuk Owner baru?',
    audience: 'super-admin',
    answer:
      'Super Owner dapat membuka menu Jurnal Kas atau Cabang, lalu memasukkan persentase porsi laba per cabang dalam basis poin (total seluruh owner cabang wajib tepat 100% atau 10.000 basis poin). Perubahan otomatis tercatat di Audit Log.',
  },
];
