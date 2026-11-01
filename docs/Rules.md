# Rules: aturan kerja Daily Dose Pilates v2

Aturan yang wajib diikuti siapa pun (developer atau agen AI) yang mengubah repositori ini. Aturan bisnis
yang dikunci pemilik ada di bagian 1 dan 2; aturan teknis di bagian 3 sampai 6.

Lihat juga: [PRD.md](./PRD.md), [Architecture.md](./Architecture.md), [HANDOFF.md](./HANDOFF.md).

---

## 1. Database

1. **Jangan mengubah database yang sudah ada.** Jangan `ALTER`, `DROP`, atau mengganti nama tabel/kolom
   lama. Fitur baru memakai **tabel baru tanpa relasi Prisma** ke tabel lama; gabungkan datanya di kode.
2. Setiap tabel baru wajib ditulis SQL `CREATE TABLE`-nya di [DEPLOY.md](./DEPLOY.md) bagian
   "Tabel baru" pada commit yang sama. Ambil SQL dari
   `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
3. **Jangan pernah** menjalankan `prisma db push --accept-data-loss` atau deploy dengan
   `FORCE_DB_SYNC=true` ke database berisi data tanpa backup dan tanpa memeriksa isi tabel dulu.
4. Bila database produksi dikosongkan, hapus juga `/app/data/private/.bootstrapped_schema` sebelum
   restart; kalau tidak, skema tidak dibuat dan API gagal (`table user_session does not exist`).
5. Selalu backup (`mysqldump --single-transaction`) sebelum menjalankan SQL di produksi.
6. Kolom `slot_kelas.instructorFeeRp`, `slot_kelas.isManualFee`, dan `slot_kelas.bookedCount` tidak
   boleh dijadikan sumber kebenaran lagi (lihat Architecture 4.3).

## 2. Kerahasiaan data keuangan

| Peran | Boleh melihat |
| :--- | :--- |
| Admin, Manager | Omzet **cabangnya sendiri** saja. Tanpa fee instruktur, modal, payroll, pengeluaran total, atau laba. Koreksi jam: jumlah jam, tanpa rupiah. |
| Instruktur | Honor **dirinya sendiri** saja, dari kelas selesai yang sudah di-scan QR. Tanpa fee instruktur lain. |
| Customer | Tidak melihat fee atau angka keuangan studio apa pun. |
| Owner | Laporan cabang yang dimilikinya. |
| Super Owner, Finance | Semua cabang. Data Master fee/modal hanya Super Owner (`master:manage`). |

Aturan teknis yang menyertainya:
- Sembunyikan di **API**, bukan hanya di layar. Data yang terkirim ke browser dianggap terlihat.
- Nominal honor hanya untuk pemegang `instructor:fee:read` atau `finance:read`.
- Endpoint baru wajib memeriksa kapabilitas di service dan membatasi cabang dengan `principal.branchIds`
  (kecuali `branch:all`). `route-access.spec.ts` harus tetap lulus.
- Timetable dan form kelas **tidak boleh** memuat fee/honor.

## 3. Aturan bisnis yang sudah diputuskan

1. Fee instruktur hanya dari Data Master (per instruktur × cabang × tipe kelas, berlaku mulai tanggal).
2. Honor dibayar dan dihitung **hanya** dari kelas yang presensi instrukturnya tercatat (scan QR atau
   verifikasi).
3. Laba = omzet − modal sesi − pengeluaran. Modal sesi = sesi member yang terpakai (hadir/tidak hadir)
   di kelas selesai bulan itu × modal per sesi; sesi hangus tidak punya modal. Payroll tidak mengurangi
   laba.
4. Sesi member dipotong saat kelas selesai dan member hadir, bukan saat booking.
5. Batas pembatalan H-24 jam. Pembatalan staf kurang dari H-24 menjadi pengajuan yang diputus
   Manager, Owner, atau Super Owner. `BOOKING_CANCELLATION_CUTOFF_HOURS` di produksi harus 24.
6. Satu member satu kursi per kelas, kecuali paket "bawa teman" (1 kursi teman, memakai 1 sesi).
   Presensi member dan instruktur dilakukan dengan staf memindai QR.
7. Kapasitas kelas dari Data Master > Kuota & Kapasitas berlaku untuk kelas baru dan kelas mendatang.
8. Paket berlaku di cabang paket atau cabang tempat dibeli.
9. Perubahan penting (keuangan, rekening, porsi, pembatalan, koreksi) dicatat di `audit_log`;
   nomor rekening disamarkan di audit.

Asumsi yang belum dikonfirmasi pemilik tercantum di [PRD.md](./PRD.md#6-perlu-konfirmasi-asumsi-saat-membangun).
Jangan mengubahnya diam-diam; tanyakan ke pemilik.

## 4. Kode dan pengujian

1. Ikuti gaya kode sekitar: nama domain dalam bahasa Indonesia (mis. `kursiTeman`, `modalSesi`),
   komentar seperlunya, penjelasan "mengapa" bukan "apa".
2. Teks antarmuka dalam bahasa Indonesia yang lugas (landing page publik dalam bahasa Inggris).
3. Sebelum push:
   - `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx jest --selectProjects unit`
   - `cd apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run`
   - Kegagalan `app.module.spec.ts` karena konfigurasi lingkungan boleh diabaikan; kegagalan lain harus
     diperbaiki atau dilaporkan.
4. Tambahkan test untuk setiap aturan bisnis baru (contoh: `bookings-duplicate.spec.ts`,
   `modal-sesi.service.spec.ts`, `transfer-honor.service.spec.ts`).
5. Bila mengubah query yang dipalsukan test lain (mis. `findFirst` menjadi `count`), sesuaikan mock-nya
   tanpa mengubah maksud test.
6. Jalankan Prettier hanya pada berkas yang sudah rapi di HEAD; jangan memformat ulang berkas orang lain.
7. Jangan menyimpan rahasia (client secret Google, kata sandi DB, token WhatsApp) di repo.

## 5. Git

1. Branch kerja: `perbaikan_arsitektur`. `main` sudah lama tertinggal.
2. Developer lain juga mendorong ke branch yang sama. Sebelum push: `git fetch`, lalu **merge**
   (bukan rebase atau force-push). Selesaikan konflik dengan mempertahankan kedua fitur bila keduanya sah.
3. Pesan commit: format `tipe(lingkup): ringkasan` dalam bahasa Indonesia, isi menjelaskan alasan,
   menyebut tabel baru dan SQL-nya bila ada.
4. Jangan commit berkas hasil generate lokal (mis. perubahan `apps/web/next-env.d.ts` dari `next dev`).
5. Jangan mencantumkan ID model AI di commit, PR, atau kode.

## 6. Komunikasi dengan pemilik dan tim

1. Balas pemilik dalam bahasa Indonesia; jelaskan dampak, bukan detail kode.
2. Teks untuk WhatsApp: singkat, langsung ke poin, **tanpa emoji**.
3. Sebelum menjalankan sesuatu di server produksi, minta hasil pemeriksaan (read-only) dulu, baru beri
   SQL perbaikan sesuai kasus.
4. Bila sebuah permintaan bisa dibaca dua cara dan berdampak ke uang atau data, tanyakan dulu atau
   bangun versi yang paling aman lalu sebutkan asumsinya dengan jelas.
