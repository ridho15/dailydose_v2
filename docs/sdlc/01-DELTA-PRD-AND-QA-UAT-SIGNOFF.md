# Phase 1 & Phase 6: Delta-PRD, Compliance Fixes, & QA/UAT Verification Record

**Proyek:** `dailydose-v2` (Daily Dose Pilates)  
**Mode SDLC:** `BROWNFIELD_CONTINUE_EXISTING` (`PROGRESSIVE_BOY_SCOUT_RULE`)  
**Tanggal Pembaruan:** `2026-11-12`  
**Rujukan Audit:** [00-BROWNFIELD-AUDIT.md](./00-BROWNFIELD-AUDIT.md)

---

## Bagian A: Delta-PRD Perubahan Siklus Ini

### 1. Tujuan & Masalah yang Diselesaikan
1. **Standardisasi SDLC ProMax Kit:** Menetapkan kontrak kerja `sdlc-promax-kit` secara permanen di repo (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.agent/`, `.claude/`, `docs/sdlc/sdlc-config.json`), termasuk aturan **Completion Gate** yang melarang klaim selesai atau rekomendasi perintah CLI tanpa eksekusi langsung pasca-edit terakhir beserta bukti observasi nyata.
2. **Boy Scout Fix `QA-03` Anti-Double Alert (`PackageLifecycleEditor`):** Menghapus panggilan ganda `feedback.showToast({ tone: 'danger', ... })` di [package-promotion-detail-view.tsx](../../apps/web/app/package-promotions/package-promotion-detail-view.tsx) agar error mutasi revisi komersial paket hanya menampilkan tepat satu inline `AlertBanner`.
3. **Kompatibilitas Windows Non-Docker & Isolasi Port `.env`:**
   - Memperbaiki [apps/web/package.json](../../apps/web/package.json) (`dev`) agar memakai Node `spawnSync` lintas-platform (tidak lagi sintaks shell POSIX `NEXT_DIST_DIR=.next-dev ... ${WEB_PORT:-32120}`).
   - Memperbaiki [package.json](../../package.json) (`ports:clean`) agar membaca `WEB_PORT` & `PORT` dari `.env` (`32220` & `32221`) dan memakai `Get-NetTCPConnection` di Windows sehingga proses lain di port `32120`/`32121` tidak pernah tersentuh.
   - Memperbaiki [tools/db-fresh.ts](../../tools/db-fresh.ts) dan [apps/api/prisma/fresh.ts](../../apps/api/prisma/fresh.ts) untuk Windows Node 24: konversi `pathToFileURL(...).href` pada flag ESM `--import` serta isolasi `@prisma/client` di child process `--internal-drop` agar `query_engine-windows.dll.node` terlepas sebelum `prisma generate` berjalan (mencegah error `EPERM` saat `pnpm db:fresh:seed`).

---

## Bagian B: Hasil Verifikasi Pasca-Edit Terakhir (Observed Evidence)

Seluruh pemeriksaan di bawah ini dieksekusi langsung di lingkungan Windows lokal (`dailydose_local` di MySQL `127.0.0.1:3306`, Web `:32220`, API `:32221`):

| Pemeriksaan | Perintah Aktual | Waktu Relatif terhadap Edit | Hasil Teramati |
| :--- | :--- | :--- | :--- |
| **Prettier (`--end-of-line auto` pada file yang disentuh)** | `pnpm exec prettier --check --end-of-line auto ...` (+ format `fresh.ts`) | Pasca-edit semua file | **PASS** (exit `0`; catatan: `pnpm format:check` penuh masih memperingatkan CRLF Windows & file `.agents/skills/` bawaan repo) |
| **API Typecheck** | `pnpm --filter @dailydose/api typecheck` | Pasca-edit terakhir (`fresh.ts`) | **PASS** (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.seed.json --noEmit`, exit `0`) |
| **Web Typecheck** | `pnpm --filter @dailydose/web typecheck` | Pasca-edit Web (`package-promotion-detail-view.tsx`, `package.json`) | **PASS** (`tsc --noEmit`, exit `0`) |
| **API Unit Tests** | `pnpm --filter @dailydose/api test:unit -- src/identity/credential-security.spec.ts` | Pasca-edit kode aplikasi (sebelum refactor CLI `fresh.ts`) | **PASS** (`147/147` suites, `1227/1227` tests, `74.345s`, exit `0`; run paralel sebelumnya 146/147 dengan 1 timeout `5000ms` di `credential-security.spec.ts`) |
| **Web Vitest Terarah** | `vitest run` (`package-promotions`, `package-promotion-client`, `public-header`, `ulasan-view`, `refund.test.tsx`) | Pasca-edit Web terakhir | **PASS** (`5/5` file, `19/19` tests: `4/5` lulus serentak + `refund.test.tsx` lulus `2/2` dalam `2.74s` saat dijalankan terpisah) |
| **Migrasi & Seeding DB Lokal** | `pnpm db:fresh:seed` + query MySQL `dailydose_local` | Pasca-edit terakhir (`fresh.ts`) | **PASS** (exit `0`: drop `54` tabel via `--internal-drop`, `prisma db push` `6.87s`, `prisma generate` `516ms`, seed 6 tahap; row check: `cabang=5`, `paket=4`, `user=13`, `refund_paket=0`, `total_tables=54`) |
| **Full-Stack Dev Server & Playwright E2E** | `node .../scratch/verify-sdlc-final.mjs` (menjalankan `pnpm dev` root) | Pasca-edit terakhir (eksekusi paling akhir) | **PASS** (6/6 check, exit `0`, `0` `pageerror`, `0` HTTP `>=500`, port `32120`/`32121` PID `30276`/`3936` tetap utuh sebelum/selama/sesudah run) |

