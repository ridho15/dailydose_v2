# Architecture: Daily Dose Pilates v2

Gambaran teknis sistem untuk developer yang melanjutkan pekerjaan. Kebutuhan produk ada di
[PRD.md](./PRD.md), aturan kerja di [Rules.md](./Rules.md), status terkini di [HANDOFF.md](./HANDOFF.md).

---

## 1. Ringkasan

Modular monolith dalam satu monorepo pnpm + Turborepo:

| Bagian | Teknologi | Lokasi |
| :--- | :--- | :--- |
| API | NestJS 11, Prisma 6, MySQL 8.4 | `apps/api` |
| Web (publik, member, workspace staf) | Next.js 15 (App Router), React 19, Tailwind CSS 4 | `apps/web` |
| Paket bersama | config, eslint-config, notification-core, test-utils | `packages/*` |
| Alat migrasi V1, UAT, harness | skrip TypeScript/Node | `tools/`, `apps/api/prisma/*.ts` |
| Infrastruktur | Docker, docker compose, GitHub Actions, GHCR | root, `.github/workflows` |

Satu image Docker menjalankan dua proses: API di port internal `32121`, web di `32120`. Web memanggil
API lewat `API_BASE_URL=http://127.0.0.1:32121`; browser memanggil `/api/v1/...` di domain yang sama.

## 2. Struktur API (`apps/api/src`)

| Modul | Isi utama |
| :--- | :--- |
| `identity` | Sesi login, Google login, peran dan kapabilitas (`role-capabilities.ts`), `PolicyService`, manajemen pengguna/pelanggan/instruktur, verifikasi selfie |
| `master` | Cabang, studio, ruangan, tipe kelas, Data Master efektif: fee instruktur, kuota & kapasitas (`konfigurasi-efektif.service.ts`) |
| `classes` | Slot kelas/timetable (`slot-kelas.service.ts`), hitungan terisi (`terisi.ts`), kuota minimum |
| `bookings` | Booking (`pemesanan-kelas.service.ts`), pembatalan terlambat, reschedule, ulasan instruktur, cabang paket (`cabang-paket.ts`) |
| `attendance` | Meja check-in, scan studio, presensi, no-show, laporan Owner |
| `packages` | Katalog paket, pembelian, pembayaran, ledger sesi, keuangan: ringkasan bulanan, laporan, settlement, modal sesi, transfer honor, koreksi jam, Excel (`xlsx-sederhana.ts`) |
| `dashboard` | Ringkasan workspace per peran |
| `notifications`, `email` | Gateway WhatsApp, kirim QR, template, SMTP |
| `scheduler` | Job berkala: `expire-orders` (15 menit), `expire-packages` (60 menit), `auto-cancel`, `reminders`, `check-in-qr` |
| `foundation` | Audit (`AuditService`), idempotensi, alasan wajib |
| `public-content`, `platform`, `operations`, `lifecycle`, `health` | CMS publik, konfigurasi situs, otomasi, siklus data, health check |

### Otorisasi
- Peran: `CUSTOMER`, `INSTRUCTOR`, `ADMIN`, `MANAGER`, `OWNER`, `SUPER_OWNER`, `FINANCE`. Pemetaan peran
  ke kapabilitas di `apps/api/src/identity/role-capabilities.ts`.
- Setiap handler wajib salah satu bukti akses (`route-access.spec.ts` memeriksanya): `@Public()`,
  `@SelfService()` (service membatasi ke `principal.userId`), `@Roles(...)`, atau service memanggil
  `policy.requireCapability(...)`.
- Cakupan cabang: `principal.branchIds`, kecuali kapabilitas `branch:all`.
- Kapabilitas yang ditambahkan selama pekerjaan ini: `instructor-review:read`,
  `booking:late-cancel:decide`, `owner-settlement:manage`. Transfer honor memakai `finance:export`;
  modal sesi memakai `master:read`/`master:manage` (baca juga `finance:read`).

## 3. Struktur web (`apps/web/app`)

- App Router. Halaman staf di `workspace/*`, `classes`, `master`, `instructors`, `finance`,
  `package-promotions`; member di `account`, `bookings/new`, `check-in-pass`; publik di `page.tsx`,
  `locations`, `contact`.
- Klien API per domain di `apps/web/app/api-clients/*-client.ts` (fungsi `apiFetch`/`foregroundFetch`).
- `session-context.tsx` memegang sesi, cabang aktif, `hasCapability`, dan peta rute ke kapabilitas.
- Komponen UI bersama: `components/actions.tsx` (Button), `components/forms.tsx`,
  `components/app-feedback.tsx` (Modal, Drawer, confirm, toast), `ui.tsx` (Feedback, Skeleton, Badge).
