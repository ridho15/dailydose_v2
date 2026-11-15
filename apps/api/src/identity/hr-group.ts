import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Akun HR Group (SSO OIDC bersama Daily Dose dan Limitless Fitness). Kontrak: endpoint
 * `${HRG_ISSUER}/.well-known/openid-configuration`, klien `dailydose`, tanda tangan back-channel
 * `hex(HMAC-SHA256(HRG_BRIDGE_SECRET, timestamp + "." + rawBody))` di header X-HRG-Timestamp/X-HRG-Signature.
 * Semua fitur mati kecuali HRG_ENABLED=true dan kelima variabel lainnya terisi.
 */
export interface HrGroupConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  bridgeSecret: string;
}

export const HRG_APP = 'dailydose';
export const HRG_FLOW_COOKIE = 'dd_hrg_flow';
export const HRG_COOKIE_PATH = '/api/v1/auth/hr-group';
export const HRG_FLOW_TTL_SECONDS = 600;
export const HRG_SIGNATURE_WINDOW_SECONDS = 300;

export function hrGroupConfig(env: NodeJS.ProcessEnv = process.env): HrGroupConfig | null {
  if (env.HRG_ENABLED?.trim() !== 'true') return null;
  const issuer = env.HRG_ISSUER?.trim().replace(/\/+$/u, '');
  const clientId = env.HRG_CLIENT_ID?.trim();
  const clientSecret = env.HRG_CLIENT_SECRET?.trim();
  const redirectUri = env.HRG_REDIRECT_URI?.trim();
  const bridgeSecret = env.HRG_BRIDGE_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret || !redirectUri || !bridgeSecret) return null;
  return { issuer, clientId, clientSecret, redirectUri, bridgeSecret };
}

/** Tujuan setelah masuk: hanya jalur relatif di situs ini (bukan `//host`, `/\host`, atau skema lain). */
export function safeReturnTo(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  try {
    const parsed = new URL(value, 'https://dailydose.invalid');
    if (parsed.origin !== 'https://dailydose.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function signHrg(secret: string, timestamp: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

export type HrgSignatureCheck = 'ok' | 'stale' | 'bad_signature';

/** Timestamp di luar ±300 detik atau tanda tangan salah ditolak; perbandingan constant-time. */
export function verifyHrgSignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): HrgSignatureCheck {
  if (!timestamp || !/^\d{1,12}$/u.test(timestamp)) return 'stale';
  if (Math.abs(nowSeconds - Number(timestamp)) > HRG_SIGNATURE_WINDOW_SECONDS) return 'stale';
  if (!signature || !/^[0-9a-fA-F]{64}$/u.test(signature)) return 'bad_signature';
  const expected = Buffer.from(signHrg(secret, timestamp, rawBody), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given) ? 'ok' : 'bad_signature';
}

export interface HrgFlow {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

const flowKey = (clientSecret: string) =>
  createHash('sha256').update(`dailydose:hrg-flow:${clientSecret}`).digest();

/** State, nonce, dan PKCE verifier disimpan di cookie HttpOnly terenkripsi (AES-256-GCM), bukan di URL. */
export function sealFlow(flow: HrgFlow, clientSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', flowKey(clientSecret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(flow), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function openFlow(sealed: string | undefined, clientSecret: string, nowSeconds = Math.floor(Date.now() / 1000)): HrgFlow | null {
  if (!sealed || sealed.length > 4096) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', flowKey(clientSecret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const flow = JSON.parse(text) as HrgFlow;
    if (typeof flow.state !== 'string' || typeof flow.nonce !== 'string' || typeof flow.verifier !== 'string')
      return null;
    if (typeof flow.exp !== 'number' || flow.exp < nowSeconds) return null;
    return { ...flow, returnTo: safeReturnTo(flow.returnTo) };
  } catch {
    return null;
  }
}

export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

export const randomToken = () => randomBytes(32).toString('base64url');

/** Bentuk nomor yang mungkin tersimpan di data lama untuk satu nomor E.164 Indonesia. */
export function phoneVariants(e164: string): string[] {
  const variants = new Set([e164]);
  if (e164.startsWith('+62')) {
    variants.add(`0${e164.slice(3)}`);
    variants.add(e164.slice(1));
  }
  return [...variants];
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'u').exec(header ?? '');
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
