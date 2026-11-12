# QA Test Matrix & UAT Sign-off Protocol

Matriks Pengujian Jaminan Mutu (*Quality Assurance*) dan Berita Acara Uji Keberterimaan Pengguna (*User Acceptance Testing*). Standar pengujian ketat berbasis **No Happy Path**, **Standar UI/UX ProMax**, dan **Verifikasi Dua Arah**.

---

## Bagian A: Matriks Pengujian Teknis QA (Standar UI & No Happy Path)

| Test ID | Modul / Komponen | Skenario Uji (Skenario Ekstrem & Edge Cases) | Kategori | Hasil yang Diharapkan | Status | Catatan Temuan |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **QA-01** | List Data & Tabel | Ketik kata kunci cepat di kolom pencarian, ubah filter status, dan klik halaman ke-3. | Standar UI | • Request terkirim debounced (300-500ms).<br>• URL query sinkron (`?page=3&search=...`).<br>• Loading skeleton tampil tanpa layout shift. | [ ] | |
| **QA-02** | Async Combobox | Buka dropdown relasi database, ketik kata kunci yang tidak ada, lalu ketik kata kunci yang valid. | Standar UI | • Menampilkan status loading spinner.<br>• Menampilkan pesan *"Data tidak ditemukan"* jika kosong.<br>• Keyboard ArrowUp/Down/Enter berfungsi lancar. | [ ] | |
| **QA-03** | Alert Deduplication | Kirim form dengan data tidak valid dan klik tombol submit 3x secara cepat (*rapid multi-click*). | No Happy Path | • Tombol submit langsung terkunci (*disabled*).<br>• Hanya 1 alert yang muncul di layar (*anti-double alert*).<br>• Alert memuat konteks aksi, alasan server, dan solusi. | [ ] | |
| **QA-04** | Confirm Modal | Klik aksi destruktif (Hapus / Batalkan Transaksi), tekan tombol `Escape`, lalu coba klik konfirmasi. | Standar UI | • Modal tampil menyebut nama/ID entitas secara spesifik.<br>• Tekan `Escape` menutup modal.<br>• Tombol konfirmasi terkunci state loading selama request. | [ ] | |
| **QA-05** | Aksesibilitas (A11y)| Navigasi modal hanya menggunakan keyboard (`Tab` dan `Shift+Tab`). | A11y | • Fokus Tab terkunci di dalam modal (*Focus Trap*).<br>• Latar belakang halaman tidak bisa di-scroll (*Scroll Lock*). | [ ] | |
| **QA-06** | RBAC Guardrails | Akses rute/tombol terlarang menggunakan akun dengan role User biasa. | Security | • Tombol aksi tidak dirender atau disabled.<br>• Akses rute langsung mengarah ke halaman `403 Forbidden` ramah pengguna. | [ ] | |
| **QA-07** | Session Expiry | Biarkan token auth kedaluwarsa lalu kirim mutasi data di halaman form. | No Happy Path | • Request ditolak dengan ramah (401).<br>• Data isian form dipertahankan (tidak hilang).<br>• User diarahkan ke login atau refresh token tanpa crash. | [ ] | |
| **QA-08** | Zero Data-Loss DB | Jalankan migrasi pada database yang telah berisi jutaan baris data eksisting. | Brownfield DB | • Tidak ada data lama yang terpotong (*truncated*) atau hilang.<br>• Nilai default terpasang rapi pada kolom baru. | [ ] | |

---

## Bagian B: Lembar Pengujian UAT Bisnis (User Acceptance Testing)

| UAT ID | Kebutuhan Alur Bisnis | Langkah Pengujian Pengguna | Kriteria Kelulusan Bisnis | Status (Pass/Fail) | Catatan Pengguna |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **UAT-01** | Pembuatan Data & Validasi | Buka form transaksi baru, pilih relasi dari dropdown, simpan data. | Data berhasil tersimpan dan langsung tampil di halaman list data teratas. | [ ] | |
| **UAT-02** | Pencarian & Filter Cepat | Cari data transaksi bulan lalu berdasarkan nama pelanggan. | Data terfilter akurat dalam waktu kurang dari 1 detik. | [ ] | |
| **UAT-03** | Pembatalan Transaksi | Batalkan transaksi salah input melalui konfirmasi persetujuan. | Status transaksi berubah menjadi Batal dan tercatat di riwayat audit. | [ ] | |

---

## Bagian C: Berita Acara & Tanda Tangan UAT (Sign-off Protocol)

Dokumen ini menyatakan bahwa seluruh fitur dan aturan tata kelola antarmuka telah diuji dan memenuhi standar kualitas yang ditetapkan:

- **Versi Rilis / Build:** `v1.0.0-rc`
- **Tanggal Pengujian:** ____________________
- **Hasil Akhir:** [ ] DITERIMA PENUH / [ ] DITERIMA BERSYARAT / [ ] DITOLAK

| Pihak Penguji | Nama Lengkap | Jabatan | Tanda Tangan / Persetujuan |
| :--- | :--- | :--- | :--- |
| **Quality Assurance Lead** | _______________________ | QA Engineer | [ ] Approved |
| **Technical Lead / Architect** | _______________________ | Lead Developer | [ ] Approved |
| **Product Owner / Klien** | _______________________ | Stakeholder | [ ] Approved |
