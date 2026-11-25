# Deploy produksi

Image aplikasi dibangun oleh GitHub Actions dan dikirim ke GHCR (`ghcr.io/ridho15/dailydose-v2-app`).
Server produksi tidak lagi membangun apa pun: ia hanya menarik image jadi lalu menjalankannya. Server ini dipakai
bersama banyak proyek lain, dan build 10 menit di sana membuat semuanya melambat.

## Cara deploy

**Lewat GitHub** (disarankan): Actions, Deploy production, Run workflow, pilih branch `perbaikan_arsitektur` atau `main`.

**Lewat tag rilis:**

```bash
git tag v2026.10.29
git push origin v2026.10.29
```

Push biasa ke branch **tidak** memicu deploy.

Urutannya: typecheck dan tes unit, bangun dan kirim image, lalu server menarik image itu dan menjalankannya.
Opsi saat menjalankan manual: `run_tests` (matikan hanya untuk perbaikan darurat) dan `deploy` (matikan untuk hanya
membangun dan mengirim image).

## Persiapan satu kali

1. **Secret repository yang sudah dipakai** (Settings, Secrets and variables, Actions): `SERVER_HOST`, `SERVER_USER`,
   `SERVER_SSH_KEY`, `SERVER_PORT` (opsional), `PROJECT_PATH` (bawaan `/var/www/dailydose_v2`).
2. **Client ID Google** sudah tersimpan di kode sebagai bawaan (`apps/web/app/lib/google-client-id.ts` dan
   `apps/api/src/identity/provider-adapters.ts`); nilainya publik. Variabel repository `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   dan `GOOGLE_CLIENT_ID` di `.env.production` hanya perlu diisi bila ingin memakai Client ID lain, dan keduanya
   harus sama. Client secret tidak dipakai.
3. **Environment `production`** (Settings, Environments): dibuat otomatis pada deploy pertama. Tambahkan
   "Required reviewers" bila ingin persetujuan manual sebelum server disentuh.
4. **Paket GHCR**: dibuat otomatis oleh workflow dan bersifat privat. Server menariknya dengan token singkat dari
   workflow (`GITHUB_TOKEN`), lalu logout; tidak ada token permanen di server. Setelah image pertama terkirim,
   buka paket `dailydose-v2-app` di GitHub dan pastikan repositori ini terdaftar pada "Manage Actions access".

## Deploy pertama: lakukan bertahap

1. Jalankan workflow dengan `deploy` **dimatikan**. Ini hanya menguji tes dan build di GitHub, lalu mengirim image ke GHCR.
   Periksa tidak ada peringatan soal `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, dan paket `dailydose-v2-app` muncul di GitHub.
2. Pada jam sepi, jalankan lagi dengan `deploy` **dinyalakan** (atau tekan "Re-run" untuk job deploy).
3. Setelah aplikasi sehat, hapus image lama hasil build di server agar disk lega (cukup sekali):
   `docker rmi dailydose-v2-app:dev`
   (abaikan bila namanya berbeda; cek dengan `docker image ls | grep dailydose`).

Deploy pertama di server tetap perlu menarik image sekitar 1 GB; berikutnya hanya layer yang berubah.

## Yang terjadi di server

`update.sh --pull --tag sha-xxxxxxx` (dipanggil workflow):

1. Menyamakan berkas compose dan skrip dengan commit yang dideploy.
2. Menarik `ghcr.io/ridho15/dailydose-v2-app:sha-xxxxxxx`, menyimpan versi yang berjalan sebagai tag `previous`, lalu
   menandai versi baru sebagai `production`.
3. `docker compose up -d --remove-orphans --no-build` (tanpa build), lalu menunggu container sehat. Bila tidak sehat
   dalam 2 menit, skrip gagal dan job GitHub menjadi merah.
4. Mencatat tag di `.deployed-version` dan menyimpan hanya 3 versi `sha-*` terbaru.

