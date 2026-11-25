import { HttpStatus } from '@nestjs/common';
import type { SessionPrincipal } from './identity.service';
import { ApiProblem } from './security';

/**
 * Rute yang boleh dipanggil akun Petugas Check-in. Selain ini ditolak di guard, apa pun kapabilitas
 * yang diperiksa endpoint-nya: beberapa endpoint lama hanya membedakan staf dari member, jadi
 * pembatasan lewat kapabilitas saja tidak cukup untuk akun yang memang hanya untuk meja check-in.
 */
const RUTE: Array<[method: string, pola: RegExp]> = [
  ['GET', /^\/me$/],
  ['GET', /^\/me\/notifications(\/unread-count)?$/],
  ['PATCH', /^\/me\/notifications\/[^/]+\/read$/],
  ['POST', /^\/me\/notifications\/read-all$/],
  ['POST', /^\/auth\/(logout|refresh|password\/change)$/],
  ['GET', /^\/auth\/security$/],
  ['GET', /^\/branches$/],
  ['GET', /^\/attendance\/desk$/],
  ['POST', /^\/attendance\/desk\/scan$/],
  ['GET', /^\/attendance\/desk\/members\/[^/]+\/photo$/],
  ['POST', /^\/check-ins\/customers\/backfill$/],
  // Peserta satu kelas untuk "Catat kehadiran manual" (classSlotId wajib, diperiksa di bawah).
  ['GET', /^\/bookings$/],
];

export function petugasCheckinSaja(principal: Pick<SessionPrincipal, 'roles'>): boolean {
  return principal.roles.length > 0 && principal.roles.every((r) => r.role === 'CHECKIN_STAFF');
}

/** Melempar 403 bila akun petugas check-in memanggil rute di luar layar check-in. */
export function pastikanRutePetugas(
  principal: Pick<SessionPrincipal, 'roles'>,
  method: string,
  path: string,
  query: Record<string, unknown> = {},
): void {
  if (!petugasCheckinSaja(principal)) return;
  const rute = path.replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  const boleh = RUTE.some(([m, pola]) => m === method.toUpperCase() && pola.test(rute));
  const bookingTanpaKelas = rute === '/bookings' && !(typeof query.classSlotId === 'string' && query.classSlotId);
  if (!boleh || bookingTanpaKelas) throw new ApiProblem('FORBIDDEN', HttpStatus.FORBIDDEN);
}
