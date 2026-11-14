# QA Test Matrix & UAT Sign-off Protocol

Matriks Pengujian Jaminan Mutu (*Quality Assurance*) dan Berita Acara Uji Keberterimaan Pengguna (*User Acceptance Testing*). Standar pengujian ketat berbasis **No Happy Path**, **Standar UI/UX ProMax**, dan **Verifikasi Dua Arah**.

---

## Bagian A: Matriks Pengujian Teknis QA (Standar UI & No Happy Path)

| Test ID | Modul / Komponen | Skenario Uji (Skenario Ekstrem & Edge Cases) | Kategori | Hasil yang Diharapkan | Status | Catatan Temuan | Bukti (perintah + hasil / path screenshot, trace, laporan) | Commit / Build | Terverifikasi oleh (nama, tanggal) |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **QA-01** | List Data & Tabel | Ketik kata kunci cepat di kolom pencarian, ubah filter status, dan klik halaman ke-3. | Standar UI | • Request terkirim debounced (300-500ms).<br>• URL query sinkron (`?page=3&search=...`).<br>• Loading skeleton tampil tanpa layout shift. | [ ] | | | | |
| **QA-02** | Async Combobox | Buka dropdown relasi database, ketik kata kunci yang tidak ada, lalu ketik kata kunci yang valid. | Standar UI | • Menampilkan status loading spinner.<br>• Menampilkan pesan *"Data tidak ditemukan"* jika kosong.<br>• Keyboard ArrowUp/Down/Enter berfungsi lancar. | [ ] | | | | |
| **QA-03** | Alert Deduplication | Kirim form dengan data tidak valid dan klik tombol submit 3x secara cepat (*rapid multi-click*). | No Happy Path | • Tombol submit langsung terkunci (*disabled*).<br>• Hanya 1 alert yang muncul di layar (*anti-double alert*).<br>• Alert memuat konteks aksi, alasan server, dan solusi. | [ ] | | | | |
| **QA-04** | Confirm Modal | Klik aksi destruktif (Hapus / Batalkan Transaksi), tekan tombol `Escape`, lalu coba klik konfirmasi. | Standar UI | • Modal tampil menyebut nama/ID entitas secara spesifik.<br>• Tekan `Escape` menutup modal.<br>• Tombol konfirmasi terkunci state loading selama request. | [ ] | | | | |
| **QA-05** | Aksesibilitas (A11y)| Navigasi modal hanya menggunakan keyboard (`Tab` dan `Shift+Tab`). | A11y | • Fokus Tab terkunci di dalam modal (*Focus Trap*).<br>• Latar belakang halaman tidak bisa di-scroll (*Scroll Lock*). | [ ] | | | | |
| **QA-06** | RBAC Guardrails | Akses rute/tombol terlarang menggunakan akun dengan role User biasa. | Security | • Tombol aksi tidak dirender atau disabled.<br>• Akses rute langsung mengarah ke halaman `403 Forbidden` ramah pengguna. | [ ] | | | | |
| **QA-07** | Session Expiry | Biarkan token auth kedaluwarsa lalu kirim mutasi data di halaman form. | No Happy Path | • Request ditolak dengan ramah (401).<br>• Data isian form dipertahankan (tidak hilang).<br>• User diarahkan ke login atau refresh token tanpa crash. | [ ] | | | | |
| **QA-08** | Zero Data-Loss DB | Jalankan migrasi pada database yang telah berisi jutaan baris data eksisting. | Brownfield DB | • Tidak ada data lama yang terpotong (*truncated*) atau hilang.<br>• Nilai default terpasang rapi pada kolom baru. | [ ] | | | | |
| **QA-09** | Injeksi & XSS | Masukkan `<img src=x onerror=alert(1)>`, `<script>`, dan `' OR '1'='1` ke kolom pencarian, form, dan parameter URL. | Security | • Payload tampil sebagai teks biasa, tidak ada script berjalan.<br>• Tidak ada error 500 atau pesan SQL/stack trace.<br>• Input tak valid ditolak server dengan 400/422. | [ ] | | | | |
| **QA-10** | IDOR / Otorisasi Server | Login sebagai User A, lalu panggil API (`/items/{id}`) dengan ID milik User B atau panggil endpoint admin langsung tanpa UI. | Security | • Server menjawab `403`/`404`, bukan data pihak lain.<br>• Tidak ada perubahan data pada rekaman milik User B. | [ ] | | | | |
| **QA-11** | Header Keamanan & Cookie | Periksa response header dan cookie sesi lewat DevTools atau `curl -I`. | Security | • Ada `X-Content-Type-Options: nosniff`, `Content-Security-Policy` atau `X-Frame-Options`.<br>• Cookie sesi `HttpOnly`, `Secure`, `SameSite`.<br>• Tidak ada header yang membocorkan versi server/stack. | [ ] | | | | |
| **QA-12** | Brute Force & Rate Limit | Kirim 20 percobaan login salah beruntun dari satu IP/akun. | Security | • Muncul `429` atau penguncian sementara.<br>• Pesan error tidak membedakan "email tidak ada" vs "password salah". | [ ] | | | | |

