/**
 * Syarat & Ketentuan Daily Dose Pilates: satu sumber teks untuk halaman /terms, layar persetujuan
 * akun, dan ringkasan di checkout. Versi harus sama dengan `VERSI_SYARAT` di API
 * (apps/api/src/identity/persetujuan-syarat.ts); setiap perubahan isi wajib menaikkan keduanya supaya
 * member diminta menyetujui ulang.
 */
export const VERSI_SYARAT = '2026-11-25';
export const BERLAKU_SEJAK = '25 November 2026';

export interface PasalSyarat {
  id: string;
  judul: string;
  butir: readonly string[];
}

export const PASAL_SYARAT: readonly PasalSyarat[] = [
  {
    id: 'definisi',
    judul: '1. Definisi',
    butir: [
      '"Studio" adalah Daily Dose Pilates beserta seluruh cabangnya, manajemen, dan staf yang bertindak atas nama Studio.',
      '"Member" adalah setiap orang yang mendaftar akun, membeli paket, memesan kelas, atau menggunakan fasilitas Studio.',
      '"Paket" adalah hak menggunakan sejumlah sesi kelas untuk jenis kelas dan cabang tertentu, dalam Masa Berlaku tertentu, sebagaimana tertera saat pembelian.',
      '"Masa Berlaku" adalah rentang waktu sejak Paket aktif sampai tanggal berakhir yang tertera di akun Member. Lamanya berbeda untuk tiap Paket, sesuai Paket yang dibeli. Paket berakhir pukul 23.59 WIB pada tanggal berakhir.',
      '"Perpanjangan" adalah pembelian paket perpanjangan untuk menambah Masa Berlaku Paket yang sudah ada. Lamanya tambahan sesuai paket perpanjangan yang dibeli.',
      '"Ganti Jadwal" adalah memindahkan pemesanan ke kelas lain. "Pindah Sesi" adalah memindahkan pemesanan ke jam lain pada hari yang sama.',
      '"Aplikasi" adalah situs dan aplikasi Daily Dose yang dipakai untuk mendaftar, membeli Paket, memesan kelas, menerima QR, dan check-in.',
    ],
  },
  {
    id: 'persetujuan',
    judul: '2. Persetujuan dan Perubahan Syarat',
    butir: [
      'Dengan mencentang persetujuan saat mendaftar atau saat membeli Paket atau Perpanjangan, Member menyatakan telah membaca, memahami, dan menyetujui seluruh Syarat & Ketentuan ini.',
      'Persetujuan Member dicatat secara elektronik di sistem Studio (tanggal, jam, versi syarat, dan pesanan terkait) dan dapat digunakan sebagai bukti. Untuk pembelian yang dicatat staf di studio, staf menyampaikan syarat ini kepada Member dan persetujuannya dicatat atas nama staf tersebut.',
      'Studio dapat memperbarui Syarat & Ketentuan ini. Versi terbaru ditampilkan di Aplikasi dan Member diminta menyetujuinya kembali sebelum dapat membeli Paket atau memesan kelas.',
      'Perubahan harga, batas waktu (misalnya batas pembatalan, pemesanan, atau jendela perpanjangan), dan aturan lain tidak berlaku surut untuk Paket yang sudah dibayar sebelum perubahan tersebut.',
      'Bila Member tidak menyetujui versi terbaru, Member dapat berhenti menggunakan layanan. Paket yang sedang berjalan tetap tunduk pada ketentuan Masa Berlaku dan hangus sebagaimana diatur di bawah.',
    ],
  },
  {
    id: 'akun',
    judul: '3. Akun Member dan Verifikasi Wajah',
    butir: [
      'Member wajib memberikan data yang benar dan terbaru: nama lengkap, nomor WhatsApp aktif, email, dan foto selfie yang menunjukkan wajah dengan jelas. Member yang mendaftar lewat akun Google wajib melengkapi nomor WhatsApp dan foto selfie sebelum membeli Paket atau memesan kelas.',
      'Foto selfie wajib ada sebelum Member dapat membeli Paket atau memesan kelas. Studio berhak menolak foto yang tidak jelas dan meminta Member mengambil ulang.',
      'Satu akun hanya untuk satu orang. Akun, Paket, dan sesi tidak boleh dipinjamkan, dijual kembali, atau dipakai bersama, kecuali kursi teman pada Paket yang secara tegas menyediakannya.',
      'Staf mencocokkan wajah Member dengan foto akun saat check-in. Studio berhak menolak masuk kelas bila wajah tidak sesuai, dan sesi tetap dianggap terpakai.',
      'Member bertanggung jawab menjaga kerahasiaan kata sandi dan QR kehadiran. Semua aktivitas melalui akun Member dianggap dilakukan oleh Member.',
      'Studio berhak menangguhkan, membatasi, menonaktifkan, atau menutup akun yang terindikasi memberikan data palsu, menyalahgunakan Paket, melanggar aturan studio, atau merugikan Studio maupun member lain.',
    ],
  },
  {
    id: 'pembelian',
    judul: '4. Pembelian dan Pembayaran Paket',
    butir: [
      'Harga, jumlah sesi, jenis kelas, cabang tempat Paket berlaku, dan Masa Berlaku setiap Paket adalah yang tertera di Aplikasi pada saat pembelian. Paket hanya dapat dipakai untuk jenis kelas dan cabang yang tertera, kecuali Paket tersebut dinyatakan berlaku di beberapa cabang.',
      'Studio dapat mengubah harga, isi, dan Masa Berlaku Paket untuk pembelian berikutnya kapan saja. Perubahan tidak berlaku surut untuk Paket yang sudah dibayar.',
      'Pembayaran dilakukan melalui transfer bank, QRIS, tunai di studio, atau metode lain yang disediakan Studio, tepat sesuai nominal yang ditampilkan termasuk kode unik bila ada. Kode unik dipakai untuk mencocokkan transfer dan tidak dikembalikan.',
      'Pesanan wajib dibayar dan bukti bayar diunggah dalam 24 jam (atau batas lain yang ditampilkan). Pesanan yang lewat batas dapat dibatalkan otomatis, dan harga atau promo dapat berubah bila Member memesan ulang.',
      'Paket baru aktif setelah pembayaran diverifikasi, baik otomatis oleh sistem maupun oleh staf. Studio berhak menunda atau menolak pembayaran yang bukti transfernya tidak jelas, tidak sesuai nominal atau rekening tujuan, atau terindikasi tidak sah.',
      'Pembayaran tunai atau penjualan yang dicatat staf di studio baru sah setelah disetujui penanggung jawab Studio.',
      'Promo dan voucher hanya berlaku sesuai ketentuan masing-masing (periode, kuota, paket, dan cabang), tidak dapat digabung kecuali dinyatakan, tidak dapat ditukar uang, dan dapat dihentikan Studio sewaktu-waktu.',
      'Bukti pembayaran yang dipalsukan atau dimanipulasi mengakibatkan Paket dibatalkan tanpa pengembalian dana, akun ditutup, dan Studio berhak menempuh jalur hukum.',
    ],
  },
  {
    id: 'masa-berlaku',
    judul: '5. Masa Berlaku dan Paket Hangus',
    butir: [
      'Masa Berlaku setiap Paket berbeda-beda, sesuai Paket yang dibeli dan sebagaimana tertera saat pembelian (misalnya 30, 60, atau 90 hari). Tanggal berakhir dapat dilihat di akun Member. Member wajib memantau sendiri sisa sesi dan tanggal berakhir Paketnya.',
      'Setelah Masa Berlaku berakhir, seluruh sisa sesi pada Paket tersebut HANGUS secara otomatis, tidak dapat digunakan, tidak dapat dipindahkan, tidak dapat ditukar dengan Paket lain, dan tidak dapat diuangkan.',
      'Dengan membeli Paket, Member menyatakan sudah mengetahui Masa Berlaku Paket yang dibelinya dan menyetujui bahwa Paket akan hangus sesuai Masa Berlaku tersebut.',
      'Sesi yang sudah dipesan untuk kelas setelah tanggal berakhir Paket tidak dapat dipakai bila Paket sudah hangus.',
      'Pengingat masa berlaku yang dikirim Studio lewat WhatsApp atau Aplikasi hanya bersifat bantuan. Tidak diterimanya pengingat, karena alasan apa pun, tidak menunda atau membatalkan hangusnya Paket.',
      'Masa Berlaku tetap berjalan selama Member sakit, bepergian, cuti, atau berhalangan karena alasan pribadi apa pun, kecuali Studio secara tertulis menyetujui pembekuan Paket.',
      'Pembekuan Paket hanya dapat diberikan atas kebijakan Studio, misalnya karena kondisi medis dengan surat dokter. Studio berhak menolak permohonan pembekuan, menentukan lamanya, dan membuka kembali Paket tanpa wajib memberikan alasan.',
    ],
  },
  {
    id: 'perpanjangan',
    judul: '6. Perpanjangan Masa Berlaku (Renewal)',
    butir: [
      'Perpanjangan masa berlaku adalah layanan berbayar, bukan hak Member, dan hanya tersedia selama Studio menyediakannya.',
      'Setiap Paket HANYA DAPAT DIPERPANJANG MAKSIMAL 3 (TIGA) KALI. Perpanjangan yang masih menunggu pembayaran atau persetujuan ikut dihitung. Setelah 3 kali perpanjangan, Paket tidak dapat diperpanjang lagi dengan cara apa pun dan sisa sesinya hangus pada tanggal berakhir terakhir.',
      'Lama tambahan masa berlaku sesuai paket perpanjangan yang dibeli dan tertera saat pembelian (misalnya 30 hari), dihitung dari tanggal berakhir Paket saat itu, bukan dari hari pembelian. Harga mengikuti yang berlaku di Aplikasi saat perpanjangan dibeli.',
      'Perpanjangan hanya dapat dibeli untuk Paket yang masih aktif, masih memiliki sisa sesi, dan sudah mendekati tanggal berakhir (dalam 14 hari terakhir, atau jendela lain yang ditampilkan di Aplikasi).',
      'Paket yang sudah berakhir tetapi masih memiliki sisa sesi hanya dapat diperpanjang atas kebijakan Studio melalui staf, dengan pembayaran dan bukti bayar. Masa berlaku tambahan dihitung dari hari perpanjangan disetujui, dan tetap dihitung dalam batas 3 kali. Studio tidak wajib menyetujuinya.',
      'Perpanjangan tidak menambah jumlah sesi. Perpanjangan baru berlaku setelah pembayarannya disetujui, dan yang sudah dibayar tidak dapat dibatalkan atau dikembalikan.',
    ],
  },
  {
    id: 'hak-studio',
    judul: '7. Hak Studio atas Paket dan Akun',
    butir: [
      'Studio berhak sewaktu-waktu memotong sesi, membekukan, membatasi, atau membatalkan Paket Member, termasuk namun tidak terbatas pada keadaan berikut: pelanggaran Syarat & Ketentuan atau aturan studio, penyalahgunaan Paket atau akun, pembayaran yang tidak sah atau dibatalkan, ketidakhadiran (no-show), pembatalan terlambat, serta kesalahan sistem atau pencatatan.',
      'Bila Studio menghentikan atau membatalkan Paket bukan karena kesalahan Member, Studio akan menyelesaikannya dengan Member secara wajar, misalnya dengan memindahkan sisa sesi ke Paket atau cabang lain, menyesuaikan Masa Berlaku, atau cara lain yang ditetapkan Studio.',
      'Pemotongan sesi karena no-show, pembatalan terlambat, atau pelanggaran dilakukan otomatis oleh sistem atau oleh staf dan dicatat di riwayat Paket Member.',
      'Bila terjadi kesalahan pencatatan sesi, pembayaran, atau masa berlaku (misalnya sesi terkredit ganda), Studio berhak mengoreksinya kapan pun tanpa persetujuan Member terlebih dahulu.',
      'Studio berhak mengubah jadwal, instruktur, ruangan, kapasitas, atau jenis kelas, serta membatalkan kelas, misalnya karena kuota minimum peserta tidak terpenuhi atau keadaan lain. Bila kelas dibatalkan oleh Studio, sesi dikembalikan ke Paket.',
      'Bila kuota minimum tidak terpenuhi, Studio dapat memutuskan kelas tetap berjalan atau dibatalkan, termasuk sesaat sebelum kelas dimulai.',
      'Studio berhak menolak memberikan layanan kepada siapa pun yang berperilaku tidak pantas, membahayakan, atau mengganggu member lain dan staf, dengan sesi tetap dianggap terpakai.',
    ],
  },
  {
    id: 'booking',
    judul: '8. Pemesanan Kelas',
    butir: [
      'Kelas hanya dapat dipesan melalui Aplikasi atau staf, selama kuota tersedia, pemesanan belum ditutup, dan Paket aktif masih memiliki sesi untuk jenis kelas dan cabang tersebut. Pemesanan ditutup beberapa jam sebelum kelas dimulai sesuai batas yang ditampilkan di Aplikasi.',
      'Satu sesi terpakai untuk setiap pemesanan kelas. Pada Paket dengan kursi teman, setiap kursi teman memakai satu sesi tambahan dari Paket Member, dan Member bertanggung jawab atas teman yang dibawanya.',
      'Pemesanan bersifat pribadi dan tidak dapat dialihkan kepada orang lain.',
      'Studio tidak menjamin ketersediaan kelas, jam, cabang, atau instruktur tertentu selama Masa Berlaku Paket. Penuhnya kelas tidak menjadi alasan perpanjangan, kompensasi, atau pengembalian dana.',
    ],
  },
  {
    id: 'pembatalan',
    judul: '9. Pembatalan, Ganti Jadwal, Pindah Sesi, dan No-show',
    butir: [
      'Pembatalan, Ganti Jadwal, dan Pindah Sesi wajib diajukan PALING LAMBAT 12 JAM SEBELUM KELAS DIMULAI (H-12 jam), atau batas lain yang ditampilkan di Aplikasi. Pembatalan tepat waktu mengembalikan sesi ke Paket.',
      'Ganti Jadwal dan Pindah Sesi bukan hak Member. Keduanya bergantung pada kondisi di lapangan, termasuk ketersediaan kursi, jadwal instruktur, dan kebijakan cabang, dan baru berlaku setelah disetujui Studio. Studio berhak menolak tanpa wajib memberikan alasan.',
      'Permintaan Ganti Jadwal yang belum diputuskan sampai kelas asal atau kelas tujuan dimulai ditutup otomatis, dan pemesanan asal tetap berlaku sehingga Member wajib hadir di kelas asal atau sesi terpotong.',
      'Pembatalan, Ganti Jadwal, atau Pindah Sesi kurang dari 12 jam sebelum kelas dianggap terlambat: sesi terpotong. Member dapat mengajukan pengecualian dengan alasan dan bukti (misalnya surat dokter untuk izin medis). Keputusan ada pada Studio dan bersifat final.',
      'Pengajuan pengecualian yang tidak diputuskan sebelum kelas selesai dapat ditutup otomatis. Bila pengajuan ditolak untuk kelas yang sudah lewat, Member dicatat hadir atau tidak hadir sesuai catatan, dan sesi terpotong.',
      'Member yang tidak hadir tanpa pembatalan (no-show) atau tidak tercatat hadir dianggap telah menggunakan sesinya dan sesi terpotong. Kelas yang tidak memiliki catatan kehadiran diselesaikan otomatis oleh sistem paling lambat 24 jam setelah kelas berakhir.',
      'Member yang terlambat lebih dari 10 menit dapat ditolak mengikuti kelas demi keselamatan dan kenyamanan peserta lain, dan sesi tetap terpotong.',
    ],
  },
  {
    id: 'check-in',
    judul: '10. Check-in dan Kehadiran',
    butir: [
      'Kehadiran dicatat dengan memindai QR Member di studio, paling cepat 45 menit sebelum kelas dimulai, atau dicatat manual oleh staf bila Member tidak dapat menunjukkan QR. QR dapat dikirim Studio ke WhatsApp Member.',
      'QR hanya berlaku untuk kelas yang dipesan di cabang dan jam tersebut. QR tidak boleh dibagikan kepada orang lain.',
      'Catatan kehadiran di sistem Studio digunakan sebagai dasar pencatatan penggunaan sesi.',
      'Member wajib hadir 10 sampai 15 menit sebelum kelas untuk persiapan.',
    ],
  },
  {
    id: 'refund',
    judul: '11. Tidak Ada Pengembalian Dana (Non-refundable)',
    butir: [
      'Semua pembayaran Paket, Perpanjangan, dan layanan lain bersifat final dan tidak dapat dikembalikan, dialihkan, atau ditukar, termasuk untuk sesi yang tidak terpakai atau Paket yang hangus, kecuali Studio tidak dapat lagi menyediakan layanan yang dibeli (misalnya cabang tutup permanen dan tidak ada cabang pengganti).',
      'Pengecualian lain hanya dapat diberikan atas kebijakan penuh manajemen Studio. Bila disetujui, pengembalian dihitung prorata dari harga yang dibayar (setelah promo atau voucher, tanpa kode unik) untuk sisa sesi, dapat dikurangi biaya administrasi, ditransfer ke rekening atas nama yang diberikan Member, dan Paket dinolkan. Studio menerbitkan surat konfirmasi refund.',
      'Pemindahan Paket atau pembelian ke member lain hanya dapat dilakukan oleh Studio atas permohonan Member dan persetujuan manajemen.',
    ],
  },
  {
    id: 'kesehatan',
    judul: '12. Kesehatan, Risiko, dan Keselamatan',
    butir: [
      'Member menyatakan dalam kondisi sehat dan layak berolahraga. Member wajib memberi tahu instruktur sebelum kelas tentang cedera, kondisi medis, kehamilan, atau operasi yang pernah dijalani, dan disarankan berkonsultasi dengan dokter.',
      'Member memahami bahwa latihan Pilates, termasuk penggunaan reformer dan alat lain, memiliki risiko cedera, dan mengikuti kelas atas kesadaran dan risiko sendiri.',
      'Studio, instruktur, dan staf tidak bertanggung jawab atas cedera, sakit, atau kerugian yang timbul karena kondisi kesehatan yang tidak diberitahukan, tidak mengikuti arahan instruktur, atau kelalaian Member sendiri, kecuali yang disebabkan oleh kelalaian Studio.',
      'Instruktur berhak memodifikasi gerakan, membatasi penggunaan alat, atau meminta Member berhenti atau tidak mengikuti kelas demi keselamatan. Penggunaan sesi dalam keadaan ini mengikuti kebijakan Studio.',
      'Member wajib memakai kaus kaki anti-slip (grip socks) di area latihan dan mengikuti aturan kebersihan studio.',
    ],
  },
  {
    id: 'tata-tertib',
    judul: '13. Tata Tertib Studio',
    butir: [
      'Member wajib menjaga sikap, kebersihan, dan ketenangan selama di studio, serta menghormati member lain, instruktur, dan staf.',
      'Kerusakan alat atau fasilitas karena kelalaian atau kesengajaan Member menjadi tanggung jawab Member dan wajib diganti sesuai nilai perbaikan atau penggantian.',
      'Studio tidak menyediakan layanan penitipan barang. Member diharapkan menjaga sendiri barang pribadinya selama di studio.',
      'Merekam video atau mengambil foto member lain dan instruktur tanpa izin tidak diperbolehkan.',
      'Minuman dan barang lain yang dijual di studio dibayar terpisah dan tidak termasuk dalam Paket.',
    ],
  },
  {
    id: 'dokumentasi',
    judul: '14. Foto, Video, Ulasan, dan Komunikasi',
    butir: [
      'Studio dapat mengambil foto atau video suasana kelas untuk dokumentasi internal. Wajah Member hanya ditampilkan dalam materi promosi bila Member memberikan persetujuan terpisah (pilihan, tidak wajib). Persetujuan ini dapat ditarik kapan saja dengan memberi tahu Studio.',
      'Ulasan dan penilaian yang diberikan Member tentang kelas atau instruktur dapat dipakai Studio untuk evaluasi internal.',
      'Member setuju menerima pesan WhatsApp, email, dan notifikasi Aplikasi dari Studio terkait QR kehadiran, pengingat kelas, masa berlaku Paket, dan tagihan. Informasi promo hanya dikirim bila Member memberikan persetujuan terpisah (pilihan, tidak wajib), yang dapat ditarik kapan saja.',
    ],
  },
  {
    id: 'data',
    judul: '15. Data Pribadi',
    butir: [
      'Studio mengumpulkan dan menyimpan data Member (nama, nomor WhatsApp, email, foto selfie, bukti pembayaran, riwayat pembelian, pemesanan, dan kehadiran) untuk menjalankan layanan, keamanan, dan pencatatan keuangan, sebagaimana dijelaskan di Kebijakan Privasi.',
      'Foto selfie dipakai untuk mencocokkan wajah saat check-in dan mencegah penyalahgunaan Paket, hanya dapat dilihat staf Studio yang bertugas, tidak ditampilkan kepada member lain, dan disimpan selama akun aktif serta selama diperlukan untuk pencatatan.',
    ],
  },
  {
    id: 'batas-tanggung-jawab',
    judul: '16. Batas Tanggung Jawab dan Keadaan Kahar',
    butir: [
      'Tanggung jawab Studio terbatas pada hal yang berkaitan langsung dengan layanan yang dibeli Member, dan diselesaikan secara wajar sesuai ketentuan yang berlaku.',
      'Studio tidak bertanggung jawab atas gangguan layanan karena keadaan di luar kendali Studio, termasuk bencana alam, wabah, kebijakan pemerintah, pemadaman listrik, gangguan internet, gangguan WhatsApp, atau gangguan Aplikasi. Dalam keadaan tersebut Studio akan menyesuaikan jadwal atau Masa Berlaku secara wajar.',
    ],
  },
  {
    id: 'hukum',
    judul: '17. Hukum yang Berlaku dan Penyelesaian Sengketa',
    butir: [
      'Syarat & Ketentuan ini tunduk pada hukum Republik Indonesia.',
      'Setiap perselisihan diselesaikan terlebih dahulu secara musyawarah dengan manajemen Studio. Catatan sistem Studio (pembayaran, persetujuan, pemesanan, pembatalan, dan kehadiran) menjadi salah satu dasar dalam penyelesaiannya.',
      'Bila satu ketentuan dinyatakan tidak berlaku, ketentuan lainnya tetap berlaku sepenuhnya.',
    ],
  },
];