- Google Client ID bawaan: `apps/web/app/lib/google-client-id.ts` (client secret **tidak** disimpan di repo).

## 4. Data

### 4.1 Prisma dan MySQL
- Skema: `apps/api/prisma/schema.prisma`. Nama tabel memakai `@@map` snake_case. Pada 16 September 2026
  (commit `7c458f42`) 20 tabel diganti nama dari `v2_*` ke nama tanpa awalan.
- Produksi tidak memakai `prisma migrate`. `docker-entrypoint.sh` menjalankan
  `prisma db push --accept-data-loss` **hanya** bila berkas `/app/data/private/.bootstrapped_schema`
  belum ada atau `FORCE_DB_SYNC=true`, lalu menyeed master data bila belum ada cabang.
- Tabel baru setelah start pertama dibuat manual dengan SQL di [DEPLOY.md](./DEPLOY.md) bagian
  "Tabel baru".

### 4.2 Tabel baru dari pekerjaan ini (tanpa relasi Prisma)
| Tabel | Kegunaan |
| :--- | :--- |
| `ulasan_instruktur` | Ulasan member untuk instruktur per booking |
| `porsi_owner_cabang` | Porsi laba Super Owner per cabang (basis poin, total 10.000) |
| `pembayar_pengeluaran` | Pengeluaran yang dibayar uang pribadi Super Owner |
| `rekening_instruktur` | Rekening tujuan transfer honor (KlikBCA) |
| `modal_sesi` | Modal per sesi per cabang × tipe kelas, berlaku mulai tanggal |
| `kapasitas_kelas_cabang` | Kapasitas kelas per cabang × tipe kelas |
| `paket_bawa_teman` | Paket yang boleh membawa teman (`maksTeman`) |
| `booking_teman` | Penanda booking yang merupakan kursi teman |

Tabel dari developer lain di periode yang sama: `paket_pelanggan_anggota` (paket Duet/Family) dan kolom
`paket.is_shareable` (mengubah tabel lama; lihat HANDOFF).

Pola tanpa relasi: service mengambil data tabel baru dengan query terpisah dan menggabungkannya di
kode. Contoh: `bawa-teman.ts` (`maksTemanPaket`, `bookingTeman`), `modal-sesi.service.ts`
(`hitungModalSesi`). Fungsi helper memeriksa `typeof db.<model>?.findMany === 'function'` supaya test
dengan mock lama tetap berjalan.

### 4.3 Kolom lama yang sudah tidak dipakai
- `slot_kelas.instructorFeeRp` dan `slot_kelas.isManualFee`: tidak diisi dan tidak dibaca lagi. Fee
  selalu dari `instructor_fee`.
- `slot_kelas.bookedCount`: hanya cadangan. Angka terisi dihitung dari booking (`terisi.ts`).

## 5. Alur domain penting

### 5.1 Honor instruktur
`instructor-fee-calculator.ts`:
- `calculateSlotFee`: tarif `instructor_fee` versi terbaru yang berlaku pada tanggal kelas, cabang kelas
  lebih dulu, lalu cabang lain, lalu bawaan Rp150.000/jam. Jam = durasi dibulatkan, minimal 1.
- `summarizeInstructorFees`: hanya kelas dengan `instructorAttendance` masuk `totalFeeRp`; sisanya
  `unverifiedFeeRp`/`unverifiedClassCount`.
- Koreksi jam disimpan di `audit_log` (aksi `instructor.hours_adjusted`) dan masuk ke bulan kelasnya
  (`koreksiHonorDalamRentang`).
- Dipakai sama oleh payroll instruktur, laporan keuangan, performa cabang, dashboard, daftar instruktur,
  dan transfer honor.

### 5.2 Laba
- `ringkasan-keuangan.service.ts` (`ringkasanBulanan`): omzet dari pembelian `PAID` menurut `paidAt`,
  modal dari `hitungModalSesi` (`modal-sesi.service.ts`), pengeluaran dari `other_cost`.
  `profitRp = omset − modal − pengeluaran`. Payroll ikut dihitung sebagai informasi.
