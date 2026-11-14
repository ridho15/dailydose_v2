# Product Requirements Document (PRD & Delta-PRD)

Dokumen Spesifikasi Kebutuhan Produk & Manajemen Perubahan Arsitektur (*Greenfield & Brownfield*). Wajib mematuhi standar **Ponytail (Modular & Minimal Diff)**, **Antislop (Zero Placeholder)**, **UI/UX ProMax (Tailwind CSS)**, dan **No Happy Path (Defensive Engineering)**.

---

## 1. Ringkasan Eksekutif & Informasi Proyek
- **Nama Aplikasi / Modul:** [Contoh: Enterprise CRM & Order Orchestration]
- **Mode Siklus SDLC:** [Greenfield (Setup Baru dari Nol) / Brownfield (Melanjutkan Project)]
- **Tech Stack Utama:** [Contoh: Next.js 15 (App Router) + Tailwind CSS v4 / Laravel 11 + Inertia React]
- **Database Engine:** [PostgreSQL 16 / MySQL 8 / SQLite]
- **Target Pengguna:** [Internal Admin, Sales Manager, End-User Customer]
- **Tujuan Bisnis Utama:** [Deskripsi singkat hasil bisnis yang ingin dicapai]
- **Hasil Terukur:** [Angka, status, atau perilaku yang bisa diamati; hindari tujuan kabur seperti "buat lebih baik"]
- **Kriteria Selesai:** [Daftar butir yang masing-masing bisa dibuktikan dengan tes atau pengamatan]
- **Ruang Lingkup:** [Modul, halaman, dan peran yang termasuk]
- **Non-goals:** [Hal yang sengaja tidak dikerjakan]
- **Profil Proyek:** [Prototipe / Internal / Produksi / Terregulasi-keuangan] dan alasannya; menentukan kedalaman kontrol (butir SEC "Tidak berlaku", luas matriks QA), bukan ada tidaknya gerbang bukti dan keamanan dasar (lihat `COMPLEXITY-DECISIONS-TEMPLATE.md`)
- **Persetujuan PRD:** [Nama penyetuju, tanggal, versi/revisi] (lihat `PLAN-AND-GOAL-TEMPLATE.md`)

---

## 2. Role-Based Access Control (RBAC) Matrix
Setiap endpoint API, tombol UI, dan rute navigasi wajib terikat pada matriks otorisasi:

| Role | Cakupan Akses Modul | Hak Akses Create | Hak Akses Read | Hak Akses Update | Hak Akses Delete | Tindakan Destruktif / Persetujuan Khusus |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Superadmin** | Seluruh Sistem | ✅ | ✅ (All Data) | ✅ | ✅ | Unlock user, Reset DB, Audit Trail |
| **Admin** | Modul Operasional & Master | ✅ | ✅ (Branch) | ✅ | ⚠️ (Soft Delete) | Perlu Approval Superadmin |
| **User / Operator**| Modul Transaksi Pribadi | ✅ | ✅ (Own Data) | ⚠️ (Draft Only)| ❌ | Tidak Memiliki Hak Hapus |

---

## 3. Spesifikasi Fitur & No-Happy-Path Acceptance Criteria
Setiap User Story wajib mendefinisikan skenario kegagalan (*No Happy Path*) secara eksplisit:

| ID | Fitur / User Story | Alur Utama (Happy Path) | No Happy Path: Validasi & Error Teknis | Penanganan UI & Solusi Pengguna |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | Input Transaksi Baru | User mengisi form lengkap, memilih relasi via async combobox, klik submit, data tersimpan. | • Koneksi putus saat submit<br>• Klik submit berkali-kali cepat (double submit)<br>• Stok barang habis di database saat transaksi diproses | • Tombol submit langsung terkunci dengan loading spinner.<br>• Alert deduplikasi tampil: *"Gagal membuat transaksi: Stok produk 'SKU-01' habis. Perbarui kuantitas keranjang."* |
| **F-02** | Hapus Data Master | User mengklik tombol Hapus pada baris tabel, data terhapus. | • Data masih memiliki referensi di tabel transaksi (Foreign Key Constraint 409)<br>• Token sesi kedaluwarsa (401) | • Modal konfirmasi wajib tampil menyebut nama item.<br>• Muncul alert spesifik: *"Tidak dapat menghapus: Data masih digunakan pada 12 transaksi aktif."* |

