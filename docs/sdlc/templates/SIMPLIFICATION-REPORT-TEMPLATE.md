# Complexity & Drift Report

Laporan pemeriksaan kompleksitas dan penyimpangan tujuan (Complexity & Scope Drift Protocol di `SKILL.md`). Salin satu berkas per pemeriksaan, mis. `docs/sdlc/reviews/2026-11-14-milestone-2.md`. Agen **hanya merekomendasikan**; keputusan ada pada developer.

## 1. Pemeriksaan
- **Tanggal dan hash commit:**
- **Pemicu:** [ ] Akhir milestone/fase  [ ] Permintaan  [ ] Perubahan menambah domain/lapisan baru
- **Tujuan proyek dan non-goals saat ini (versi PRD):**
- **Profil proyek:** [Prototipe / Internal / Produksi / Terregulasi]
- **Register kompleksitas disengaja dibaca?** [ ] Ya (butir yang tercatat dilewati)

## 2. Drift Dua Arah
| Arah | Temuan | Bukti (file, pencarian, perintah) |
| :--- | :--- | :--- |
| Butir PRD belum dikerjakan | | |
| Fitur / modul / tabel / dependensi **tanpa butir PRD** | | |
| Pekerjaan yang melanggar non-goals | | |

## 3. Temuan Overengineering
Setiap temuan wajib berbukti dari kode, bukan perasaan.

| ID | Indikator | Lokasi | Bukti terukur | Tercatat di register? |
| :--- | :--- | :--- | :--- | :---: |
| F-01 | Abstraksi/antarmuka dengan satu implementasi | | jumlah implementasi: | [ ] |
| F-02 | Modul/layanan dengan satu pemanggil | | jumlah pemanggil: | [ ] |
| F-03 | Opsi/konfigurasi/feature flag tidak pernah dipakai | | referensi: | [ ] |
| F-04 | Dependensi besar untuk fungsi kecil | | ukuran / pemakaian: | [ ] |
| F-05 | Kode mati atau fitur tanpa butir PRD | | pencarian: | [ ] |
| F-06 | Fitur sekelas domain lain di luar tujuan (mis. ledger, rekonsiliasi, audit ketat, multi-tenant, workflow persetujuan berlapis) | | butir PRD terkait: tidak ada | [ ] |

Temuan yang sudah tercatat di register **tidak** dipersoalkan.

## 4. Rekomendasi Perombakan
| ID | Usulan penyederhanaan | Dampak (waktu build, jumlah file, risiko) | Prioritas | Rollback |
| :--- | :--- | :--- | :--- | :--- |
| F-01 | | | | |

## 5. Keputusan Developer
| ID | Keputusan | Oleh | Tanggal |
| :--- | :--- | :--- | :--- |
| F-01 | [ ] Setuju dirombak  [ ] Tolak  [ ] Catat sebagai disengaja (isi register) | | |

Tidak ada perombakan sebelum kolom ini terisi.

## 6. Eksekusi sampai Tuntas (untuk yang disetujui)
Perombakan dinyatakan **tuntas** hanya jika semua kolom terpenuhi dengan bukti.

| ID | Kode lama dihapus (tanpa dua implementasi berdampingan) | Tidak ada adapter/flag sementara tersisa | Referensi dan dokumentasi diperbarui | Tes dan regresi lulus (bukti) | Metrik sebelum -> sesudah |
| :--- | :---: | :---: | :---: | :--- | :--- |
| F-01 | [ ] | [ ] | [ ] | | file: -> ; baris: -> ; dependensi: -> ; lapisan: -> |

Sisa yang belum tuntas ditulis di sini dan perombakan dilaporkan **belum selesai**:

```text
Laporan Kompleksitas & Drift
Diperiksa: <hash, tanggal> | profil: <...> | register dibaca: <ya>
Drift: <n butir PRD belum, n fitur tanpa PRD, n melanggar non-goals>
Temuan: <n> (tercatat disengaja: <n>) | direkomendasikan: <n> | disetujui: <n> | tuntas: <n>
Metrik: <file/baris/dependensi/lapisan sebelum -> sesudah>
Belum tuntas: <daftar atau "tidak ada">
```
