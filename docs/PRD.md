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
- **Laba bulanan = omzet − modal sesi − pengeluaran.** Modal sesi mengikuti **pemakaian**: setiap
  sesi member yang terpakai (hadir atau tidak hadir) di kelas yang selesai bulan itu × modal per sesi
  tipe kelas di cabang kelas. Sesi yang hangus karena paket kedaluwarsa tidak punya modal.
  Contoh pemilik: paket Group 20 sesi Rp4.000.000 di Untar, modal Rp50.000 per sesi; bila 20 sesi
  terpakai sebelum paket habis, modalnya Rp1.000.000 (tersebar di bulan pemakaiannya) dan laba
  Rp3.000.000 sebelum pengeluaran.
- Payroll instruktur (yang dibayar) ditampilkan terpisah dan **tidak mengurangi laba**.
- **Jurnal kas**: admin mencatat pengeluaran cabang; pengeluaran bisa ditandai "Dibayar oleh" Super Owner
  (uang pribadi, diganti saat settlement).
- **Settlement Super Owner**: porsi laba per cabang per Super Owner (persen, total 100%) + reimburse
  pengeluaran yang ia bayar.
- **Transfer honor KlikBCA**: Excel format Template MAT Multi Payroll berisi honor instruktur dari
  tanggal 1 sampai hari ini (pada tanggal 1: bulan lalu penuh). Rekening instruktur diisi di halaman
  yang sama. Berkas diolah Converter dan Checksum BCA sebelum diunggah.

### 3.9 Laporan
- Beranda Owner: omzet, modal sesi (sesi terpakai), payroll (dibayar), pengeluaran, laba; total dan
  per cabang; tiga bulan terakhir.
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
4. Laba = omzet − modal sesi − pengeluaran. Modal sesi mengikuti pemakaian sesi sebelum paket
   kedaluwarsa, bukan honor instruktur.
5. Admin hanya boleh melihat omzet cabangnya sendiri; instruktur hanya fee dirinya sendiri.
6. Pembatalan kurang dari H-12 perlu persetujuan Manager atau Owner.
7. Paket tertentu boleh membawa teman; member juga bisa booking kursi teman sendiri.
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
15. Presensi instruktur lewat scan QR masih diterima sampai 10 menit setelah kelas selesai
    (5 November 2026).

## 6. Perlu konfirmasi (asumsi saat membangun)

Sudah dikonfirmasi pemilik pada 1 November 2026 (dipindah ke bagian 5): laba dikurangi pengeluaran,
kursi teman memotong 1 sesi, modal sesi mengikuti pemakaian, batas pembatalan H-24, presensi member
lewat scan QR oleh staf.

| # | Asumsi yang masih berlaku | Dipakai di |
| :--- | :--- | :--- |
| 1 | Fee dihitung per jam (dibulatkan, minimal 1 jam). Kelas 1 jam = 1 sesi. | `instructor-fee-calculator.ts` |
| 2 | Kapasitas dari Data Master menang atas jumlah bed ruangan. | `slot-kelas.service.ts` |
| 3 | Sesi "tidak hadir" (NO_SHOW) ikut dihitung modal karena sesinya tetap terpotong. | `modal-sesi.service.ts` |
| 4 | Modal sesi memakai tarif cabang dan tipe kelas **kelas yang dihadiri**, bukan cabang tempat paket dibeli. | `modal-sesi.service.ts` |