| **QA-13** | Persistensi Data | Simpan data baru, muat ulang halaman, buka dari tab lain, dan baca ulang lewat API. | Verifikasi Data | • Data tetap ada dan nilainya sama persis di semua jalur.<br>• Jika simpan gagal, tidak ada data parsial dan pengguna diberi tahu penyebabnya. | [ ] | | | | |
| **QA-14** | Rekonsiliasi Total | Bandingkan "dari N data", jumlah baris, dan total nilai di layar dengan `COUNT(*)` / `SUM(...)` database untuk filter yang sama. | Verifikasi Data | • Semua angka identik dengan database.<br>• Mengubah filter atau halaman tidak mengubah total yang seharusnya tetap. | [ ] | | | | |
| **QA-15** | Konsistensi Lintas Halaman | Bandingkan satu rekaman yang sama di halaman daftar, detail, laporan, dan ekspor (CSV/PDF). | Verifikasi Data | • Nilai, status, dan format sama di semua tempat.<br>• Total laporan sama dengan jumlah baris yang diekspor. | [ ] | | | | |
| **QA-16** | Format & Data Tepi | Tampilkan data dengan nilai null, kosong, nol, sangat panjang, tanggal pukul 23:30 UTC, angka desimal dan negatif, serta data lama (legacy). | Verifikasi Data | • Format tanggal, zona waktu, mata uang, dan pembulatan sesuai matriks PRD 4.1.<br>• Nilai kosong tampil jelas (misalnya "-"), bukan "null" atau "NaN".<br>• Teks panjang tidak merusak tata letak. | [ ] | | | | |

---

## Bagian B: Lembar Pengujian UAT Bisnis (User Acceptance Testing)

| UAT ID | Kebutuhan Alur Bisnis | Langkah Pengujian Pengguna | Kriteria Kelulusan Bisnis | Status (Pass/Fail) | Catatan Pengguna | Bukti (perintah + hasil / path screenshot, berkas sumber) | Commit / Build | Terverifikasi oleh (nama, tanggal) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **UAT-01** | Pembuatan Data & Validasi | Buka form transaksi baru, pilih relasi dari dropdown, simpan data. | Data berhasil tersimpan dan langsung tampil di halaman list data teratas. | [ ] | | | | |
| **UAT-02** | Pencarian & Filter Cepat | Cari data transaksi bulan lalu berdasarkan nama pelanggan. | Data terfilter akurat dalam waktu kurang dari 1 detik. | [ ] | | | | |
| **UAT-03** | Pembatalan Transaksi | Batalkan transaksi salah input melalui konfirmasi persetujuan. | Status transaksi berubah menjadi Batal dan tercatat di riwayat audit. | [ ] | | | | |
| **UAT-04** | Verifikasi Data oleh Bisnis | Ambil 5 transaksi nyata, cocokkan angka, tanggal, dan status di layar dan laporan dengan dokumen sumber (nota/Excel lama). | Seluruh nilai sama dengan dokumen sumber; selisih (jika ada) terjelaskan dan disetujui pemilik bisnis. | [ ] | | | | |

---

## Bagian C: Berita Acara & Tanda Tangan UAT (Sign-off Protocol)

Dokumen ini menyatakan bahwa seluruh fitur dan aturan tata kelola antarmuka telah diuji dan memenuhi standar kualitas yang ditetapkan:

> **Aturan bukti:** baris pada Bagian A dan B hanya boleh dicentang jika kolom **Bukti** terisi (hasil perintah, screenshot, trace, atau laporan). Baris tanpa bukti dianggap **belum diuji**. Bukti juga harus **diverifikasi** (Evidence Verification Gate di SKILL.md): isi **Commit / Build** dengan versi yang diuji (harus sama dengan versi yang diserahkan) dan **Terverifikasi oleh**; baris tanpa keduanya dianggap belum diverifikasi, dan baris keamanan, uang, atau data pribadi wajib diperiksa pihak lain selain penulis kodenya. Verifikasi data juga wajib: **QA-13..QA-16 harus lulus berbukti** dan *Matriks Verifikasi Data* (PRD 4.1) terisi untuk semua halaman yang menampilkan data (UAT-04 bila ada angka bisnis); tanpa itu hasil tes dianggap belum diverifikasi. Hasil akhir "DITERIMA PENUH" tidak boleh dipilih jika ada baris tanpa bukti, gagal, atau belum diverifikasi; gunakan "DITERIMA BERSYARAT" dan tuliskan alasannya.

- **Versi Rilis / Build:** `v1.0.0-rc`
- **Tanggal Pengujian:** ____________________
- **Hasil Akhir:** [ ] DITERIMA PENUH / [ ] DITERIMA BERSYARAT / [ ] DITOLAK

| Pihak Penguji | Nama Lengkap | Jabatan | Tanda Tangan / Persetujuan |
| :--- | :--- | :--- | :--- |
| **Quality Assurance Lead** | _______________________ | QA Engineer | [ ] Approved |
| **Technical Lead / Architect** | _______________________ | Lead Developer | [ ] Approved |
| **Product Owner / Klien** | _______________________ | Stakeholder | [ ] Approved |