## Tabel baru

Skema hanya disinkronkan otomatis pada start pertama (`docker-entrypoint.sh`, berkas penanda
`.bootstrapped_schema`). Tabel yang ditambahkan sesudahnya dibuat sekali secara manual, atau dengan satu kali deploy
memakai `FORCE_DB_SYNC=true`. Pernyataan di bawah hanya membuat tabel baru; tabel lama tidak disentuh.

`ulasan_instruktur` (ulasan member untuk instruktur, Oktober 2026):

```sql
CREATE TABLE `ulasan_instruktur` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `classSlotId` CHAR(36) NOT NULL,
    `instructorId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `rating` TINYINT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ulasan_instruktur_bookingId_key`(`bookingId`),
    INDEX `ulasan_instruktur_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ulasan_instruktur_instructorId_createdAt_idx`(`instructorId`, `createdAt`),
    INDEX `ulasan_instruktur_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`porsi_owner_cabang` dan `pembayar_pengeluaran` (settlement Super Owner di Jurnal kas, Oktober 2026):

```sql
CREATE TABLE `porsi_owner_cabang` (
    `id` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `porsiBp` INTEGER NOT NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `porsi_owner_cabang_branchId_ownerId_key`(`branchId`, `ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pembayar_pengeluaran` (
    `id` CHAR(36) NOT NULL,
    `otherCostId` CHAR(36) NOT NULL,
    `dibayarOlehId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pembayar_pengeluaran_otherCostId_key`(`otherCostId`),
    INDEX `pembayar_pengeluaran_dibayarOlehId_idx`(`dibayarOlehId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`rekening_instruktur` (rekening tujuan transfer honor untuk berkas KlikBCA Multi Payroll, Oktober 2026):

```sql
CREATE TABLE `rekening_instruktur` (
    `instructorId` CHAR(36) NOT NULL,
    `bankName` VARCHAR(64) NOT NULL,
    `swiftCode` VARCHAR(11) NOT NULL,
    `accountNumber` VARCHAR(34) NOT NULL,
    `accountName` VARCHAR(70) NOT NULL,
    `email` VARCHAR(191) NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`instructorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`modal_sesi` (modal per sesi per cabang dan tipe kelas, dasar laba bulanan, Oktober 2026):

```sql
CREATE TABLE `modal_sesi` (
    `id` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `classTypeId` CHAR(36) NULL,
    `modalPerSesiRp` INTEGER NOT NULL,
    `effectiveDate` DATE NOT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `modal_sesi_branchId_classTypeId_effectiveDate_idx`(`branchId`, `classTypeId`, `effectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`kapasitas_kelas_cabang` (kapasitas kelas per cabang dan tipe kelas dari Data Master, Oktober 2026):

