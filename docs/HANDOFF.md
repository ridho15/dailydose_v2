# Handoff: Daily Dose Pilates v2

Serah terima pekerjaan per **1 November 2026**, branch `perbaikan_arsitektur`. Baca bersama
[PRD.md](./PRD.md), [Architecture.md](./Architecture.md), [Rules.md](./Rules.md), dan
[DEPLOY.md](./DEPLOY.md).

---

## 1. Kondisi saat ini

- Kode terbaru ada di `perbaikan_arsitektur`. `main` sudah lama tertinggal; jangan deploy dari `main`.
- Dua pihak aktif mendorong ke branch yang sama: pekerjaan dari sesi Claude (commit penulis `Claude`)
  dan developer (Ridho). Selalu `fetch` dan **merge** sebelum push.
- Database produksi sempat **dikosongkan** oleh developer. Tabel V2 sudah terbentuk (45 tabel), tetapi
  data harus diisi ulang dari V1 (lihat bagian 4.1).

## 2. Yang sudah selesai (Oktober sampai November 2026)

### Member dan publik
- Landing page bahasa Inggris, hero dari CMS (`en-US`), foto hero baru, seksi studio dan thumbnail kelas
  dihapus, tombol WhatsApp CS dengan pilihan cabang di pop-up.
- Login dengan Google (Client ID studio di `apps/web/app/lib/google-client-id.ts`). Akun Google wajib
  melengkapi nomor WhatsApp dan selfie.
- Verifikasi cukup selfie (tanpa KTP); selfie juga wajib saat mendaftar dan untuk instruktur.
- Beranda member: QR tetap, sisa paket, riwayat kelas, promo. Ulasan instruktur setelah kelas.
- Booking kursi teman dengan paket "bawa teman".

### Staf
- Kerangka workspace, timetable (laci peserta di samping), meja check-in, halaman Hari ini, Antrean,
  Paket habis & renewal, sesuai mockup.
- Check-in: staf memindai QR di halaman Check-in (kiosk ber-PIN dihapus). QR bisa dikirim lewat WhatsApp.
- Tombol X batalkan peserta; kurang dari H-24 lewat persetujuan Manager/Owner. Kelas Dikonfirmasi bisa
  dibatalkan.
- Booking admin lintas cabang, paket berlaku di cabang paket atau cabang pembelian, pesan bentrok jadwal
  yang jelas, angka terisi dari booking nyata.
- Reset kata sandi member oleh Admin/Manager.
- Penyesuaian sesi wajib alasan dan bukti.

### Instruktur
- Menu ringkas: Hari ini, Jadwal saya (semua cabang), Ketersediaan, Payroll (honor sendiri, kelas
  ter-scan saja).

### Keuangan
- Fee instruktur hanya dari Data Master; bagian "Fee per sesi" di detail instruktur; kolom fee dihapus
  dari timetable.
- Modal per sesi (Data Master > Modal per Sesi); laba = omzet − modal sesi − pengeluaran, modal
  mengikuti pemakaian sesi (dikonfirmasi pemilik 1 November).
- Beranda Owner, jurnal kas, pengeluaran "Dibayar oleh", settlement Super Owner, koreksi jam instruktur.
- Transfer honor: Excel KlikBCA Multi Payroll + rekening instruktur.
- Kapasitas Data Master > Kuota & Kapasitas kini benar-benar tersimpan dan diterapkan.
- Kerahasiaan: admin hanya omzet cabangnya, instruktur hanya honor sendiri (di level API).

### Paket
- Paket "bawa teman" (admin dan member). Developer menambahkan paket Duet/Family; keduanya digabung.

Riwayat lengkap: `git log --author=Claude --since=2026-10-20 --oneline`.

## 3. Checklist deploy berikutnya

1. Backup database:
   ```bash
   docker compose exec mysql sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --all-databases' > backup-$(date +%Y%m%d-%H%M).sql
   ```
2. Buat tabel baru yang belum ada (SQL di [DEPLOY.md](./DEPLOY.md) bagian "Tabel baru"):
   `ulasan_instruktur`, `porsi_owner_cabang`, `pembayar_pengeluaran`, `rekening_instruktur`,
   `modal_sesi`, `kapasitas_kelas_cabang`, `paket_bawa_teman`, `booking_teman`, ditambah dari developer:
   `paket_pelanggan_anggota` dan kolom `paket.is_shareable` (lihat 5.1). Cek dulu dengan `SHOW TABLES`.
3. Pastikan `.env.production` memuat `BOOKING_CANCELLATION_CUTOFF_HOURS=24` (batas pembatalan H-24
   yang diputuskan pemilik).
4. Deploy lewat GitHub Actions "Deploy production" dari `perbaikan_arsitektur`.
5. Google Cloud Console: Authorized JavaScript origins memuat `https://v2.dailydosepilates.com`, consent
   screen berstatus In production.
