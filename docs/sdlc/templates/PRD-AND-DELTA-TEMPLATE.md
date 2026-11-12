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
