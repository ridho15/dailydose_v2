---
name: sdlc-promax-prompt-writer
description: Menyusun prompt siap-tempel yang membuat agen AI mengikuti aturan SDLC ProMax (docs/sdlc). Gunakan saat pengguna meminta dibuatkan prompt, brief, atau instruksi untuk fitur, perbaikan bug, refactor, audit, atau verifikasi di proyek yang memakai kit ini, atau saat pengguna bingung cara memberi perintah ke agen.
---

# SDLC ProMax Prompt Writer

Tugas: mengubah permintaan kasar pengguna menjadi **satu prompt lengkap, spesifik, dan siap ditempel** ke agen AI, sehingga agen mengikuti aturan kit ini. Jangan mengerjakan fiturnya sendiri; hasil akhirnya adalah teks prompt.

## Langkah

1. **Baca konteks proyek** sebelum bertanya: `docs/sdlc/sdlc-config.json` (mode, stack, database, role, kebijakan migrasi). Jangan menanyakan hal yang sudah ada di sana.
2. **Tentukan mode dan fase.** Greenfield mulai dari Fase 1 (Discovery). Brownfield mulai dari Fase 0 (Audit Teknis 4 langkah) lalu Delta-PRD. Satu permintaan = satu fase dominan.
3. **Ajukan paling banyak 3 pertanyaan** hanya untuk hal yang benar-benar hilang: tujuan fitur, batasan (modul yang tidak boleh disentuh), dan kriteria selesai. Jika jawabannya sudah jelas dari permintaan, langsung tulis prompt.
4. **Susun prompt** dengan struktur di bawah. Tulis dalam bahasa yang dipakai pengguna.
5. **Periksa hasilnya** dengan daftar periksa di bagian akhir sebelum menyerahkan.

## Struktur prompt

```text
[1 Konteks]   Mode: <Greenfield|Brownfield>. Proyek: <nama>, stack: <stack>. Cek skill yang tersedia
              (jangan mengaku memakai yang tidak ada) dan baca docs/sdlc/PROJECT-MAP.md lebih dulu; jangan
              memindai ulang seluruh proyek. Baca dulu:
              docs/sdlc/sdlc-config.json, .agent/skills/app-setup-blueprint-promax/SKILL.md
              (atau .claude/skills/...), docs/sdlc/ui-standards-reference, docs/sdlc/templates.
[2 Tujuan]    <satu kalimat hasil yang diinginkan, terukur> + kriteria selesai yang bisa dibuktikan, ruang
              lingkup, dan non-goals. Jika tujuan pengguna kabur, tanyakan balik sebelum menulis prompt.
[3 Fase]      Mulai dari Fase <n>. Jangan menulis kode sebelum <PRD / blueprint / audit> saya setujui.
[4 Batasan]   Hanya sentuh: <modul/file>. Jangan ubah: <daftar>. Baca dulu kode terkait dan buktikan setiap
              nama yang dipakai ada (file:baris); jangan menebak; tandai asumsi yang belum terbukti. Migrasi DB harus aditif (zero data-loss).
[5 Aturan]    Tabel server-side pagination dan pencarian debounced; dropdown relasi memakai
              AsyncSearchSelect; semua alert lewat alert-manager (satu alert, ada sebab dan solusi);
              aksi destruktif lewat ConfirmModal; validasi di klien dan server; tangani
              timeout, 400/401/403/404/409/422/500, double-submit, dan data kosong.
              Checklist keamanan SEC-01..SEC-10 pada PRD berlaku. Informasi yang tampil harus terdaftar di Matriks
              Verifikasi Data (PRD 4.1) dan diverifikasi per tahap (PRD 4.2).
[6 Bukti]     Tambahkan tes Playwright dan jalankan sampai lulus. Isi baris QA-UAT-MATRIX.md yang
              relevan dengan hasil nyata dan isi kolom Bukti-nya. Laporkan tes yang gagal apa adanya;
              jangan klaim selesai tanpa menjalankan perintahnya sekarang dan menampilkan keluarannya.
              Sebelum melapor, jalankan Evidence Verification Gate (bukti dari commit saat ini, screenshot/trace
              diperiksa, kontrol negatif pada tes baru, angka lengkap, peninjau independen untuk risiko tinggi).
              Akhiri dengan Format Laporan Bukti (Diverifikasi / Verifikasi bukti / Gagal atau dilewati / Belum diverifikasi).
[7 Keluaran]  Ringkasan perubahan, daftar file, hasil tes, dan hal yang belum selesai.
```