6. Setelah deploy, Super Owner mengisi:
   - Data Master > Kuota & Kapasitas: simpan ulang kapasitas tiap cabang (isian lama tidak pernah
     tersimpan). Contoh: Untar Group 10.
   - Data Master > Modal per Sesi untuk semua cabang dan tipe kelas (kosong berarti modal Rp0).
     Modal juga berlaku untuk kelas lama hasil migrasi V1 bila tanggal mulai berlakunya diisi mundur.
   - Fee per sesi semua instruktur (kosong berarti bawaan Rp150.000 per jam).
   - Rekening instruktur bila memakai Excel KlikBCA.
   - Paket mana yang dicentang "Boleh bawa teman".

## 4. Pekerjaan yang masih terbuka

### 4.1 Isi ulang data dari V1 (prioritas)
Database V2 produksi kosong. Langkah yang sudah diberikan ke developer:
1. Dump database V1 (`dailydose` di MySQL host V1, sekitar 9.404 user) lalu import ke database
   **`dailydose_v1`** di MySQL Docker V2 (skrip migrasi membaca skema `dailydose_v1.*`).
2. Jalankan:
   ```bash
   docker compose exec app node --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/prisma/migrate-full-v1-to-v2.ts
   ```
   Skrip ini mengosongkan tabel V2 lalu mengisinya ulang.
3. Periksa hasil dengan `prisma/cek-data-jadwal.ts` (hanya membaca) dan hitung baris tabel utama.
4. Karena V1 masih dipakai, ulangi dump dan migrasi menjelang peralihan, atau pakai
   `migrate-delta-catchup.ts` (`DELTA_KELAS_DARI`, `DELTA_BOOKING_DARI`).

Status: menunggu hasil dari developer.

### 4.2 Lain-lain
| Item | Status |
| :--- | :--- |
| Foto halaman login diganti ("gambar 2"), tanpa melar | Menunggu gambar dari pemilik |
| Aplikasi Flutter pembungkus web (APK/iOS) | **Tidak ada** (pemilik konfirmasi 1 November). Sumber yang pernah dibuat di sesi sebelumnya tidak tersimpan; Flutter lama dihapus di commit `c0ded091`. Buat ulang bila dibutuhkan. |
| Kualitas data hasil migrasi V1 | Booking "Hadir" palsu dari kunci H-24 V1, kapasitas kelas, dan penghitung terisi sudah ditangani skrip. Jalankan `pnpm prisma:cek-jadwal` setelah migrasi; keputusan perbaikan kapasitas massal belum diambil. |
| Panduan staf (PDF) | Panduan Admin/Instruktur dibuat 28 Okt; belum memuat fitur setelahnya (modal sesi, transfer honor, bawa teman). PDF terpisah untuk bawa teman sudah dibuat di luar repo. |
| Excel KlikBCA | Kolom sesuai template, terbaca Excel/LibreOffice, tetapi **belum diuji di Converter BCA asli**. Uji sekali dengan nominal kecil. |

## 5. Masalah yang diketahui

### 5.1 `ALTER TABLE paket ADD COLUMN is_shareable` (dari developer)
Fitur Duet/Family mengubah tabel lama `paket`, bertentangan dengan aturan pemilik
([Rules.md](./Rules.md#1-database)). Perlu konfirmasi pemilik, atau pindahkan flag ke tabel terpisah.

### 5.2 Test
- `src/app.module.spec.ts` gagal di lingkungan tanpa konfigurasi lengkap; bukan bug.
- Web typecheck: `app/components/shared-package-members-dialog.test.tsx` baris 32 (`activeBookings`
  tidak ada di tipe customer) berasal dari commit developer; perlu diperbaiki di sana.
- Test API "denies finance writes without finance:manage" yang sempat gagal sudah lulus lagi per 1 November.

### 5.3 Dokumen lama yang tidak lagi sesuai
Beberapa dokumen di `docs/` ditulis sebelum perubahan Oktober. Keputusan nomor 1 di `docs/README.md`
sudah diperbarui (presensi member lewat scan QR oleh staf, dikonfirmasi pemilik). Bila dokumen lain
bertentangan, PRD/Rules/HANDOFF ini lebih baru; konfirmasi ke pemilik bila ragu.

## 6. Pertanyaan terbuka untuk pemilik
Jawaban pemilik 1 November 2026: laba dikurangi pengeluaran (ya), kursi teman memotong 1 sesi (ya),
modal sesi mengikuti pemakaian sesi sebelum paket kedaluwarsa (sudah diterapkan di kode), batas
pembatalan H-24, aplikasi Flutter tidak ada, presensi member lewat scan QR oleh staf.

Masih terbuka:
1. `ALTER TABLE paket ADD COLUMN is_shareable` dari developer (lihat 5.1).
2. Asumsi kecil di [PRD.md](./PRD.md#6-perlu-konfirmasi-asumsi-saat-membangun) bagian 6.

## 7. Kontak dan akses
- Repo: `ridho15/dailydose_v2`, branch `perbaikan_arsitektur`.
- Server: `/var/www/dailydose_v2` (docker compose), image `ghcr.io/ridho15/dailydose-v2-app`.
- Akun testing: [AKUN_TESTING_RESMI.md](./AKUN_TESTING_RESMI.md).
- Rahasia (password DB, client secret Google, token WhatsApp) tidak ada di repo; minta ke pemilik.
