# Plan & Goal Verification Template

Isi dokumen ini **sebelum implementasi**, perbarui saat rencana berubah, dan lengkapi bagian penutup sebelum menyatakan pekerjaan selesai (Plan & Goal Verification Gate di `SKILL.md`). Salin satu berkas per pekerjaan, mis. `docs/sdlc/plans/2026-11-14-modul-laporan.md`.

---

## 1. Gerbang Tujuan
| Unsur | Isi | Lolos? |
| :--- | :--- | :---: |
| **Tujuan (satu kalimat)** | | [ ] |
| **Hasil terukur** (angka, status, atau perilaku yang bisa diamati) | | [ ] |
| **Kriteria selesai** (tiap butir bisa dibuktikan dengan tes atau pengamatan) | | [ ] |
| **Ruang lingkup** (modul, halaman, peran) | | [ ] |
| **Non-goals** (sengaja tidak dikerjakan) | | [ ] |

Tujuan kabur seperti "buat lebih baik" atau "rapikan" **tidak lolos**. Tanyakan balik ke pemilik produk; jangan menafsirkan sendiri.

## 2. Gerbang Rencana
### 2.1 Pemeriksaan terhadap keadaan nyata
| Yang diasumsikan rencana | Bukti saat ini (file:baris, hasil pencarian, versi lockfile, query) | Status |
| :--- | :--- | :---: |
| | | [ ] Terbukti / [ ] Baru / [ ] Asumsi belum terbukti |

### 2.2 Tugas, urutan, dan ketergantungan
| No | Tugas | Bergantung pada | Risiko | Mitigasi | Rollback |
| :--- | :--- | :--- | :--- | :--- | :--- |
| T-01 | | - | | | |

Migrasi dan perubahan berisiko wajib punya rollback yang sudah dipikirkan (mis. migrasi aditif, feature flag, cadangan data).

## 3. Matriks Keterlacakan
Setiap butir PRD atau kriteria selesai harus punya tugas, tes, baris QA, dan bukti. Butir yang kosong adalah celah dan wajib dilaporkan.

| Butir (PRD/kriteria) | Tugas | Tes (nama/berkas) | Baris QA/UAT | Bukti | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| F-01 | T-01 | | QA-0x | | [ ] |

## 4. Persetujuan Tercatat
Tidak ada kode yang ditulis sebelum bagian ini terisi. Persetujuan lisan atau lewat chat ditulis ulang dengan kutipan.

| Dokumen yang disetujui | Versi (revisi/hash commit) | Penyetuju | Tanggal | Kutipan / bukti persetujuan |
| :--- | :--- | :--- | :--- | :--- |
| Tujuan dan rencana ini | | | | |

## 5. Log Perubahan Rencana
Isi setiap kali kenyataan berbeda dari rencana. Hentikan pekerjaan, nilai dampak, dan minta persetujuan ulang.

| Tanggal | Perubahan | Alasan (bukti) | Dampak ke tujuan / keterlacakan / jadwal | Disetujui ulang oleh |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

## 6. Gerbang Tujuan Tercapai (sebelum klaim selesai)
Cocokkan hasil akhir dengan kriteria selesai di bagian 1, satu per satu, dengan bukti dari Evidence Verification Gate. Lulus tes saja belum berarti tujuan tercapai.

| Kriteria selesai | Hasil | Bukti (perintah + hasil / path) | Selisih |
| :--- | :--- | :--- | :--- |
| | [ ] Terpenuhi / [ ] Sebagian / [ ] Belum | | |

```text
Tujuan: <hasil terukur>
Kriteria selesai: <kriteria> -> <terpenuhi / belum / selisih> | bukti: <...>
Keterlacakan: <n> butir, <n> punya tugas, <n> punya tes, <n> tanpa tes (daftar)
Persetujuan: <nama, tanggal, versi>
Perubahan rencana: <jumlah, ringkas, sudah disetujui ulang?>
Kesimpulan: <tujuan tercapai | tercapai sebagian | belum>
```
