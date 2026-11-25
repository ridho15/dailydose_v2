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
      '"Paket" adalah hak menggunakan sejumlah sesi kelas dalam masa berlaku tertentu, sebagaimana tertera saat pembelian.',
      '"Masa Berlaku" adalah rentang waktu sejak Paket aktif sampai tanggal berakhir yang tertera di akun Member. Paket berakhir pada pukul 23.59 WIB di tanggal berakhir.',
      '"Perpanjangan" adalah pembelian tambahan masa berlaku untuk Paket yang sudah ada.',
      '"Aplikasi" adalah situs dan aplikasi Daily Dose yang dipakai untuk mendaftar, membeli Paket, memesan kelas, dan check-in.',
    ],
  },
  {
    id: 'persetujuan',
    judul: '2. Persetujuan dan Perubahan Syarat',
    butir: [
      'Dengan mencentang persetujuan saat mendaftar, saat membeli Paket, atau dengan tetap menggunakan layanan Studio, Member menyatakan telah membaca, memahami, dan menyetujui seluruh Syarat & Ketentuan ini.',
      'Persetujuan Member dicatat secara elektronik di sistem Studio (tanggal, jam, dan versi syarat) dan berlaku sebagai bukti yang sah.',
      'Studio dapat memperbarui Syarat & Ketentuan ini. Versi terbaru ditampilkan di Aplikasi dan Member akan diminta menyetujuinya kembali sebelum dapat melanjutkan pembelian atau pemesanan.',
      'Bila Member tidak menyetujui versi terbaru, Member dapat berhenti menggunakan layanan. Paket yang sedang berjalan tetap tunduk pada ketentuan Masa Berlaku dan hangus sebagaimana diatur di bawah.',
    ],
  },
  {
    id: 'akun',
    judul: '3. Akun Member',
    butir: [
      'Member wajib memberikan data yang benar dan terbaru: nama lengkap, nomor WhatsApp aktif, email, dan foto selfie yang menunjukkan wajah dengan jelas.',
      'Satu akun hanya untuk satu orang. Akun, Paket, dan sesi tidak boleh dipinjamkan, dijual kembali, atau dipakai bersama, kecuali fitur "bawa teman" pada Paket yang secara tegas menyediakannya.',
      'Foto selfie dipakai staf untuk mencocokkan wajah saat check-in. Studio berhak menolak masuk kelas bila wajah tidak sesuai dengan foto akun, dan sesi tetap dianggap terpakai.',
      'Member bertanggung jawab menjaga kerahasiaan kata sandi dan QR kehadiran. Semua aktivitas melalui akun Member dianggap dilakukan oleh Member.',
      'Studio berhak menangguhkan, membatasi, atau menutup akun yang terindikasi memberikan data palsu, menyalahgunakan Paket, melanggar aturan studio, atau merugikan Studio maupun member lain.',
    ],
  },
  {
    id: 'pembelian',
    judul: '4. Pembelian dan Pembayaran Paket',
    butir: [
      'Harga, jumlah sesi, jenis kelas, dan Masa Berlaku setiap Paket adalah yang tertera di Aplikasi pada saat pembelian. Studio dapat mengubah harga dan isi Paket untuk pembelian berikutnya kapan saja.',
      'Pembayaran dilakukan melalui transfer bank, QRIS, atau metode lain yang disediakan Studio, sesuai nominal yang ditampilkan termasuk kode unik bila ada.',
      'Pesanan yang tidak dibayar dalam batas waktu yang ditampilkan dapat dibatalkan otomatis.',
      'Paket baru aktif setelah pembayaran diverifikasi Studio. Studio berhak menolak pembayaran yang bukti transfernya tidak jelas, tidak sesuai nominal, atau terindikasi tidak sah.',
      'Promo dan voucher hanya berlaku sesuai ketentuan masing-masing, tidak dapat digabung kecuali dinyatakan, tidak dapat ditukar uang, dan dapat dihentikan Studio sewaktu-waktu.',
      'Bukti pembayaran yang dipalsukan atau dimanipulasi mengakibatkan Paket dibatalkan tanpa pengembalian dana, akun ditutup, dan Studio berhak menempuh jalur hukum.',
    ],
  },
  {
    id: 'masa-berlaku',
    judul: '5. Masa Berlaku dan Paket Hangus',
    butir: [
      'Setiap Paket memiliki Masa Berlaku yang tertera saat pembelian dan dapat dilihat di akun Member. Member wajib memantau sendiri sisa sesi dan tanggal berakhir Paketnya.',
      'Setelah Masa Berlaku berakhir, seluruh sisa sesi pada Paket tersebut HANGUS secara otomatis, tidak dapat digunakan, tidak dapat dipindahkan, tidak dapat ditukar dengan Paket lain, dan tidak dapat diuangkan.',
      'Dengan membeli Paket, Member menyetujui bahwa Paket akan hangus sesuai Masa Berlaku yang berlaku, tanpa kewajiban Studio untuk memberikan kompensasi apa pun.',
      'Pengingat masa berlaku yang dikirim Studio lewat WhatsApp atau Aplikasi hanya bersifat bantuan. Tidak diterimanya pengingat, karena alasan apa pun, tidak menunda atau membatalkan hangusnya Paket.',
      'Masa Berlaku tetap berjalan selama Member sakit, bepergian, cuti, atau berhalangan karena alasan pribadi apa pun, kecuali Studio secara tertulis menyetujui pembekuan Paket.',
      'Pembekuan Paket hanya dapat diberikan atas kebijakan Studio, misalnya karena kondisi medis dengan surat dokter. Studio berhak menolak permohonan pembekuan tanpa wajib memberikan alasan.',
    ],
  },
  {
    id: 'perpanjangan',
    judul: '6. Perpanjangan Masa Berlaku (Renewal)',
    butir: [
      'Perpanjangan masa berlaku adalah layanan berbayar, bukan hak Member, dan hanya tersedia selama Studio menyediakannya.',
      'Setiap Paket HANYA DAPAT DIPERPANJANG MAKSIMAL 3 (TIGA) KALI. Setelah 3 kali perpanjangan, Paket tidak dapat diperpanjang lagi dengan cara apa pun dan sisa sesinya hangus pada tanggal berakhir terakhir.',
      'Setiap perpanjangan menambah 30 hari dari tanggal berakhir saat itu, dengan harga yang berlaku di Aplikasi pada saat perpanjangan dibeli.',
      'Perpanjangan hanya dapat dibeli untuk Paket yang masih aktif dan masih memiliki sisa sesi. Perpanjangan untuk Paket yang sudah berakhir hanya dapat diberikan atas kebijakan Studio melalui staf, dengan pembayaran dan bukti bayar, dan tetap dihitung dalam batas 3 kali.',
      'Perpanjangan tidak menambah jumlah sesi. Perpanjangan yang sudah dibayar tidak dapat dibatalkan atau dikembalikan.',
    ],
  },
  {
    id: 'hak-studio',
    judul: '7. Hak Studio atas Paket dan Akun',
    butir: [
      'Studio berhak sewaktu-waktu memotong sesi, membekukan, membatasi, atau membatalkan Paket Member, termasuk namun tidak terbatas pada keadaan berikut: pelanggaran Syarat & Ketentuan atau aturan studio, penyalahgunaan Paket atau akun, pembayaran yang tidak sah atau dibatalkan, ketidakhadiran (no-show), pembatalan terlambat, kesalahan sistem atau pencatatan, serta keputusan operasional Studio.',
      'Pemotongan sesi karena no-show, pembatalan terlambat, atau pelanggaran dilakukan otomatis oleh sistem atau oleh staf dan dicatat di riwayat Paket Member.',
      'Bila terjadi kesalahan pencatatan sesi atau masa berlaku (misalnya sesi terkredit ganda), Studio berhak mengoreksinya kapan pun tanpa persetujuan Member terlebih dahulu.',
      'Studio berhak mengubah jadwal, instruktur, studio, kapasitas, atau jenis kelas, serta membatalkan kelas karena kuota minimum tidak terpenuhi atau keadaan lain. Bila kelas dibatalkan oleh Studio, sesi dikembalikan ke Paket dan hal ini merupakan satu-satunya bentuk kompensasi.',
      'Studio berhak menolak memberikan layanan kepada siapa pun yang berperilaku tidak pantas, membahayakan, atau mengganggu member lain dan staf, dengan sesi tetap dianggap terpakai.',
    ],
  },
  {
    id: 'booking',
    judul: '8. Pemesanan Kelas',
    butir: [
      'Kelas hanya dapat dipesan melalui Aplikasi atau staf, selama kuota tersedia dan Paket aktif masih memiliki sesi untuk jenis kelas tersebut.',
      'Satu sesi terpakai untuk setiap pemesanan kelas, termasuk kursi teman pada Paket yang menyediakannya.',
      'Pemesanan bersifat pribadi dan tidak dapat dialihkan kepada orang lain.',
      'Studio tidak menjamin ketersediaan kelas, jam, atau instruktur tertentu selama Masa Berlaku Paket. Penuhnya kelas tidak menjadi alasan perpanjangan atau pengembalian dana.',
    ],
  },
  {
    id: 'pembatalan',
    judul: '9. Pembatalan, Ganti Jadwal, dan No-show',
    butir: [
      'Pembatalan atau ganti jadwal paling lambat 12 jam sebelum kelas dimulai (atau batas lain yang ditampilkan di Aplikasi) mengembalikan sesi ke Paket.',
      'Pembatalan atau ganti jadwal kurang dari 12 jam sebelum kelas dianggap pembatalan terlambat: sesi terpotong, kecuali Studio menyetujui pengajuan Member. Studio dapat meminta bukti, misalnya surat dokter, dan keputusan Studio bersifat final.',
      'Member yang tidak hadir tanpa pembatalan (no-show), atau tidak memindai QR kehadiran, dianggap telah menggunakan sesinya dan sesi terpotong.',
      'Member yang terlambat lebih dari 10 menit dapat ditolak mengikuti kelas demi keselamatan dan kenyamanan peserta lain, dan sesi tetap terpotong.',
      'Pengajuan pembatalan terlambat yang tidak diputuskan sebelum kelas selesai dapat ditutup otomatis, dan sesi diperlakukan sesuai catatan kehadiran.',
    ],
  },
  {
    id: 'check-in',
    judul: '10. Check-in dan Kehadiran',
    butir: [
      'Kehadiran dicatat dengan memindai QR Member di studio, paling cepat 45 menit sebelum kelas dimulai, atau dicatat manual oleh staf.',
      'Catatan kehadiran di sistem Studio menjadi acuan resmi penggunaan sesi.',
      'Member wajib hadir 10 sampai 15 menit sebelum kelas untuk persiapan.',
    ],
  },
  {
    id: 'refund',
    judul: '11. Tidak Ada Pengembalian Dana (Non-refundable)',
    butir: [
      'Semua pembayaran Paket, Perpanjangan, dan layanan lain bersifat final dan tidak dapat dikembalikan, dialihkan, atau ditukar, termasuk untuk sesi yang tidak terpakai atau Paket yang hangus.',
      'Pengecualian hanya dapat diberikan atas kebijakan penuh manajemen Studio dan secara tertulis. Bila disetujui, pengembalian dihitung prorata dari harga yang dibayar untuk sisa sesi, dapat dikurangi biaya administrasi, dan Paket dinolkan.',
      'Pemindahan Paket ke member lain hanya dapat dilakukan oleh Studio atas permohonan Member dan persetujuan manajemen.',
    ],
  },
  {
    id: 'kesehatan',
    judul: '12. Kesehatan, Risiko, dan Keselamatan',
    butir: [
      'Member menyatakan dalam kondisi sehat dan layak berolahraga. Member wajib memberi tahu instruktur sebelum kelas tentang cedera, kondisi medis, kehamilan, atau operasi yang pernah dijalani, dan disarankan berkonsultasi dengan dokter.',
      'Member memahami bahwa latihan Pilates, termasuk penggunaan reformer dan alat lain, memiliki risiko cedera, dan mengikuti kelas atas kesadaran dan risiko sendiri.',
      'Sepanjang diizinkan hukum, Studio, instruktur, dan staf tidak bertanggung jawab atas cedera, sakit, atau kerugian yang timbul karena kondisi kesehatan yang tidak diberitahukan, tidak mengikuti arahan instruktur, atau kelalaian Member sendiri.',
      'Instruktur berhak memodifikasi gerakan, membatasi penggunaan alat, atau meminta Member berhenti atau tidak mengikuti kelas demi keselamatan, dengan sesi tetap terpotong.',
      'Member wajib memakai kaus kaki anti-slip (grip socks) di area latihan dan mengikuti aturan kebersihan studio.',
    ],
  },
  {
    id: 'tata-tertib',
    judul: '13. Tata Tertib Studio',
    butir: [
      'Member wajib menjaga sikap, kebersihan, dan ketenangan selama di studio, serta menghormati member lain, instruktur, dan staf.',
      'Kerusakan alat atau fasilitas karena kelalaian atau kesengajaan Member menjadi tanggung jawab Member dan wajib diganti sesuai nilai perbaikan atau penggantian.',
      'Studio tidak bertanggung jawab atas kehilangan atau kerusakan barang pribadi di area studio.',
      'Merekam video atau mengambil foto member lain dan instruktur tanpa izin tidak diperbolehkan.',
    ],
  },
  {
    id: 'dokumentasi',
    judul: '14. Foto, Video, dan Komunikasi',
    butir: [
      'Studio dapat mengambil foto atau video suasana kelas untuk keperluan dokumentasi dan promosi. Member yang tidak berkenan tampil wajib memberi tahu staf sebelum kelas dimulai.',
      'Member setuju menerima pesan WhatsApp, email, dan notifikasi Aplikasi dari Studio terkait QR kehadiran, pengingat kelas, masa berlaku Paket, tagihan, dan informasi promo.',
    ],
  },
  {
    id: 'data',
    judul: '15. Data Pribadi',
    butir: [
      'Studio mengumpulkan dan menyimpan data Member (nama, nomor WhatsApp, email, foto selfie, riwayat pembelian, dan kehadiran) untuk menjalankan layanan, keamanan, dan pencatatan keuangan, sebagaimana dijelaskan di Kebijakan Privasi.',
      'Foto selfie hanya dilihat staf Studio dan tidak ditampilkan kepada member lain.',
    ],
  },
  {
    id: 'batas-tanggung-jawab',
    judul: '16. Batas Tanggung Jawab dan Keadaan Kahar',
    butir: [
      'Sepanjang diizinkan hukum, tanggung jawab Studio atas klaim apa pun dibatasi paling banyak sebesar nilai sisa sesi Paket yang bersangkutan.',
      'Studio tidak bertanggung jawab atas gangguan layanan karena keadaan di luar kendali Studio, termasuk bencana alam, wabah, kebijakan pemerintah, pemadaman listrik, gangguan internet, atau gangguan Aplikasi. Dalam keadaan tersebut Studio dapat menyesuaikan jadwal atau Masa Berlaku sesuai kebijakannya.',
    ],
  },
  {
    id: 'hukum',
    judul: '17. Hukum yang Berlaku dan Penyelesaian Sengketa',
    butir: [
      'Syarat & Ketentuan ini tunduk pada hukum Republik Indonesia.',
      'Setiap perselisihan diselesaikan terlebih dahulu secara musyawarah dengan manajemen Studio. Catatan sistem Studio (pembayaran, persetujuan, pemesanan, dan kehadiran) menjadi acuan utama dalam penyelesaiannya.',
      'Bila satu ketentuan dinyatakan tidak berlaku, ketentuan lainnya tetap berlaku sepenuhnya.',
    ],
  },
];

