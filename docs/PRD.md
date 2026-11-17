# PRD: Daily Dose Pilates v2

Dokumen kebutuhan produk untuk sistem manajemen studio Daily Dose Pilates v2. Isinya diringkas dari
permintaan pemilik selama pengembangan Oktober sampai November 2026 dan dari perilaku sistem yang
sudah berjalan di branch `perbaikan_arsitektur`.

Dokumen terkait: [Architecture.md](./Architecture.md), [Rules.md](./Rules.md), [HANDOFF.md](./HANDOFF.md),
[DEPLOY.md](./DEPLOY.md), [FITUR_MODUL_DAN_FLOW_PER_ROLE.md](./FITUR_MODUL_DAN_FLOW_PER_ROLE.md).

> Bagian yang ditandai **Perlu konfirmasi** adalah asumsi yang diambil saat membangun fitur dan belum
> dikonfirmasi pemilik. Jangan diubah tanpa bertanya ke pemilik.

---

## 1. Latar belakang

Daily Dose Pilates menjalankan beberapa studio (cabang) pilates: Green Garden (GG), Muara Karang (MK),
Graha Family Surabaya (SBY), Untar Kampus 2 (UNTAR), dan Orange Groves PIK 2 (PIK). Sistem lama (V1,
Laravel, `dailydosepilates.com`) masih berjalan. V2 menggantikannya: website publik, aplikasi member,
dan workspace staf dalam satu aplikasi web.

Data V1 dipindahkan ke V2 dengan skrip migrasi (`apps/api/prisma/migrate-full-v1-to-v2.ts`, delta
`migrate-delta-catchup.ts`).

## 2. Pengguna dan peran

| Peran | Siapa | Inti kebutuhan |
| :--- | :--- | :--- |
| **Customer / Member** | Pelanggan studio | Beli paket, booking kelas sendiri, QR check-in, lihat sisa sesi, ulas instruktur |
| **Instruktur** | Pengajar | Jadwal sendiri, QR presensi, ketersediaan, payroll miliknya sendiri |
| **Admin** | Meja depan cabang | Roster kelas, check-in, booking dibantu, pembayaran, pengeluaran cabang |
| **Manager** | Kepala cabang | Seperti admin + memutus penyesuaian sesi, pembatalan terlambat, koreksi jam instruktur |
| **Owner** | Pemilik cabang tertentu | Laporan cabangnya (baca), memutus pembatalan terlambat |
| **Super Owner** | Pemilik utama | Semua cabang, Data Master, fee, modal, settlement, transfer honor |
| **Finance** | Keuangan | Laporan, ekspor, transfer honor instruktur |

