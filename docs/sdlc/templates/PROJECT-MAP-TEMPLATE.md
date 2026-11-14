# Project Map

Peta ringkas struktur proyek agar agen **tidak memindai ulang seluruh proyek** di setiap tugas (Skill Routing & Token Efficiency Protocol di `SKILL.md`). Simpan sebagai `docs/sdlc/PROJECT-MAP.md`. Jika skill `graphify` terpasang, `graphify-out/` boleh menggantikan berkas ini; isi header di bawah tetap dicatat.

> Peta adalah **petunjuk, bukan bukti**. Sebelum mengedit, tetap buka file aslinya dan buktikan nama yang dipakai ada (Focused Change Protocol).

## Header
- **Dibuat / diperbarui pada:** [tanggal-waktu]
- **Hash commit saat dipetakan:** [`git rev-parse --short HEAD`]
- **Cakupan:** [seluruh proyek / modul tertentu]
- **Dibuat dengan:** [graphify / manual oleh agen]
- **Perintah tes:** [mis. `npm test`, `npx playwright test`]
- **Versi kunci (dari lockfile):** [framework, ORM, library UI, library tes]

## Cara memeriksa keusangan
```bash
git rev-parse --short HEAD                     # bandingkan dengan hash di header
git diff --name-only <hash-di-header>..HEAD    # modul yang berubah sejak dipetakan
```
Hanya modul yang berubah yang dipetakan ulang. Peta yang usang dan belum diperbarui tidak boleh dipakai sebagai dasar klaim.

## Modul
| Modul | Tanggung jawab (satu kalimat) | Lokasi | Rute / endpoint | Tabel | Pemanggil / dependensi utama | Tes | Titik rawan | Dipetakan pada hash |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| | | | | | | | | |

## Alur data utama
| Alur | Input -> Proses -> Simpan -> Tampil -> Ekspor (file/fungsi di tiap titik) |
| :--- | :--- |
| | |

## Komponen bersama
| Komponen | Lokasi | Dipakai oleh |
| :--- | :--- | :--- |
| | | |

## Catatan konvensi proyek
[Pola penamaan, struktur folder, gaya validasi, penanganan error, hal yang sering salah ditebak]

## Log pembaruan
| Tanggal | Hash | Modul yang diperbarui | Alasan |
| :--- | :--- | :--- | :--- |
| | | | |
