# 📚 Dokumentasi Resmi Daily Dose Pilates v2

Selamat datang di pusat dokumentasi resmi **Daily Dose Pilates Studio Management System v2.0**.
Direktori ini berisi seluruh dokumen acuan arsitektur, spesifikasi bisnis, panduan operasional produksi, kamus data, dan skenario pengujian resmi (UAT).

---

## 📑 Indeks Dokumen Resmi (Authoritative Index)

### 0. Mulai dari sini (November 2026)
| Dokumen | Deskripsi & Kegunaan |
| :--- | :--- |
| [**HANDOFF.md**](./HANDOFF.md) | Status terkini, checklist deploy, pekerjaan terbuka, masalah yang diketahui. |
| [**PRD.md**](./PRD.md) | Kebutuhan produk, keputusan pemilik, dan asumsi yang perlu dikonfirmasi. |
| [**Architecture.md**](./Architecture.md) | Struktur monorepo, modul, data, alur domain, deploy, testing. |
| [**Rules.md**](./Rules.md) | Aturan wajib: database, kerahasiaan keuangan, aturan bisnis, git, komunikasi. |

Bila dokumen lain di folder ini bertentangan dengan keempat dokumen di atas, keempat dokumen ini lebih baru.

### 1. Kredensial & Pengujian
| Dokumen | Deskripsi & Kegunaan |
| :--- | :--- |
| [**AKUN_TESTING_RESMI.md**](./AKUN_TESTING_RESMI.md) | Akun testing resmi (7 peran + pelanggan), cakupan cabang, dan pemetaan rute. |
| [**sop/**](./sop/README.md) | SOP harian per peran (pembayaran, presensi, laporan keuangan, dan lain-lain). |

### 2. Panduan Operasional & Spesifikasi Bisnis
| Dokumen | Deskripsi & Kegunaan |
| :--- | :--- |
| [**FITUR_MODUL_DAN_FLOW_PER_ROLE.md**](./FITUR_MODUL_DAN_FLOW_PER_ROLE.md) | Modul, fitur, alur per peran, serta matriks hak akses. |
| [**Spesifikasi Sistem Daily Dose Pilates v1.0.pdf**](./Spesifikasi%20Sistem%20Daily%20Dose%20Pilates%20v1.0.pdf) | Spesifikasi bisnis resmi dari manajemen yang memuat 13 keputusan bisnis. |
| [**PANDUAN_OPERASIONAL_PRODUKSI.md**](./PANDUAN_OPERASIONAL_PRODUKSI.md) | Prosedur produksi, konfigurasi runtime, dan penanganan insiden. |
| [**RENCANA_AKSI_SPESIFIKASI_V1.md**](./RENCANA_AKSI_SPESIFIKASI_V1.md) | Roadmap implementasi teknis terhadap 13 keputusan bisnis. |
| [**PETA_PEMANGKASAN_APLIKASI_V2.md**](./PETA_PEMANGKASAN_APLIKASI_V2.md) | Peta penyederhanaan aplikasi (gelombang 0 sampai 4) dan keputusan yang diambil. |

### 3. Arsitektur & Basis Data
| Dokumen | Deskripsi & Kegunaan |
| :--- | :--- |
| [**PANDUAN_14_TABEL_INTI_DAILYDOSE.md**](./PANDUAN_14_TABEL_INTI_DAILYDOSE.md) | Cheat-sheet 14 tabel inti database. |
| [**DailyDose_V2_Kamus_Data_dan_Desain_Database.html**](./DailyDose_V2_Kamus_Data_dan_Desain_Database.html) | Kamus data interaktif (versi PDF tersedia di folder yang sama). |
| [**DailyDose_V2_Arsitektur_Sistem_dan_Database.pdf**](./DailyDose_V2_Arsitektur_Sistem_dan_Database.pdf) | Arsitektur modular monolith dan topologi database. |
| [**DailyDose_V2_Database_Design_Document.pdf**](./DailyDose_V2_Database_Design_Document.pdf) | Perancangan skema relasional lengkap. |

### 4. Arsip
[**arsip/**](./arsip) berisi dokumen yang sudah selesai atau digantikan: laporan dan skenario UAT, audit dan rencana lama, serta kontrak API mobile (rute mobile dicabut). Isinya hanya untuk riwayat; jangan dijadikan acuan.

---

## 🔒 13 Keputusan Bisnis yang Sudah Dikunci (Locked Decisions)

Setiap pengembangan fitur, audit, dan pengujian wajib tunduk pada 13 Keputusan Bisnis Mutlak berikut:
1. **Sesi Terpotong saat Selesai & Hadir**: Sesi pelanggan tidak dipotong saat booking, melainkan saat status kelas berubah menjadi `COMPLETED` dan pelanggan hadir. Presensi pelanggan dan instruktur dilakukan dengan **staf memindai QR** di halaman Check-in (dikonfirmasi pemilik, 1 November 2026).
2. **Customer Self-Booking**: Pelanggan melakukan booking mandiri dari jadwal kelas (*timetable*); booking manual via Admin hanya untuk *rare cases*.
3. **Expiry Basis**: Masa berlaku paket berbasis tanggal (*validUntil*); sisa sesi hangus otomatis saat tanggal kedaluwarsa tiba.
4. **Cutoff Auto-Cancel H-24**: Kelas otomatis dibatalkan sistem jika peserta kurang dari kuota minimum pada jendela H-24 jam sebelum kelas dimulai, sesi dikembalikan utuh via mutasi `REFUND_AUTOCANCEL`.
5. **Min Quota per Kelas per Cabang**: Kuota minimum peserta ditentukan spesifik per jenis kelas dan per cabang studio.
6. **Birokrasi Reschedule**: Reschedule $\ge$ H-24 jam mengembalikan sesi secara instan; reschedule $<$ H-24 jam memerlukan permohonan darurat medis via Admin dan persetujuan resmi Studio Manager (`SessionAdjustRequest`).
7. **Struktur Multi-Cabang**: Peran *Owner* terikat pada cabang tertentu; *Super Owner* yang berwenang menugaskan kepemilikan multi-cabang.
8. **Laporan Keuangan menurut Rentang Tanggal**: Tidak ada tutup buku atau jurnal koreksi. Omzet, honor aktual, biaya lain, dan laba dihitung langsung untuk rentang tanggal pilihan pengguna; biaya lain bertanggal dan dapat diubah/dihapus.
9. **Batas Toleransi Backfill H+2**: Admin dapat melakukan backfill presensi susulan maksimal hingga H+2 jam setelah kelas selesai.
10. **Isolasi Finansial Cabang**: Owner cabang hanya diizinkan melihat data dan rincian beban instruktur pada cabangnya sendiri (*Zero Cross-Branch Leakage*).
11. **Reminder WhatsApp Internal**: Notifikasi ringkasan paket kedaluwarsa dikirimkan ke WhatsApp Admin setiap 3 jam, serta ke Owner dan Super Owner setiap 3 hari.
12. **Reminder WhatsApp Customer Menjelang Expired**: Dikirimkan otomatis pada H-7, H-3, dan H-1 sebelum paket habis.
13. **Reminder WhatsApp Customer Sudah Expired**: Dikirimkan berkala setiap 3 hari untuk penawaran perpanjangan paket.