/** Poin yang wajib dibaca sebelum membeli; ditampilkan di checkout di atas centang persetujuan. */
export function ringkasanPembelian(
  input: { masaBerlakuHari?: number | null; perpanjangan?: boolean; hariPerpanjangan?: number | null } = {},
): string[] {
  if (input.perpanjangan) {
    const tambah = input.hariPerpanjangan ? `${input.hariPerpanjangan} hari` : 'sesuai paket perpanjangan yang dibeli';
    return [
      `Perpanjangan menambah masa berlaku ${tambah} dari tanggal berakhir saat ini, tanpa menambah sesi, setelah pembayaran disetujui.`,
      'Setiap paket maksimal 3 kali perpanjangan (termasuk yang masih menunggu). Setelah itu tidak bisa diperpanjang lagi dan sisa sesi hangus saat masa berlaku habis.',
      'Pembayaran perpanjangan final dan tidak dapat dikembalikan.',
    ];
  }
  const hari = input.masaBerlakuHari ? `${input.masaBerlakuHari} hari` : 'sesuai paket yang dibeli';
  return [
    `Masa berlaku paket ini ${hari} sejak aktif. Setelah lewat, sisa sesi hangus otomatis dan tidak bisa diuangkan.`,
    'Perpanjangan masa berlaku berbayar, lamanya sesuai paket perpanjangan yang dibeli, dan maksimal 3 kali per paket.',
    'Batal, ganti jadwal, atau pindah sesi paling lambat 12 jam sebelum kelas dan tergantung kondisi di lapangan. Lewat dari itu, atau tidak hadir, sesi tetap terpotong.',
    'Bayar dalam 24 jam. Pembayaran final dan tidak dapat dikembalikan. Studio berhak memotong, membekukan, atau membatalkan paket sesuai Syarat & Ketentuan.',
  ];
}