Aturan kerahasiaan per peran ada di [Rules.md](./Rules.md#2-kerahasiaan-data-keuangan).

## 3. Kebutuhan fungsional

### 3.1 Website publik
- Landing page dalam bahasa Inggris. Hero dikelola dari CMS (disimpan sebagai `en-US`); FAQ tetap
  bahasa Indonesia.
- Halaman lokasi dengan foto cabang (diubah dari workspace/branches).
- Tombol WhatsApp CS: pilih cabang di pop-up yang sama, tanpa pindah halaman.

### 3.2 Akun member
- Daftar dan masuk dengan email/kata sandi atau **Login dengan Google**.
- Akun Google wajib melengkapi **nomor WhatsApp dan selfie** sebelum bisa membeli atau booking.
- Verifikasi identitas: **selfie saja** (tanpa KTP). Selfie ditolak berarti member mengulang foto.
- Admin/Manager bisa mereset kata sandi member (hanya akun berperan CUSTOMER).

### 3.3 Paket dan pembelian
- Paket punya jumlah sesi, masa berlaku (hari), harga, cabang (atau multi-cabang), dan tipe kelas.
- Paket berlaku di cabang paket itu **atau** cabang tempat dibeli.
- **Paket "Bawa Teman"** (mis. Double Trouble Deal): pemilik paket boleh menambah 1 kursi untuk teman
  (bukan member) di kelas yang sama. Kursi teman memakai 1 sesi paket. Bisa ditambahkan admin dari
  roster atau oleh member sendiri saat booking. Paket biasa ditolak bila nama yang sama dimasukkan dua
  kali di satu jadwal.
- **Paket Duet / Family** (dibuat developer lain): sesi paket dipakai bersama oleh member lain yang
  punya akun sendiri. Berbeda dari Bawa Teman.

### 3.4 Timetable dan kelas
- Staf membuat kelas per cabang (tipe kelas, studio/ruangan, instruktur, jam). Salin minggu, jadwal
  rutin, dan duplikat kelas tersedia.
- Form kelas **tidak memuat fee/honor apa pun**. Fee hanya dari Data Master.
- Kapasitas kelas = kapasitas cabang + tipe kelas dari **Data Master > Kuota & Kapasitas**; bila belum
  diatur, kapasitas bawaan tipe kelas dibatasi jumlah bed ruangan.
- Mengubah kapasitas di Data Master langsung menerapkan ke kelas yang belum berjalan, tidak pernah di
  bawah jumlah peserta terdaftar.
- Kelas berstatus Draf, Terbit, atau **Dikonfirmasi** bisa dibatalkan dari detail kelas (wajib alasan).
- Jadwal bentrok (instruktur atau ruangan) ditolak dengan rincian kelas yang bentrok.
- Angka "terisi" dihitung dari booking yang benar-benar ada (BOOKED, ATTENDED, NO_SHOW), bukan dari
  kolom penghitung lama.

### 3.5 Booking
- Member booking sendiri dari jadwal; admin bisa membantu dari roster kelas (tambah member satu tekan).
- Sesi **dipotong saat kelas selesai dan member hadir**, bukan saat booking.
- Pembatalan oleh staf (tombol X di roster/detail booking):
  - lebih dari batas H-12: langsung batal, sesi utuh;
  - kurang dari H-12 (atau booking yang terkunci Hadir sebelum kelas): menjadi **pengajuan** yang
    diputus Manager, Owner, atau Super Owner. Disetujui berarti sesi dikembalikan.
- Instruktur hanya melihat roster kelas yang ia ajar.

### 3.6 Check-in
- Staf memindai QR member di halaman Check-in. Memindai QR member dua kali di kelas yang sama mencatat
  kursi kedua (kursi teman).
- QR instruktur dipindai untuk presensi instruktur. **Hanya kelas yang presensi instrukturnya tercatat
  yang dibayar dan dihitung honornya.**
- QR bisa dikirim lewat WhatsApp (otomatis dan manual oleh admin).

### 3.7 Instruktur
- Halaman: Hari ini, Jadwal saya, Ketersediaan, Payroll.
- Payroll hanya data milik instruktur itu: kelas selesai yang sudah di-scan QR × fee, ditambah koreksi
  jam. Kelas yang belum di-scan tampil tanpa nominal ("Belum dihitung").
- Instruktur multi-cabang melihat semua cabangnya.
- Member mengulas instruktur (bintang + komentar) setelah kelas yang dihadiri; ulasan internal, dibaca
  Manager/Owner/Super Owner di Workspace > Ulasan.

### 3.8 Keuangan
- **Fee instruktur** diatur per instruktur × cabang × tipe kelas, dengan tanggal mulai berlaku, di
  detail instruktur (bagian "Fee per sesi") atau Data Master > Honor Instruktur. Belum diatur berarti
  fee bawaan Rp150.000 per jam.
- **Modal per sesi** diatur per cabang × tipe kelas (atau "semua tipe kelas") di Data Master > Modal per
  Sesi, dengan tanggal mulai berlaku.
- **Laba bulanan per cabang = omzet − modal paket terjual − pengeluaran cabang** (pembelian lunas mulai
  1 November 2026). Saat paket lunas, modal = sesi paket × modal per sesi cabang pembelian dan tipe
  kelas paket, tarif yang berlaku pada tanggal lunas; nilainya dibekukan di `modal_paket_terjual`
  sehingga perubahan tarif sesudahnya tidak mengubah bulan yang sudah lewat. Contoh pemilik: paket 20
  sesi Rp4.000.000, modal Rp80.000/sesi → modal Rp1.600.000, laba Rp2.400.000. Sesi terpakai dan sesi
  hangus tidak mengubah laba. Pembelian yang di-void membalik seluruh modalnya, dan refund membalik
  modal sisa sesinya, di bulan pembatalan/refund.
- Oktober 2026 dan sebelumnya tetap memakai aturan lama (sesi terpakai di kelas selesai × modal per
  sesi pada tanggal kelas) dan tidak dihitung ulang.
- **Kas payroll simpanan** per cabang (mulai November 2026): masuk = modal paket terjual, keluar =
  payroll instruktur + pembalikan modal. Payroll dibayar dari kas ini dan **tidak mengurangi laba**.
  Saldo awal, masuk, keluar, dan saldo akhir per cabang per bulan tampil di Beranda Owner dan halaman
  Keuangan.
- **Jurnal kas**: admin mencatat pengeluaran cabang; pengeluaran bisa ditandai "Dibayar oleh" Super Owner
  (uang pribadi, diganti saat settlement).
- **Settlement Super Owner**: porsi laba per cabang per Super Owner (persen, total 100%) + reimburse
  pengeluaran yang ia bayar.
- **Transfer honor KlikBCA**: Excel format Template MAT Multi Payroll berisi honor instruktur dari
  tanggal 1 sampai hari ini (pada tanggal 1: bulan lalu penuh). Rekening instruktur diisi di halaman
  yang sama. Berkas diolah Converter dan Checksum BCA sebelum diunggah.

### 3.9 Laporan
- Beranda Owner: omzet, modal paket terjual (bulan sebelum November 2026: modal sesi terpakai),
  payroll (dibayar dari kas payroll simpanan), pengeluaran, laba, kas payroll simpanan; total dan per
  cabang; tiga bulan terakhir.
- Laporan keuangan menurut rentang tanggal; tidak ada tutup buku.

## 4. Kebutuhan non-fungsional
- Bahasa antarmuka Indonesia (kecuali landing page Inggris).
- Zona waktu operasional Asia/Jakarta (WIB); laporan keuangan memakai batas hari UTC (lihat
  [Architecture.md](./Architecture.md#7-zona-waktu)).
- Semua perubahan penting tercatat di `audit_log`.
- Tampilan harus layak di ponsel (member dan admin meja depan).

## 5. Keputusan pemilik yang tercatat
1. **Database existing tidak boleh diubah.** Fitur baru memakai tabel baru tanpa relasi Prisma.
2. Fee instruktur hanya dari Data Master; admin tidak boleh tahu soal keuangan.
3. Honor dibayar hanya untuk kelas yang sudah di-scan QR instruktur.
4. Laba = omzet − modal − pengeluaran, bukan honor instruktur. Mulai pembelian yang lunas 1 November
   2026, modal diakui saat paket lunas (sesi paket × modal per sesi, dibekukan), dan payroll dibayar
   dari kas payroll simpanan per cabang (16 November 2026, menggantikan aturan pemakaian sesi dari
   1 November yang membuat November terlihat minus). Oktober 2026 dan sebelumnya tidak dihitung ulang.
5. Admin hanya boleh melihat omzet cabangnya sendiri; instruktur hanya fee dirinya sendiri.
6. Pembatalan kurang dari H-12 perlu persetujuan Manager atau Owner.
7. Paket tertentu boleh membawa teman; member juga bisa booking kursi teman sendiri. Jumlah teman per kelas diatur per paket di Data Master > Paket ("Maksimal teman per kelas", 0 sampai 5; 2 = datang bertiga) (17 November 2026).
8. Kursi teman memotong 1 sesi paket pemiliknya.
9. Batas pembatalan dan reschedule H-12 jam, semua cabang (diubah dari H-24 pada 5 November 2026; pembatalan staf kurang dari itu perlu persetujuan; member mengikuti
   batas yang sama).
10. Presensi member dilakukan dengan **staf memindai QR member**.
11. Login foto: menunggu gambar baru dari pemilik (lihat HANDOFF).
12. Penjualan tunai/kartu/manual staf wajib disetujui **Manager atau Super Owner**, dan bukan oleh
    orang yang mencatatnya (2 November 2026).
13. Kode unik transfer **tetap dihitung** sebagai omzet (2 November 2026).
14. Paket N hari yang aktif tanggal D berlaku **sampai 23.59 WIB tanggal D + N** (contoh: aktif 1
    November, 120 hari, berakhir 1 Maret 23.59 WIB) (2 November 2026).
16. Pembelian lunas hanya bisa dibatalkan (void) atau dipindah ke member lain oleh **Super Owner**,
    dengan kode alasan dan alasan minimal 20 karakter. Void membuat status pembelian CANCELLED (keluar
    dari omzet) dan paketnya tidak bisa dipakai; bila sesi sudah terpakai hanya void sebagian (sisa sesi
    dinolkan, omzet tetap). Semua tercatat di `pembelian_koreksi` dan audit log (11 November 2026).
17. Refund paket: sisa sesi dikembalikan prorata, harga final dibayar (setelah promo/voucher, tanpa kode
    unik) ÷ total sesi × sisa sesi. Diproses Admin, Manager, Owner, atau Super Owner di cabang pembelian,
    wajib bank, nomor dan nama rekening, alasan, dan bukti transfer; paket dinolkan; surat konfirmasi bisa
    dicetak (12 November 2026).
18. Paket perpanjangan masa aktif (16 November 2026): paket 0 sesi (ditandai "Perpanjangan masa
    aktif" di Data Master > Paket, harga diisi di sana, mis. Rp150.000) menambah 30 hari pada masa
    berlaku 1 paket member yang dipilih. Maksimal 3 kali per paket; pembelian ke-4 ditolak. Hanya untuk
    paket yang masih aktif (belum hangus). Bisa dibeli member sendiri atau dicatat admin. Modal Rp0, jadi
    seluruh nilainya masuk laba. Void mengembalikan 30 hari itu.
15. Presensi instruktur lewat scan QR diterima mulai 45 menit sebelum kelas sampai 10 menit setelah
    kelas **mulai** (kelas 10.00 masih bisa scan 10.10). Scan setelah jam mulai tercatat sebagai anomali
    "Instruktur Check-in Terlambat" di Laporan Keuangan > Rekonsiliasi (5 November 2026).

## 6. Perlu konfirmasi (asumsi saat membangun)

Sudah dikonfirmasi pemilik pada 1 November 2026 (dipindah ke bagian 5): laba dikurangi pengeluaran,
kursi teman memotong 1 sesi, modal sesi mengikuti pemakaian, batas pembatalan H-24, presensi member
lewat scan QR oleh staf.

| # | Asumsi yang masih berlaku | Dipakai di |
| :--- | :--- | :--- |
| 1 | Fee dihitung per jam (dibulatkan, minimal 1 jam). Kelas 1 jam = 1 sesi. | `instructor-fee-calculator.ts` |
| 2 | Kapasitas dari Data Master menang atas jumlah bed ruangan. | `slot-kelas.service.ts` |
| 3 | Hanya untuk bulan sebelum November 2026: sesi "tidak hadir" (NO_SHOW) ikut dihitung modal karena sesinya tetap terpotong. | `modal-sesi.service.ts` |
| 4 | Hanya untuk bulan sebelum November 2026: modal sesi memakai tarif cabang dan tipe kelas **kelas yang dihadiri**. Mulai November: cabang pembelian dan tipe kelas paket. | `modal-sesi.service.ts` |
| 5 | "Payroll yang dibayar" untuk kas payroll simpanan = payroll instruktur bulan itu seperti di Beranda Owner (honor kelas selesai + koreksi jam), karena aplikasi belum mencatat tanggal transfer honor. | `ringkasan-keuangan.service.ts` |
| 6 | Batas bulan modal sama dengan batas bulan omzet (tanggal UTC, jam 07.00 WIB), supaya omzet dan modal satu pembayaran selalu di bulan yang sama. | `modal-sesi.service.ts` |
| 7 | Void sebagian (sesi sudah terpakai, sisa dinolkan tanpa uang kembali) diperlakukan seperti sesi hangus: tidak ada pembalikan modal. | `modal-sesi.service.ts` |
