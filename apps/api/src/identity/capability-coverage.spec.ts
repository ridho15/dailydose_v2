/**
 * Cakupan izin (statis). Menangkap kelas bug "izin diminta tetapi tidak dimiliki siapa pun" dan
 * "Super Owner tidak punya izin yang dibutuhkan halaman/endpoint":
 *
 *  (i)   setiap izin yang diminta kode API ada pada ≥1 role;
 *  (ii)  setiap izin di registry halaman web ada pada ≥1 role;
 *  (iii) SUPER_OWNER memegang semua izin yang diminta API/registry, kecuali izin self-service
 *        (pelanggan/instruktur) dan pengecualian eksplisit di bawah.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROLE_CAPABILITIES } from './role-capabilities';

const API_SRC = path.resolve(__dirname, '..');
const REGISTRY = path.resolve(__dirname, '../../../web/app/lib/frontend-pages.ts');

/** Izin yang sengaja belum dipegang siapa pun. Tiap entri wajib beralasan. */
const UNGRANTED_ON_PURPOSE: Record<string, string> = {};

const SELF_SERVICE = /(^|:)self(:|$)|^customer:self$|^class:assigned:read$|^voucher:redeem$/;
const CAPABILITY = /^[a-z][a-z-]*(?::[a-z][a-z-]*)+$/;
const HELPERS =
  /\b(?:requireCapability|requireAnyCapability|requireGlobalCapability|requireScopedCapability|requireBranchScope|hasCapability|capabilityBranchScope)\(|\.require\(|capabilities\.(?:includes|some|every)\(/g;

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function callArguments(text: string, open: number): string {
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length && index < open + 1500; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open, open + 300);
}

const quoted = (text: string) =>
  [...text.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]!).filter((value) => CAPABILITY.test(value));

/** Izin yang diminta kode API → berkas pertama yang memintanya. */
function requiredByApi(): Map<string, string> {
  const required = new Map<string, string>();
  for (const file of walk(API_SRC)) {
    if (file.endsWith('role-capabilities.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(HELPERS)) {
      const open = match.index + match[0].lastIndexOf('(');
      for (const capability of quoted(callArguments(text, open)))
        if (!required.has(capability)) required.set(capability, path.relative(API_SRC, file));
    }
  }
  return required;
}

function requiredByRegistry(): Set<string> {
  const text = fs.readFileSync(REGISTRY, 'utf8');
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:mutationCapabilities|capabilities): \[([^\]]*)\]/g))
    for (const capability of quoted(match[1]!)) found.add(capability);
  return found;
}

const granted = new Set(Object.values(ROLE_CAPABILITIES).flat());
const superOwner = new Set(ROLE_CAPABILITIES.SUPER_OWNER);
const enabled = fs.existsSync(REGISTRY);

describe('capability coverage', () => {
  const api = requiredByApi();

  it('finds the capability checks it is supposed to audit', () => {
    expect(api.size).toBeGreaterThan(40);
    expect(api.has('finance:manage')).toBe(true);
    expect(api.has('ledger:adjust:decide')).toBe(true);
  });

  it('every capability the API requires is held by at least one role', () => {
    const orphaned = [...api.entries()]
      .filter(([capability]) => !granted.has(capability) && !(capability in UNGRANTED_ON_PURPOSE))
      .map(([capability, file]) => `${capability}  (diminta di ${file})`);
    expect(orphaned).toEqual([]);
  });

  (enabled ? it : it.skip)('every capability the web registry references is held by some role', () => {
    const orphaned = [...requiredByRegistry()].filter(
      (capability) => !granted.has(capability) && !(capability in UNGRANTED_ON_PURPOSE),
    );
    expect(orphaned).toEqual([]);
  });

  (enabled ? it : it.skip)('Super Owner holds every non-self-service capability the API or pages need', () => {
    const needed = new Set([...api.keys(), ...requiredByRegistry()]);
    const missing = [...needed]
      .filter(
        (capability) =>
          !superOwner.has(capability) &&
          !SELF_SERVICE.test(capability) &&
          !(capability in UNGRANTED_ON_PURPOSE),
      )
      .sort();
    expect(missing).toEqual([]);
  });

  it('documents every intentionally ungranted capability with a reason', () => {
    for (const [capability, reason] of Object.entries(UNGRANTED_ON_PURPOSE)) {
      expect(granted.has(capability)).toBe(false);
      expect(reason.length).toBeGreaterThan(30);
    }
  });

  it('Super Owner keeps the branch grants that used to come only through the SUPERADMIN alias', () => {
    for (const capability of ['branch:manage', 'branch:operate', 'branch:own'])
      expect(superOwner.has(capability)).toBe(true);
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual(
      ['ADMIN', 'CHECKIN_STAFF', 'CUSTOMER', 'FINANCE', 'INSTRUCTOR', 'MANAGER', 'OWNER', 'SUPER_OWNER'],
    );
  });
});
