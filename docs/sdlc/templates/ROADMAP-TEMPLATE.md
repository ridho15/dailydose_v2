# Staged Roadmap & Tracker

Pakai untuk pekerjaan yang **terlalu luas** (Work Decomposition & Staged Execution Protocol di `SKILL.md`): fitur besar, pembaruan banyak halaman, perbaikan lintas modul, migrasi, atau penyesuaian massal. Salin satu berkas per pekerjaan, mis. `docs/sdlc/roadmaps/2026-11-14-standarisasi-tabel.md`. Roadmap disetujui sebelum tahap 1 dimulai (lihat `PLAN-AND-GOAL-TEMPLATE.md`).

---

## 1. Ukur Dulu (Work Size Check)
Pekerjaan dianggap **terlalu luas** bila salah satu terpenuhi. Ambang bersifat indikatif; sesuaikan dengan proyek dan catat alasannya.

| Indikator | Ya? | Bukti |
| :--- | :---: | :--- |
| Menyentuh lebih dari satu modul atau domain | [ ] | |
| Diperkirakan mengubah lebih dari ~8 file atau tidak muat dalam satu sesi kerja | [ ] | |
| Memuat lebih dari satu tujuan yang bisa berdiri sendiri | [ ] | |
| Menggabungkan migrasi data, API, dan UI sekaligus | [ ] | |
| Berbunyi "semua", "seluruh", "rapikan semuanya" tanpa daftar yang jelas | [ ] | |
| Tidak bisa diverifikasi tuntas dalam satu kali jalan | [ ] | |

Hasil: [ ] Cukup Focused Change Protocol  [ ] **Wajib dipecah menjadi tahap**

## 2. Inventaris (Pemetaan Seluruh Item)
Daftar semua item yang terlibat, diambil dari **bukti** (peta proyek, pencarian referensi, rute, tabel, daftar halaman), bukan ingatan. Inventaris ditutup dengan hitungan agar tidak ada yang terlewat.

| ID | Item (halaman / modul / endpoint / tabel / bug) | Sumber penemuan (perintah atau pencarian) | Dampak / ketergantungan |
| :--- | :--- | :--- | :--- |
| I-01 | | | |

- **Cara melengkapi:** [mis. `grep` semua pemakaian komponen lama, daftar rute dari router, daftar tabel dari skema]
- **Jumlah item saat inventaris ditutup:** [N] pada hash commit [hash]
- **Pemeriksaan kelengkapan:** pencarian dijalankan ulang di akhir; selisih dengan N ditambahkan ke inventaris, bukan dikerjakan diam-diam.

## 3. Roadmap Bertahap
Tahap kecil, berurutan menurut ketergantungan dan risiko (fondasi dan risiko tinggi lebih dulu; potong secara vertikal bila memungkinkan). Satu tahap berjalan pada satu waktu kecuali tahap itu benar-benar independen.

| Tahap | Tujuan (terukur) | Item yang dicakup | Bergantung pada | Kriteria keluar (dapat dibuktikan) | Tes / verifikasi | Rollback | Ukuran |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| S-01 | | I-01 | - | | | | |

## 4. Tracker Keterlacakan (tidak boleh ada item tanpa tahap)
Setiap item inventaris punya tahap dan status. Item tanpa tahap adalah celah.

| Item | Tahap | Status | Bukti (perintah + hasil / path) | Commit / Build | Catatan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| I-01 | S-01 | Belum / Berjalan / Tuntas / Ditunda (alasan) / Dibatalkan (alasan + persetujuan) | | | |

## 5. Log Tahap
Isi setelah setiap tahap. Tahap ditutup hanya jika semua kriteria keluarnya terbukti (Evidence Verification Gate) dan tes regresi tahap sebelumnya lulus.

```text
Tahap: <S-xx> | tujuan: <...>
Kriteria keluar: <kriteria> -> <terpenuhi / belum> | bukti: <...>
Item: <n tuntas, n sisa> | Temuan baru: <ditambahkan ke inventaris: ...>
Regresi tahap sebelumnya: <perintah -> hasil nyata>
Status roadmap: <n/N item tuntas, n ditunda, n dibatalkan>
Pembaruan peta proyek dan roadmap: <ya, hash ...>
```

| Tahap | Tanggal | Ringkasan hasil | Temuan baru | Persetujuan lanjut |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

## 6. Penutupan Roadmap
Cocokkan inventaris dengan hasil akhir. Roadmap hanya dinyatakan tuntas bila **setiap item** berstatus Tuntas dengan bukti, atau Ditunda/Dibatalkan dengan alasan dan persetujuan tercatat.

| Pemeriksaan | Hasil | Bukti |
| :--- | :--- | :--- |
| Inventaris dipindai ulang; tidak ada item baru yang belum dipetakan | [ ] | |
| Semua item Tuntas, atau Ditunda/Dibatalkan dengan persetujuan | [ ] | |
| Tes penuh dan Gerbang Tujuan Tercapai lulus | [ ] | |
| Sisa pekerjaan (jika ada) tercatat sebagai roadmap lanjutan | [ ] | |
