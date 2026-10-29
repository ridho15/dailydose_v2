/**
 * Rute tetap yang bisa tertelan rute berparameter milik controller lain.
 *
 * Nest mencocokkan rute menurut urutan pendaftaran modul. `GET reports/owner-exceptions` di modul
 * kehadiran pernah tertelan `GET reports/:reportType` milik modul keuangan yang terdaftar lebih
 * dulu: server menjawab 200 dengan laporan omzet, dan beranda Owner rusak karena bentuk datanya
 * lain. Tes ini membaca dekorator semua controller dan menolak pasangan seperti itu, apa pun
 * urutan modulnya, karena urutan itu mudah berubah tanpa disadari.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = __dirname;
const METODE = ['Get', 'Post', 'Put', 'Patch', 'Delete'] as const;

interface Rute {
  metode: string;
  jalur: string[];
  berkas: string;
}

function semuaController(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) semuaController(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const potong = (p: string) => p.split('/').filter(Boolean);
const daftarString = (isi: string) => [...isi.matchAll(/'([^']*)'/g)].map((m) => m[1]!);

function ruteDari(berkas: string): Rute[] {
  const teks = fs.readFileSync(berkas, 'utf8');
  const hasil: Rute[] = [];
  // Satu berkas bisa memuat beberapa controller; tiap blok mulai dari @Controller berikutnya.
  const blok = teks.split(/(?=@Controller\()/);
  for (const bagian of blok) {
    const awalan = /@Controller\(\s*(\[[^\]]*\]|'[^']*')?/.exec(bagian);
    if (!awalan) continue;
    const prefixes = awalan[1] ? daftarString(awalan[1]).map(potong) : [[]];
    const pola = new RegExp(`@(${METODE.join('|')})\\(\\s*(\\[[^\\]]*\\]|'[^']*')?\\s*\\)`, 'g');
    for (const m of bagian.matchAll(pola)) {
      const jalur = m[2] ? daftarString(m[2]) : [''];
      for (const prefix of prefixes) {
        for (const j of jalur) {
          hasil.push({
            metode: m[1]!.toUpperCase(),
            jalur: [...prefix, ...potong(j)],
            berkas: path.relative(SRC, berkas),
          });
        }
      }
    }
  }
  return hasil;
}

const parameter = (s: string) => s.startsWith(':');

/** `umum` (berparameter) menelan `tetap` bila panjangnya sama dan tiap segmen cocok. */
function menelan(umum: Rute, tetap: Rute) {
  return (
    umum.metode === tetap.metode &&
    umum.berkas !== tetap.berkas &&
    umum.jalur.length === tetap.jalur.length &&
    umum.jalur.some(parameter) &&
    umum.jalur.every((seg, i) => parameter(seg) || seg === tetap.jalur[i]) &&
    // Hanya bila rute tetap memang berisi teks di posisi parameter rute umum.
    umum.jalur.some((seg, i) => parameter(seg) && !parameter(tetap.jalur[i]!))
  );
}

describe('route shadowing antar controller', () => {
  it('tidak ada rute tetap yang bisa tertelan rute berparameter di controller lain', () => {
    const rute = semuaController(SRC).flatMap(ruteDari);
    expect(rute.length).toBeGreaterThan(50);
    const bentrok: string[] = [];
    for (const umum of rute) {
      for (const tetap of rute) {
        if (menelan(umum, tetap)) {
          bentrok.push(
            `${tetap.metode} /${tetap.jalur.join('/')} (${tetap.berkas}) bisa tertelan /${umum.jalur.join('/')} (${umum.berkas})`,
          );
        }
      }
    }
    expect(bentrok).toEqual([]);
  });
});
