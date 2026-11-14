# Change Scope & Impact Template

Isi dokumen ini **sebelum menulis kode** untuk setiap penambahan fitur, perbaikan bug, atau penyesuaian (Focused Change Protocol di `SKILL.md`). Salin satu berkas per perubahan, mis. `docs/sdlc/changes/2026-11-14-perbaikan-total-order.md`.

---

## 1. Tujuan & Batas
- **Jenis:** [ ] Fitur  [ ] Bug  [ ] Anomali  [ ] Penyesuaian
- **Tujuan (satu kalimat, terukur):**
- **Modul / fitur sasaran:**
- **Boleh diubah (file/folder):**
- **Dilarang disentuh (file/modul) dan alasannya:**

## 2. Yang Sudah Dibaca (wajib terbuka sebelum mengedit)
| File / Fungsi / Skema | Yang dipastikan dari sana | Dibaca? |
| :--- | :--- | :---: |
| | | [ ] |

## 3. Fakta yang Dipakai (bukan tebakan)
Setiap nama (fungsi, kelas, route, tabel, kolom, env var, prop komponen) harus terbukti ada saat ini.

| Nama yang dipakai | Bukti keberadaan (file:baris atau hasil pencarian) |
| :--- | :--- |
| | |

Versi library yang terpasang dan dokumentasi yang dibaca (dari lockfile, bukan ingatan):

## 4. Peta Dampak
| Yang bergantung pada kode ini | Cara menemukannya (pencarian referensi / rute / tes) | Perlu diuji ulang? |
| :--- | :--- | :---: |
| Pemanggil fungsi/komponen | | [ ] |
| Endpoint / rute terkait | | [ ] |
| Tabel / migrasi / seed | | [ ] |
| Komponen bersama | | [ ] |
| Tes yang sudah ada | | [ ] |

## 5. Khusus Bug / Anomali
- **Langkah reproduksi:**
- **Hasil sebenarnya vs seharusnya:**
- **Bukti kegagalan sebelum perbaikan (log, stack trace, query, tangkapan layar):**
- **Akar masalah (penyebab, bukan gejala) dan buktinya:**
- **Tes regresi:** nama tes, gagal sebelum perbaikan, lulus sesudah perbaikan
- **Pola yang sama di tempat lain (hasil pencarian) dan keputusannya (diperbaiki di sini / dilaporkan):**

## 6. Asumsi Belum Terbukti
Hal yang tidak bisa diverifikasi ditulis di sini dan ditanyakan ke pemilik produk; jangan diisi dengan tebakan.

| Asumsi | Dampak jika salah | Ditanyakan ke | Jawaban |
| :--- | :--- | :--- | :--- |
| | | | |

## 7. Laporan Ruang Lingkup (diisi setelah selesai)
```text
Tujuan perubahan:
Dibaca:
Diubah (file -> alasan):
Sengaja tidak disentuh (file/modul -> alasan):
Peta dampak yang diperiksa:
Akar masalah (bug) + tes regresi (gagal sebelum, lulus sesudah):
Asumsi belum terbukti:
Regresi terfokus (perintah -> hasil nyata):
```