---

## 4. Matriks Kepatuhan Standar UI & Data
Semua tampilan halaman antarmuka wajib menerapkan 4 pilar tata kelola:

| Nama Halaman / Rute | Strategi List Data (Server Pagination / Cursor Lazy) | Kolom Search (Debounced 350ms) & Multi-Filter | Dynamic Async Combobox (Relasi DB) | Aksi Wajib Modal Konfirmasi |
| :--- | :--- | :--- | :--- | :--- |
| `/orders` | Server Pagination (10, 25, 50/hal) | Pencarian: No Order, Nama Customer. Filter: Status, Tanggal. | Pilihan Customer, Pilihan Outlet | Hapus Order, Batalkan Transaksi, Cetak Ulang |
| `/users` | Server Pagination (10, 25/hal) | Pencarian: Nama, Email. Filter: Role, Status Aktif. | Pilihan Role, Pilihan Departemen | Nonaktifkan Akun, Hapus User, Reset Password |


### 4.1 Matriks Verifikasi Data (Informasi yang Ditampilkan)
Setiap angka, status, tanggal, atau informasi yang muncul di layar wajib terdaftar di sini **sebelum dibangun**. Kolom "Cara Verifikasi" harus berupa query, tes, atau langkah yang bisa diulang, bukan "dicek manual".

| ID | Halaman / Komponen | Informasi yang Ditampilkan | Sumber Data (tabel.kolom / API) | Aturan Hitung & Format (rumus, pembulatan, zona waktu, mata uang) | Cara Verifikasi | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **DV-01** | `/orders` toolbar | Total data ("dari N data") | `GET /api/orders` -> `totalItems` | Hitung baris setelah filter dan pencarian diterapkan | Tes Playwright: angka di layar sama dengan `totalItems` API; `SELECT COUNT(*)` dengan filter yang sama | [ ] |
| **DV-02** | `/orders` kolom Total | Nilai transaksi | `orders.total_amount` | Rupiah, tanpa desimal, pemisah ribuan titik; jumlah detail item sama dengan header | Bandingkan dengan `SUM(order_items.subtotal)` per order | [ ] |
| **DV-03** | `/orders` kolom Tanggal | Tanggal transaksi | `orders.created_at` (UTC) | Tampil di zona waktu pengguna (WIB), format `DD MMM YYYY HH:mm` | Uji dengan data pukul 23:30 UTC agar pergantian hari terlihat | [ ] |
| **DV-04** | `/orders` badge Status | Status transaksi | `orders.status` | Pemetaan kode ke label dan warna sesuai PRD; status tak dikenal tampil "Tidak diketahui", bukan kosong | Uji semua nilai enum plus nilai di luar enum | [ ] |

### 4.2 Titik Verifikasi per Tahap Data
Data harus diperiksa di setiap perpindahan, bukan hanya di akhir.

| Tahap | Pemeriksaan Wajib | Bukti |
| :--- | :--- | :--- |
| **Input** (form, impor, API masuk) | Validasi skema di klien dan server; tolak field tak dikenal; normalisasi (trim, huruf besar/kecil, format tanggal); batas panjang dan rentang nilai | Tes validasi dengan payload kosong, terlalu panjang, tipe salah, dan nilai ekstrem |
| **Proses** (hitung, transformasi) | Rumus sesuai PRD; pembulatan konsisten; operasi uang memakai tipe desimal, bukan float; transaksi atomik (ACID) | Tes unit dengan angka acuan hasil hitung manual |
| **Simpan** (database) | Rekaman benar-benar tersimpan: baca ulang dari database setelah mutasi; constraint dan foreign key aktif; tidak ada data parsial saat gagal | Tes integrasi: tulis lalu baca ulang; simulasi gagal di tengah transaksi |
| **Tampil** (UI, API keluar) | Nilai di layar sama dengan sumber; format (tanggal, mata uang, angka) sesuai matriks 4.1; data kosong dan null punya tampilan jelas; tidak menampilkan data milik pihak lain | Tes Playwright: bandingkan layar dengan respons API; muat ulang dan bandingkan lagi |
| **Ekspor / Laporan** | Total laporan sama dengan total layar; jumlah baris sama; filter yang sama menghasilkan data yang sama | Rekonsiliasi: hitung ulang dari database dan bandingkan dengan berkas ekspor |