/** Poin yang wajib dibaca sebelum membeli; ditampilkan di checkout di atas centang persetujuan. */
export function ringkasanPembelian(input: { masaBerlakuHari?: number | null; perpanjangan?: boolean } = {}): string[] {
  const hari = input.masaBerlakuHari ? `${input.masaBerlakuHari} hari` : 'yang tertera';
  if (input.perpanjangan)
    return [
      'Perpanjangan menambah 30 hari dari tanggal berakhir saat ini, tanpa menambah sesi.',
      'Setiap paket maksimal 3 kali perpanjangan. Setelah itu tidak bisa diperpanjang lagi dan sisa sesi hangus saat masa berlaku habis.',
      'Pembayaran perpanjangan final dan tidak dapat dikembalikan.',
    ];
  return [
    `Masa berlaku paket ${hari} sejak aktif. Setelah lewat, sisa sesi hangus otomatis dan tidak bisa diuangkan.`,
    'Perpanjangan masa berlaku berbayar dan maksimal 3 kali per paket.',
    'Batal atau ganti jadwal kurang dari 12 jam sebelum kelas, atau tidak hadir, sesi tetap terpotong.',
    'Pembayaran final dan tidak dapat dikembalikan. Studio berhak memotong, membekukan, atau membatalkan paket sesuai Syarat & Ketentuan.',
  ];
}