```sql
CREATE TABLE `kapasitas_kelas_cabang` (
    `id` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `classTypeId` CHAR(36) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kapasitas_kelas_cabang_branchId_classTypeId_key`(`branchId`, `classTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`paket_bawa_teman` dan `booking_teman` (paket yang boleh membawa teman, November 2026):

```sql
CREATE TABLE `paket_bawa_teman` (
    `packageId` CHAR(36) NOT NULL,
    `maksTeman` INTEGER NOT NULL DEFAULT 1,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`packageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_teman` (
    `bookingId` CHAR(36) NOT NULL,
    `packageId` CHAR(36) NOT NULL,
    `namaTeman` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`bookingId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`paket_masa_jual` (tanggal "Mulai berlaku" dan "Berakhir" paket di katalog, 10 November 2026).
Tanpa tabel ini paket tetap tampil dan bisa dibeli seperti biasa; tanggalnya saja yang tidak tersimpan.

```sql
CREATE TABLE `paket_masa_jual` (
    `packageId` CHAR(36) NOT NULL,
    `mulai` DATE NULL,
    `berakhir` DATE NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`packageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`pembelian_koreksi` (batalkan/pindah pembelian oleh Super Owner, 11 November 2026). Tanpa tabel ini
tombol koreksi gagal; laporan lain tetap jalan.

```sql
CREATE TABLE `pembelian_koreksi` (
    `id` CHAR(36) NOT NULL,
    `purchaseId` CHAR(36) NOT NULL,
    `jenis` VARCHAR(16) NOT NULL,
    `kodeAlasan` VARCHAR(32) NOT NULL,
    `alasan` VARCHAR(500) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `dariUserId` CHAR(36) NULL,
    `keUserId` CHAR(36) NULL,
    `branchId` CHAR(36) NOT NULL,
    `nominalRp` INTEGER NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `sisaSesiSebelum` INTEGER NOT NULL DEFAULT 0,
    `sesiTerpakai` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pembelian_koreksi_purchaseId_idx`(`purchaseId`),
    INDEX `pembelian_koreksi_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`refund_paket` (refund sisa sesi paket member, 12 November 2026). **Buat sebelum deploy**; tanpa tabel ini
tombol refund gagal, fitur lain tetap jalan.

```sql
CREATE TABLE `refund_paket` (
    `id` CHAR(36) NOT NULL,
    `customerPackageId` CHAR(36) NOT NULL,
    `purchaseId` CHAR(36) NULL,
    `userId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `namaPaket` VARCHAR(191) NOT NULL,
    `hargaDibayarRp` INTEGER NOT NULL,
    `totalSesi` INTEGER NOT NULL,
    `sisaSesi` INTEGER NOT NULL,
    `nominalRefundRp` INTEGER NOT NULL,
    `bankName` VARCHAR(64) NOT NULL,
    `nomorRekening` VARCHAR(40) NOT NULL,
    `namaRekening` VARCHAR(128) NOT NULL,
    `buktiExt` VARCHAR(8) NULL,
    `alasan` VARCHAR(500) NOT NULL,
    `bookingDibatalkan` INTEGER NOT NULL DEFAULT 0,
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refund_paket_customerPackageId_idx`(`customerPackageId`),
    INDEX `refund_paket_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`paket` (kolom `is_shareable` untuk paket bersama / Duet / Family, Oktober 2026) dan `paket_pelanggan_anggota`:

```sql
ALTER TABLE `paket` ADD COLUMN `is_shareable` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `paket_pelanggan_anggota` (
    `id` CHAR(36) NOT NULL,
    `customer_package_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `relationship` VARCHAR(32) NULL,
    `added_by_id` CHAR(36) NOT NULL,
    `added_by_role` VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `paket_pelanggan_anggota_customer_package_id_user_id_key`(`customer_package_id`, `user_id`),
    INDEX `paket_pelanggan_anggota_user_id_idx`(`user_id`),
    INDEX `paket_pelanggan_anggota_customer_package_id_idx`(`customer_package_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `paket_pelanggan_anggota_customer_package_id_fkey` FOREIGN KEY (`customer_package_id`) REFERENCES `paket_pelanggan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `paket_pelanggan_anggota_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`notification` (notifikasi in-app persisten untuk pengguna, November 2026):

```sql
CREATE TABLE IF NOT EXISTS `notification` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NULL,
    `eventKey` VARCHAR(128) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `tone` VARCHAR(16) NOT NULL DEFAULT 'INFO',
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `href` VARCHAR(255) NULL,
    `metadataMasked` JSON NULL,
    `readAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notification_userId_eventKey_key`(`userId`, `eventKey`),
    INDEX `notification_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    INDEX `notification_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `notification_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `cabang`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`akun_grup_tautan` (tautan Akun HR Group ke user lokal, November 2026). Login HR Group tetap jalan tanpa tabel
ini, tetapi tautan tidak tersimpan sehingga pencocokan diulang tiap login:

```sql
CREATE TABLE `akun_grup_tautan` (
    `id` CHAR(36) NOT NULL,
    `hrgSub` VARCHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `akun_grup_tautan_hrgSub_key`(`hrgSub`),
    INDEX `akun_grup_tautan_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`modal_paket_terjual` (snapshot modal paket yang lunas mulai 1 November 2026, dasar laba dan kas payroll simpanan,
November 2026). Satu baris per pembelian: sesi paket x modal per sesi yang berlaku pada tanggal lunas. Baris dibuat saat
pembayaran disetujui, dan untuk pembelian November yang lunas sebelum deploy, saat laporan keuangan pertama kali
dibuka. Tanpa tabel ini laporan tetap jalan, tetapi modal dihitung ulang dari tarif saat ini setiap kali dibuka, jadi
mengubah Modal per Sesi akan ikut mengubah bulan yang sudah lewat. Buat tabel ini **sebelum** ada yang mengubah tarif
Modal per Sesi:

```sql
CREATE TABLE `modal_paket_terjual` (
    `purchaseId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `classTypeId` CHAR(36) NULL,
    `sesi` INTEGER NOT NULL,
    `modalPerSesiRp` INTEGER NOT NULL,
    `modalTotalRp` INTEGER NOT NULL,
    `modalSesiId` CHAR(36) NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `modal_paket_terjual_branchId_paidAt_idx`(`branchId`, `paidAt`),
    PRIMARY KEY (`purchaseId`)

`paket_perpanjangan` dan `perpanjangan_paket` (paket "Perpanjangan masa aktif": Rp150.000, 0 sesi, menambah
masa berlaku satu paket member yang masih aktif 30 hari, paling banyak 3 kali per paket, 16 November 2026).
`paket_perpanjangan` menandai Paket mana yang berjenis perpanjangan; `perpanjangan_paket` mencatat paket target
tiap pembelian, kapan diterapkan (saat lunas, sekali), dan kapan ditarik (saat pembelian dibatalkan Super Owner).
Tanpa kedua tabel ini semua paket tetap berjalan seperti biasa; centang "Perpanjangan masa aktif" di Data Master
ditolak dengan pesan yang jelas. Paket perpanjangannya dibuat admin sendiri di Data Master > Paket (tidak di-seed).

```sql
CREATE TABLE `paket_perpanjangan` (
    `packageId` CHAR(36) NOT NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`packageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `perpanjangan_paket` (
    `id` CHAR(36) NOT NULL,
    `purchaseId` CHAR(36) NOT NULL,
    `targetCustomerPackageId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `hari` INTEGER NOT NULL,
    `validUntilBefore` DATETIME(3) NULL,
    `validUntilAfter` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `rolledBackAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `perpanjangan_paket_purchaseId_key`(`purchaseId`),
    INDEX `perpanjangan_paket_targetCustomerPackageId_idx`(`targetCustomerPackageId`),
    INDEX `perpanjangan_paket_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`bukti_sidik` (persetujuan otomatis transfer dari foto bukti, November 2026). Menyimpan sidik SHA-256 foto bukti
supaya foto yang sama tidak bisa dipakai untuk dua pesanan. **Tanpa tabel ini persetujuan otomatis tidak berjalan**
(semua bukti tetap diperiksa staf seperti biasa). Fitur bisa dimatikan dengan env `AUTO_APPROVE_BUKTI=false`.

```sql
CREATE TABLE `bukti_sidik` (
    `proofId` CHAR(36) NOT NULL,
    `purchaseId` CHAR(36) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `hasil` VARCHAR(32) NOT NULL,
    `waktuBukti` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bukti_sidik_sha256_idx`(`sha256`),
    INDEX `bukti_sidik_purchaseId_idx`(`purchaseId`),
    PRIMARY KEY (`proofId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`petugas_checkin` (peran Petugas Check-in untuk sales/OB, 25 November 2026). Menandai akun staf yang hanya boleh
memindai QR dan mencatat kehadiran manual di satu cabang. **Tanpa tabel ini akun petugas tidak bisa dibuat** (menu
Petugas Check-in menjawab 503); akun staf lain tidak terpengaruh.

```sql
CREATE TABLE `petugas_checkin` (
    `userId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `petugas_checkin_branchId_idx`(`branchId`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`barang_minuman` dan `mutasi_stok_minuman` (stok minuman, 25 November 2026). Master barang minuman dan catatan
barang masuk/keluar per cabang. Barang masuk otomatis menulis pengeluaran kas (`other_cost`, kategori `MINUMAN`);
penjualan minuman ikut dihitung di laporan laba. **Tanpa kedua tabel ini menu Stok Minuman menjawab 503** dan laporan
laba berjalan seperti biasa (penjualan minuman Rp0).

```sql
CREATE TABLE `barang_minuman` (
    `id` CHAR(36) NOT NULL,
    `nama` VARCHAR(80) NOT NULL,
    `satuan` VARCHAR(20) NOT NULL,
    `hargaJualRp` INTEGER NULL,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mutasi_stok_minuman` (
    `id` CHAR(36) NOT NULL,
    `barangId` CHAR(36) NOT NULL,
    `branchId` CHAR(36) NOT NULL,
    `jenis` VARCHAR(20) NOT NULL,
    `jumlah` INTEGER NOT NULL,
    `hargaSatuanRp` INTEGER NOT NULL DEFAULT 0,
    `totalRp` INTEGER NOT NULL DEFAULT 0,
    `tanggal` DATE NOT NULL,
    `catatan` VARCHAR(200) NULL,
    `otherCostId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mutasi_stok_minuman_branchId_barangId_idx`(`branchId`, `barangId`),
    INDEX `mutasi_stok_minuman_branchId_tanggal_idx`(`branchId`, `tanggal`),
    INDEX `mutasi_stok_minuman_jenis_tanggal_idx`(`jenis`, `tanggal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`persetujuan_syarat` (bukti persetujuan Syarat & Ketentuan, 25 November 2026). Mencatat kapan member
menyetujui syarat saat mendaftar, saat checkout, dan saat staf mencatat penjualan. Tanpa tabel ini
pendaftaran dan checkout tetap jalan (persetujuan tetap wajib dicentang) tetapi tidak tercatat, dan
member lama tidak diminta menyetujui ulang.

```sql
CREATE TABLE `persetujuan_syarat` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `jenis` VARCHAR(20) NOT NULL,
    `versi` VARCHAR(20) NOT NULL,
    `purchaseId` CHAR(36) NULL,
    `dicatatOleh` CHAR(36) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `persetujuan_syarat_userId_jenis_versi_idx`(`userId`, `jenis`, `versi`),
    INDEX `persetujuan_syarat_purchaseId_idx`(`purchaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Akun HR Group (SSO)

Tombol "Masuk dengan Akun HR Group" di halaman masuk dan credential bridge untuk migrasi member lama. Kontraknya
sama dengan penyedia OIDC di repo `hr-group` (klien `dailydose`). Fitur **mati** sampai semua variabel di bawah terisi
di `.env.production` dan `HRG_ENABLED=true`; saat mati, ketiga endpoint di bawah menjawab 404 dan tombolnya tidak tampil.
Login password dan Google tetap berjalan seperti biasa.

| Variabel | Isi |
| --- | --- |
| `HRG_ENABLED` | `true` untuk menyalakan; selain itu mati |
| `HRG_ISSUER` | URL issuer Akun HR Group, mis. `https://akun.hrgroup.id` (tanpa `/` di akhir) |
| `HRG_CLIENT_ID` | `dailydose` |
| `HRG_CLIENT_SECRET` | secret klien `dailydose` dari Akun HR Group |
| `HRG_REDIRECT_URI` | `https://<domain web>/api/v1/auth/hr-group/callback`, harus sama persis dengan yang didaftarkan di Akun HR Group |
| `HRG_BRIDGE_SECRET` | secret HMAC khusus Daily Dose, sama dengan yang disimpan Akun HR Group untuk Daily Dose |

Endpoint (semua lewat domain web, diteruskan ke API):

- `GET /api/v1/auth/hr-group/start?returnTo=/account`: redirect ke `${HRG_ISSUER}/auth` (code + PKCE S256, state, nonce).
  State, nonce, dan verifier disimpan di cookie HttpOnly terenkripsi `dd_hrg_flow` (10 menit). `returnTo` hanya
  jalur relatif di situs ini; selain itu diganti `/account`.
- `GET /api/v1/auth/hr-group/callback`: tukar code, verifikasi `id_token` (RS256 lewat JWKS, `iss`, `aud`, `nonce`, `exp`),
  cocokkan user (tautan lokal, `hrg_links.dailydose`, nomor HP terverifikasi, email terverifikasi, lalu customer baru),
  buat sesi Daily Dose biasa, lalu memberi tahu `POST ${HRG_ISSUER}/api/links`. Kegagalan back-channel hanya dicatat
  di log. Staf tidak pernah dibuat otomatis. Gagal: redirect ke `/sign-in?hrg_error=<kode>` dengan kode `cancelled`,
  `state`, `token`, `ambiguous` (akun ganda, dicatat di audit `auth.hrg_ambiguous`), `inactive`, atau `server`.
- `POST /api/v1/integrations/hr-group/verify-credentials`: dipanggil server Akun HR Group dengan header
  `X-HRG-Timestamp` dan `X-HRG-Signature`. Selisih waktu lebih dari 300 detik atau tanda tangan salah dijawab 401.
  Maksimal 10 percobaan per identifier per 15 menit (429). Hanya customer aktif yang dijawab; staf, user tidak ada,
  dan password salah sama-sama `401 {"error":"invalid_credentials"}`. `phoneVerified`/`emailVerified` selalu `false`
  karena Daily Dose tidak menyimpan status verifikasi nomor/email. Jalur ini dikecualikan dari cek `Origin` produksi
  (panggilan server-ke-server) dan dijaga tanda tangan HMAC.

Sebelum menyalakan: buat tabel `akun_grup_tautan` (SQL di atas), isi keenam variabel, deploy ulang (tidak perlu build
ulang khusus; tombol membaca env server saat halaman diminta), lalu coba masuk dengan satu akun uji. Aktivitasnya
tercatat di audit dengan kode `auth.hrg_login`, `auth.hrg_linked`, dan `auth.hrg_customer_created`.

## Kembali ke versi sebelumnya

```bash
cd /var/www/dailydose_v2
docker tag ghcr.io/ridho15/dailydose-v2-app:previous ghcr.io/ridho15/dailydose-v2-app:production
docker compose up -d --no-build app
```

Untuk versi yang lebih lama, tarik tag `sha-...` yang diinginkan lalu tandai sebagai `production` dengan cara yang sama.
Catatan: aplikasi menjalankan `prisma db push` saat start. Bila versi baru mengubah skema, versi lama bisa tidak cocok
dengan database; periksa dulu sebelum kembali.

## Cadangan: build di server

Bila GitHub atau GHCR sedang bermasalah, cara lama tetap ada. Ia membangun image di server, jadi pakai di luar jam ramai:

```bash
cd /var/www/dailydose_v2 && ./update.sh
```

`update.sh` tanpa argumen memangkas cache build hanya seperlunya (maksimal 4 GB, atur lewat `BUILD_CACHE_KEEP`) dan
tidak lagi membuang container proyek lain.

## Cakupan tes

Gerbang sebelum membangun image: `pnpm typecheck`, tes unit API (tanpa database), dan tes web. Suite lengkap
(`.github/workflows/ci.yml`: tes integrasi dengan MySQL, Playwright, Dart, pemindaian rahasia) berjalan untuk
pull request dan push ke `main`, terpisah dari deploy.