---

## 5. Safe Database Schema Migration Diff (Zero Data-Loss)
Khusus perubahan skema database pada proyek berjalan (*Brownfield*) atau modul baru:

| Nama Tabel | Perubahan Kolom | Tipe Data & Constraint | Nullable / Default | Strategi Migrasi Aman | Rencana Rollback |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `orders` | Tambah `cancellation_reason` | `VARCHAR(255)` | `NULLABLE` (Aman untuk data lama) | Tambahkan kolom secara aditif tanpa mengunci tabel (*concurrent/safe migration*). | `ALTER TABLE orders DROP COLUMN cancellation_reason;` |
| `users` | Ubah relasi `role_id` | `UUID REFERENCES roles(id)` | `NOT NULL DEFAULT 'default-uuid'` | Berikan default UUID agar baris eksisting tidak melanggar constraint. | Kembalikan foreign key ke integer jika diperlukan. |

---

## 6. Non-Functional Requirements & Security
- **Anti-Double Submit:** Tombol aksi form wajib disabled dengan state `isLoading` begitu request asinkron dikirim.
- **Deduplikasi Notifikasi:** Gunakan deterministic hash `[type]:[actionContext]:[rootCause]` agar alert kembar tidak menumpuk di layar.
- **Pencarian URL-Synced:** Nilai `page`, `limit`, `search`, dan `filter` wajib tersinkronisasi ke URL Query Parameter agar dapat di-bookmark dan di-refresh tanpa kehilangan status.
- **Aksesibilitas (A11y):** Modal dialog wajib mendukung keyboard navigation (`Escape` untuk batal, `Tab` focus trap).

### 6.1 Checklist Keamanan (berbasis OWASP Top 10)
Setiap butir wajib diberi status (Ya / Tidak berlaku + alasan) sebelum PRD disetujui.

| ID | Risiko | Kontrol Wajib | Status |
| :--- | :--- | :--- | :---: |
| **SEC-01** | Broken Access Control / IDOR | Otorisasi diperiksa **di server** pada setiap endpoint dan setiap ID objek (bukan hanya menyembunyikan tombol). Akses ke data milik user/tenant lain dijawab `403`/`404`. | [ ] |
| **SEC-02** | Injeksi (SQL/NoSQL/Command) | Query terparameterisasi atau ORM; tidak ada string-concat ke query. Validasi skema di server (Zod/Joi/FormRequest), tolak field tak dikenal. Akun DB memakai *least privilege*. | [ ] |
| **SEC-03** | XSS | Output di-escape secara default; larangan `innerHTML` / `dangerouslySetInnerHTML` / `v-html` / `{!! !!}` kecuali HTML disanitasi (mis. DOMPurify). Terapkan `Content-Security-Policy`. | [ ] |
| **SEC-04** | CSRF | Cookie sesi `SameSite=Lax/Strict`; mutasi berbasis cookie wajib memakai token CSRF atau pemeriksaan `Origin`. | [ ] |
| **SEC-05** | Autentikasi & Sesi | Token sesi di cookie `HttpOnly` + `Secure` (hindari `localStorage`); kedaluwarsa dan rotasi; hash password dengan argon2/bcrypt; rate limiting + penguncian bertahap pada login dan reset password. | [ ] |
| **SEC-06** | Security Misconfiguration | Header: `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Strict-Transport-Security` (HTTPS). Mode debug dan stack trace mati di produksi. | [ ] |
| **SEC-07** | Secret & Konfigurasi | Tidak ada secret/API key di repo atau bundle klien; `.env` masuk `.gitignore`; secret berbeda per lingkungan dan dapat dirotasi. | [ ] |
| **SEC-08** | Komponen Rentan | `npm audit` (atau setara) lulus di CI; pembaruan dependensi otomatis (Dependabot/Renovate); lockfile di-commit. | [ ] |
| **SEC-09** | Logging & Audit | Aksi sensitif (login, ubah role, hapus data) tercatat dengan siapa/kapan/apa; log tidak memuat password, token, atau data pribadi. | [ ] |
| **SEC-10** | Unggah File & SSRF | Batasi tipe dan ukuran file, periksa isi (bukan hanya ekstensi), simpan di luar webroot; URL yang diambil server divalidasi dengan allowlist. | [ ] |