## Prompt dasar per situasi

Pakai sebagai titik awal, lalu isi bagian dalam kurung siku.

- **Aktivasi awal sesi:** "Sebelum merencanakan atau menulis kode, baca dan patuhi docs/sdlc/sdlc-config.json, SKILL.md di .agent/skills/app-setup-blueprint-promax, komponen di docs/sdlc/ui-standards-reference, dan template di docs/sdlc/templates. Ikuti 7 fase SDLC berurutan. Konfirmasi sudah membaca lalu ringkas aturan wajibnya."
- **Greenfield:** "Mode Greenfield. Mulai dari Fase 1. Ajukan pertanyaan discovery satu per satu, buat PRD dari PRD-AND-DELTA-TEMPLATE.md (RBAC dan SEC-01..SEC-10), tunggu persetujuan, lalu blueprint Mermaid dan roadmap, baru implementasi bertahap."
- **Brownfield:** "Mode Brownfield. Jalankan Audit Teknis 4 langkah (Fase 0) dan berikan Laporan Technical Debt & Compliance. Lalu buat Delta-PRD untuk [perubahan] dengan Safe DB Schema Diff dan Regression Guardrails. Jangan ubah modul di luar yang disepakati."
- **Fitur:** "Kerjakan [fitur] sesuai roadmap dengan aturan di bagian [5 Aturan] di atas, termasuk tes Playwright yang dijalankan sampai lulus."
- **Pekerjaan terlalu luas:** "Pekerjaan: [deskripsi]. Jalankan Work Size Check; jika terlalu luas, ikuti Work Decomposition & Staged Execution Protocol dan isi ROADMAP-TEMPLATE.md: inventaris dari bukti yang ditutup dengan hitungan, tahap kecil berkriteria keluar dan rollback, tracker (tiap item punya tahap dan status). Minta persetujuan roadmap sebelum tahap 1, kerjakan satu tahap pada satu waktu dengan Format Laporan Tahap, pindai ulang inventaris setelah tiap tahap, dan tutup hanya bila setiap item Tuntas berbukti atau Ditunda/Dibatalkan dengan persetujuan."
- **Periksa overengineering dan drift:** "Jalankan Complexity & Scope Drift Protocol: baca tujuan, non-goals, dan docs/sdlc/COMPLEXITY-DECISIONS.md (yang tercatat dibiarkan). Bandingkan proyek dengan PRD dua arah, cari indikator overengineering berbukti dari kode, isi SIMPLIFICATION-REPORT-TEMPLATE.md, lalu minta keputusan saya per temuan (setuju dirombak / tolak / catat disengaja) sebelum merombak. Yang disetujui dikerjakan sampai tuntas tanpa sisa kode lama atau adapter sementara, dengan tes dan metrik sebelum dan sesudah."
- **Peta proyek dan skill:** "Ikuti Skill Routing & Token Efficiency Protocol: cek skill yang benar-benar tersedia dan sebutkan yang dipakai (graphify, ponytail, antislop, ui-ux-pro-max, context7, database-design, playwright, qa, testing, uat); pakai aturan cadangan kit untuk yang tidak ada. Buat atau perbarui docs/sdlc/PROJECT-MAP.md (bandingkan hash dengan HEAD, perbarui hanya modul yang berubah), baca peta lebih dulu, buka hanya file relevan per rentang baris, buat diff terkecil, periksa git diff --stat, dan akhiri dengan Format Laporan Skill & Konteks."
- **Verifikasi tujuan dan rencana:** "Sebelum menulis kode untuk [pekerjaan], terapkan Plan & Goal Verification Gate dan isi PLAN-AND-GOAL-TEMPLATE.md: tujuan terukur dengan kriteria selesai dan non-goals (tanyakan balik jika kabur), rencana diperiksa terhadap keadaan nyata proyek dengan bukti, urutan, ketergantungan, risiko, rollback, keterlacakan butir PRD ke tugas, tes, dan QA. Minta persetujuan saya (nama, tanggal, versi) sebelum kode. Saat rencana berubah, hentikan dan minta persetujuan ulang. Di akhir cocokkan hasil dengan kriteria selesai beserta bukti."
- **Perbaiki bug:** "Bug: [gejala, langkah reproduksi, sebenarnya vs seharusnya]. Ikuti Focused Change Protocol dan isi CHANGE-SCOPE-TEMPLATE.md. Batasi pada [modul]; jangan sentuh [daftar]. Baca kode terkait dan buktikan setiap nama ada (file:baris). Reproduksi dulu, temukan akar masalah dengan bukti, tulis tes regresi yang gagal sebelum perbaikan, perbaiki minimal, buktikan lulus, jalankan tes pemanggil terdampak. Tandai asumsi yang belum terbukti dan akhiri dengan Format Laporan Ruang Lingkup."
- **Ubah/tambah fitur di proyek berjalan:** "Ubah/tambahkan [fitur] pada [modul] dengan Focused Change Protocol: batas file, file yang dibaca, peta dampak, versi library dari lockfile. Jangan membuat nama yang belum terbukti ada; berhenti dan baca ulang bila kenyataan beda dari dugaan. Akhiri dengan Format Laporan Ruang Lingkup."
- **Verifikasi akhir:** "Jalankan semua tes, isi QA-UAT-MATRIX.md (QA-01..QA-16) dengan hasil nyata dan kolom Bukti terisi, laporkan kegagalan apa adanya, jalankan Evidence Verification Gate (kesegaran commit, screenshot diperiksa, kontrol negatif pada tes baru, kolom Commit/Build dan Terverifikasi oleh terisi), dan akhiri dengan Format Laporan Bukti dari SKILL.md."
- **Gerbang keamanan:** "Untuk modul [nama], terapkan Security Gate di SKILL.md (Fase 2, 4, 5, 6) dan isi status SEC-01..SEC-10 di PRD 6.1 (Ya / Tidak berlaku + alasan). Jalankan QA-09..QA-12 dan `npm audit`, laporkan temuan dengan tingkat P0-P3, dan jangan menyatakan siap rilis jika P0/P1 belum tertutup."
- **Verifikasi data:** "Untuk modul [nama], daftarkan setiap informasi yang tampil ke Matriks Verifikasi Data (PRD 4.1: sumber, rumus, format, cara verifikasi). Verifikasi di tiap tahap (PRD 4.2): input, proses, simpan (baca ulang dari database), tampil (bandingkan layar dengan API, lalu muat ulang), ekspor. Lacak satu data uji dari input sampai tampil dan ekspor, cocokkan dengan sumber independen, dan jangan menyatakan tes berhasil sebelum QA-13..QA-16 lulus berbukti. Isi QA-13..QA-16 dan UAT-04 dengan hasil nyata."

## Daftar periksa sebelum menyerahkan prompt

- Mode (Greenfield/Brownfield) dan fase awal disebut jelas.
- Ada batasan ruang lingkup: apa yang boleh dan tidak boleh disentuh.
- Ada kriteria selesai yang bisa dibuktikan (tes, matriks QA), bukan "pastikan bagus".
- Tidak ada placeholder yang belum diisi kecuali pengguna memang harus mengisinya, dan itu ditandai jelas.
- Tidak menyalin rahasia (API key, password, data pribadi) ke dalam prompt.
- Satu prompt satu tujuan; permintaan besar dipecah menjadi beberapa prompt berurutan lewat ROADMAP-TEMPLATE.md (Work Decomposition & Staged Execution Protocol), satu prompt per tahap.
