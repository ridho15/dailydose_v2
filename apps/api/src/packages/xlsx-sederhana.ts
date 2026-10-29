import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Penulis .xlsx kecil tanpa dependensi: beberapa lembar berisi teks dan angka, cukup untuk berkas
 * yang dibaca aplikasi lain (mis. Converter Multi Transaksi KlikBCA Bisnis). Teks memakai shared
 * strings, format yang dibaca semua pembaca Excel.
 */
export type Sel = string | number | null | { angka: number; format: 'desimal2' };

export interface Lembar {
  nama: string;
  baris: Sel[][];
  /** Lebar kolom dalam karakter, urut dari kolom A. */
  lebar?: number[];
}

const STYLE = { teks: 1, desimal2: 2 } as const;

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Karakter kendali tidak sah di XML.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function kolom(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function buatXlsx(lembar: Lembar[]): Buffer {
  const teks: string[] = [];
  const indeks = new Map<string, number>();
  const sst = (s: string) => {
    let i = indeks.get(s);
    if (i === undefined) {
      i = teks.length;
      teks.push(s);
      indeks.set(s, i);
    }
    return i;
  };

  const sheets = lembar.map((l) => {
    const rows = l.baris
      .map((baris, r) => {
        const cells = baris
          .map((sel, c) => {
            if (sel === null || sel === '') return '';
            const ref = `${kolom(c)}${r + 1}`;
            if (typeof sel === 'string')
              return `<c r="${ref}" t="s" s="${STYLE.teks}"><v>${sst(sel)}</v></c>`;
            if (typeof sel === 'number') return `<c r="${ref}"><v>${sel}</v></c>`;
            return `<c r="${ref}" s="${STYLE.desimal2}"><v>${sel.angka.toFixed(2)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    const cols = l.lebar?.length
      ? `<cols>${l.lebar.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  });

  const berkas: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${lembar
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join(
          '',
        )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${lembar
        .map((l, i) => `<sheet name="${xml(l.nama)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${lembar
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join(
          '',
        )}<Relationship Id="rId${lembar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${lembar.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      // Gaya 1 = teks (@, agar nomor rekening berawalan 0 tetap utuh), gaya 2 = angka 0.00.
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s]),
  ];
  // sharedStrings dibuat setelah semua lembar mengisi daftar teks.
  berkas.push([
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${teks.length}" uniqueCount="${teks.length}">${teks
      .map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`)
      .join('')}</sst>`,
  ]);
  return zip(berkas.map(([nama, isi]) => [nama, Buffer.from(isi, 'utf8')]));
}

/** Arsip ZIP (deflate) minimal sesuai format yang dibaca Excel. */
function zip(berkas: [string, Buffer][]): Buffer {
  const lokal: Buffer[] = [];
  const pusat: Buffer[] = [];
  let offset = 0;
  // Waktu DOS tetap (1 Jan 2020) supaya isi berkas yang sama menghasilkan byte yang sama.
  const waktu = 0;
  const tanggal = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const [nama, data] of berkas) {
    const namaBuf = Buffer.from(nama, 'utf8');
    const padat = deflateRawSync(data);
    const crc = crc32(data);
    const kepala = Buffer.alloc(30);
    kepala.writeUInt32LE(0x04034b50, 0);
    kepala.writeUInt16LE(20, 4);
    kepala.writeUInt16LE(0x0800, 6);
    kepala.writeUInt16LE(8, 8);
    kepala.writeUInt16LE(waktu, 10);
    kepala.writeUInt16LE(tanggal, 12);
    kepala.writeUInt32LE(crc, 14);
    kepala.writeUInt32LE(padat.length, 18);
    kepala.writeUInt32LE(data.length, 22);
    kepala.writeUInt16LE(namaBuf.length, 26);
    kepala.writeUInt16LE(0, 28);
    lokal.push(kepala, namaBuf, padat);

    const p = Buffer.alloc(46);
    p.writeUInt32LE(0x02014b50, 0);
    p.writeUInt16LE(20, 4);
    p.writeUInt16LE(20, 6);
    p.writeUInt16LE(0x0800, 8);
    p.writeUInt16LE(8, 10);
    p.writeUInt16LE(waktu, 12);
    p.writeUInt16LE(tanggal, 14);
    p.writeUInt32LE(crc, 16);
    p.writeUInt32LE(padat.length, 20);
    p.writeUInt32LE(data.length, 24);
    p.writeUInt16LE(namaBuf.length, 28);
    p.writeUInt32LE(offset, 42);
    pusat.push(p, namaBuf);
    offset += 30 + namaBuf.length + padat.length;
  }
  const ukuranPusat = pusat.reduce((s, b) => s + b.length, 0);
  const akhir = Buffer.alloc(22);
  akhir.writeUInt32LE(0x06054b50, 0);
  akhir.writeUInt16LE(berkas.length, 8);
  akhir.writeUInt16LE(berkas.length, 10);
  akhir.writeUInt32LE(ukuranPusat, 12);
  akhir.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, ...pusat, akhir]);
}
