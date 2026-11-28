import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Enkripsi kunci sesi WhatsApp tertaut. Kunci sesi setara akses penuh ke akun WhatsApp admin, jadi
 * tidak pernah disimpan polos: AES-256-GCM dengan kunci dari env WA_SESSION_KEY (minimal 32 karakter).
 */
export function kunciSesiDariEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const rahasia = env.WA_SESSION_KEY?.trim();
  if (!rahasia || rahasia.length < 32) return null;
  return createHash('sha256').update(rahasia).digest();
}

export function enkripsi(teks: string, kunci: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kunci, iv);
  const isi = Buffer.concat([cipher.update(teks, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), isi.toString('base64')].join('.');
}

export function dekripsi(sandi: string, kunci: Buffer): string {
  const [versi, iv, tag, isi] = sandi.split('.');
  if (versi !== 'v1' || !iv || !tag || isi === undefined) throw new Error('Format sesi WhatsApp tidak dikenal');
  const decipher = createDecipheriv('aes-256-gcm', kunci, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(isi, 'base64')), decipher.final()]).toString('utf8');
}

/** Nomor (08xx, 628xx, +628xx) menjadi JID WhatsApp `628xx@s.whatsapp.net`; null bila tidak bisa dipakai. */
export function jidDariNomor(nomor: string | null | undefined): string | null {
  const angka = (nomor ?? '').replace(/\D/g, '');
  let e164: string | null = null;
  if (angka.startsWith('62')) e164 = angka;
  else if (angka.startsWith('0')) e164 = `62${angka.slice(1)}`;
  else if (angka.startsWith('8')) e164 = `62${angka}`;
  if (!e164 || e164.length < 10 || e164.length > 15) return null;
  return `${e164}@s.whatsapp.net`;
}

/** Nomor akun dari id pengguna Baileys (`628xx:12@s.whatsapp.net`). */
export function nomorDariIdAkun(id: string | undefined | null): string | null {
  const m = /^([0-9]{8,15})(?::[0-9]+)?@/.exec(id ?? '');
  return m ? m[1]! : null;
}