- `hitungModalSesi(db, { branchIds, fromDate, untilExclusive })`: booking berstatus `ATTENDED` atau
  `NO_SHOW` di kelas `COMPLETED` yang mulai dalam rentang; tiap booking = 1 sesi × tarif `modal_sesi`
  cabang dan tipe kelas kelas itu yang berlaku pada tanggal kelas (tipe kelas lebih dulu, lalu "semua
  tipe kelas"). Sesi tanpa tarif dihitung Rp0 dan dilaporkan (`sesiTanpaModal`). Kursi teman
  dihitung seperti sesi biasa.
- Settlement Super Owner (`settlement-owner.service.ts`) membagi `profitRp` per cabang menurut porsi,
  ditambah reimburse.
- `finance.service.ts` (`profitReport`, `ownerBranchPerformance`) dan `dashboard.service.ts` memakai
  rumus yang sama.

### 5.3 Booking
`pemesanan-kelas.service.ts` (`create`), dalam transaksi dengan kunci baris `slot_kelas FOR UPDATE`:
1. Validasi paket (milik member atau anggota paket bersama), status lunas, masa berlaku, cabang, tipe
   kelas, sisa sesi dikurangi booking aktif.
2. Cek duplikat: `count` booking member di kelas itu (BOOKED/ATTENDED). Bila > 0, boleh hanya bila
   paketnya ada di `paket_bawa_teman` dan jumlahnya ≤ `maksTeman`; booking ditandai di `booking_teman`.
3. Cek bentrok jadwal member dan kapasitas dari hitungan riil.
4. Buat booking, perbarui penghitung, audit bila dibuat staf.

`customerOptions` hanya menawarkan paket bawa teman kepada member yang sudah terdaftar, dan memberi
alasan `ALREADY_BOOKED` bila tidak ada.

### 5.4 Pembatalan terlambat
`pembatalan-terlambat.ts/.service.ts`: pembatalan kurang dari batas H-12 disimpan sebagai
`session_adjust_request` dengan reasonCode `LATE_CANCELLATION`, diputus pemegang
`booking:late-cancel:decide`. Pengaju tidak boleh memutus pengajuannya sendiri (kecuali Super Owner).

### 5.5 Check-in
`studio-scan.service.ts` (`pilihKelas`) memilih booking yang jendela pindainya terbuka dan belum
tercatat. Karena itu pindaian kedua QR member di kelas yang sama mencatat kursi teman.

### 5.6 Transfer honor KlikBCA
`transfer-honor.service.ts`: periode tanggal 1 sampai hari ini (WIB; tanggal 1 = bulan lalu),
honor = kelas ter-scan + koreksi, Excel ditulis tanpa dependensi (`xlsx-sederhana.ts`) dengan kolom
persis Template MAT Multi Payroll. BCA = tipe `BCA`, bank lain = `LLG` + SWIFT.

## 6. Deploy
- `.github/workflows/deploy.yml` ("Deploy production"): manual atau tag `v*`. Build image di GitHub,
  kirim ke `ghcr.io/ridho15/dailydose-v2-app`, server menarik image.
- Server: `/var/www/dailydose_v2`, `docker-compose.yml`, layanan `mysql` (8.4, port host 3315, volume
  `mysql-data`) dan `app` (port 32120, volume `private-uploads`, `public-uploads`). Konfigurasi di
  `.env.production`.
- Rollback:
  ```bash
  docker tag ghcr.io/ridho15/dailydose-v2-app:previous ghcr.io/ridho15/dailydose-v2-app:production
  docker compose up -d --no-build app
  ```
- Detail lengkap dan SQL tabel baru: [DEPLOY.md](./DEPLOY.md).

## 7. Zona waktu
- Operasional dan tampilan memakai zona waktu cabang (umumnya Asia/Jakarta).
- `finance-range.ts` memakai batas hari **UTC** untuk laporan bulanan (sama dengan dashboard lama).
  Periode transfer honor dihitung dari tanggal WIB.

## 8. Testing
| Perintah | Catatan |
| :--- | :--- |
| `cd apps/api && npx jest --selectProjects unit` | `app.module.spec.ts` gagal di lingkungan tanpa konfigurasi lengkap (`HEALTH_PROBE_TIMEOUT_MS`); abaikan |
| `cd apps/api && npx tsc --noEmit -p tsconfig.json` | Typecheck API |
| `cd apps/web && npx vitest run` | Test web |
| `cd apps/web && npx tsc --noEmit -p tsconfig.json` | Abaikan keluaran di `.next/` |
| `pnpm prisma:cek-jadwal` (di `apps/api`) | Pemeriksaan data jadwal setelah migrasi V1, hanya membaca |

Prettier: jalankan hanya pada berkas yang sudah rapi di HEAD, supaya diff tidak membengkak.