### Rincian Check Playwright atas `pnpm dev` (`verify-sdlc-final.mjs`)

1. **`REG-PORTS-ISOLATION` (PASS):** `pnpm dev` mengaktifkan Web di `:32220` (`PID 36420`) dan API di `:32221` (`PID 10332`); port eksternal `:32120` (`PID 30276`) & `:32121` (`PID 3936`) tetap utuh sebelum, selama, dan sesudah pengujian, dan port `32220`/`32221` bersih kembali setelah shutdown (`{}`).
2. **`REG-LOCAL-PROXY` (PASS):** Rewrite `/api/v1/public/site-config`, `/api/v1/public/class-catalog`, `/api/v1/public/packages` seluruhnya HTTP `200` (`branchCount: 5`, `siteClassCount: 4`).
3. **`REG-LOCAL-OWNER-AUTH` (PASS):** Login `ralamzah@gmail.com` berhasil ke `/workspace`; `/api/v1/operations/health` mengembalikan `200` dengan `status: READY` pada komponen `api`, `database`, `private-storage`, dan `payment-proof-scanner`.
4. **`QA-03-SINGLE-ALERT` (PASS):** Pada `/workspace/packages/20000000-0000-4000-8000-000000000004` (`PK-V1-4`), submit revisi paket dengan `effectiveUntil < effectiveFrom` menghasilkan HTTP `422`, `dialogAlertCount: 1`, `toastDangerCount: 0`, dan `appAlertCount: 1` (satu-satunya `[role="alert"]` lain di DOM adalah elemen kosong bawaan Next.js `#__next-route-announcer__`).
5. **`REG-LOCAL-CUSTOMER-AUTH` (PASS):** Login `cindyedelene@gmail.com` berhasil mendarat di `/account` dengan `/api/v1/me/dashboard` HTTP `200` terhidrasi lengkap.
6. **`REG-LOCAL-STABILITY` (PASS):** `pageErrors: []`, `server500s: []`.

---

## Bagian C: Matriks QA 8-Poin & Status Sign-Off

| Test ID | Modul / Kontrak | Status Saat Ini | Bukti / Catatan Kejujuran |
| :--- | :--- | :---: | :--- |
| **QA-01** | Data Table & Pagination | `[~]` Belum diulang pasca-edit final | Diverifikasi sebelumnya pada modul paket (`packages-management-view.tsx`); modul lain diselaraskan bertahap sesuai Boy Scout Rule. |
| **QA-02** | Async Combobox (`AsyncSearchSelect`) | `[N/A]` | `SelectInput` pada modul paket hanya memuat <=5 opsi statis; komponen referensi siap di `docs/sdlc/ui-standards-reference/AsyncSearchSelect.tsx`. |
| **QA-03** | Alert Deduplication (Anti-Double Alert) | `[x]` **PASS (Post-Edit)** | Terverifikasi langsung di Chromium terhadap `pnpm dev` (`dialogAlertCount: 1`, `toastDangerCount: 0`, HTTP `422`) + screenshot `01-qa03-single-alert.png`. |
| **QA-04** | Confirmation Modal (`Escape` & Loading Lock) | `[~]` Belum diulang pasca-edit final | Tercakup dalam Vitest `packages-management-view.test.tsx` (`7/7` PASS pasca-edit) dan terkonfirmasi secara visual pada dialog konfirmasi revisi; pengujian penuh `Escape` + modal hapus berasal dari run pra-edit. |
| **QA-05** | Aksesibilitas Modal (Focus Trap / Scroll Lock) | `[~]` Parsial | Menggunakan komponen bersama `Modal`/`Drawer` di `apps/web/app/components/app-feedback.tsx` yang mendaftarkan ESC listener & focus restoration; tidak diaudit axe terpisah pasca-edit. |
| **QA-06** | RBAC Guardrails | `[~]` Belum diulang pasca-edit final | Diuji pada run pra-edit (`403` untuk Instructor); unit test otorisasi API (`route-authorization.spec.ts`) lulus pada `147/147` API unit suite. |
| **QA-07** | Session Expiry (`401`) | `[~]` Belum diulang pasca-edit final | Diuji `401` pada run pra-edit; belum diulang dalam skrip pasca-edit `verify-sdlc-final.mjs`. |
| **QA-08** | Zero Data-Loss DB & Optional Table Guard | `[x]` **PASS (Fresh Sync)** | `pnpm db:fresh:seed` lulus `0` di Windows (`54` tabel); unit test `tabel-opsional.spec.ts` lulus dalam `147/147` API unit suite (`503 DATABASE_TABLE_MISSING` sudah diuji pada run pra-edit). |

---

## Bagian D: Berita Acara Pengujian & Tata Kelola Berkelanjutan

- **Target Lingkungan Teruji:** Lokal Non-Docker Windows (`127.0.0.1:32220` / `127.0.0.1:32221` / MySQL `dailydose_local`). Belum di-push ke remote git dan belum dideploy ke server production.
- **Status Kepatuhan `sdlc-promax-kit`:** **AKTIF & KONSISTEN MULAI SEKARANG**
  - Kontrak aturan: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.agent/skills/app-setup-blueprint-promax/SKILL.md`, `.claude/skills/app-setup-blueprint-promax/SKILL.md`, `docs/sdlc/sdlc-config.json`.
  - Setiap perubahan fitur/bugfix berikutnya wajib mengikuti Phase 0-6 + Boy Scout Rule + Completion Gate berbasis bukti nyata pasca-edit terakhir.

