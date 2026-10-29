import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { CheckInMethod, Prisma, SessionMutationType } from '@prisma/client';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { isWithinGeofence } from '../foundation/geofence.util';
import { AuditService } from '../foundation/audit.service';
import { alamatFotoMeja } from './check-in-desk.service';
import { IdempotencyService } from '../foundation/idempotency.service';
import type { SessionPrincipal } from '../identity/identity.service';
import { PolicyService } from '../identity/policy.service';
import { ApiProblem, ENTITY_ID_REGEX } from '../identity/security';

const UUID = ENTITY_ID_REGEX;
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Token QR check-in pelanggan = HMAC(id baris). Id baris acak (UUID v4) dan hanya diketahui pemilik booking serta
 * staf, sehingga kerahasiaan token bersandar pada id itu; rahasia server menambah satu lapis lagi.
 * Hasilnya 43 karakter base64url, sama dengan bentuk token acak sebelumnya.
 */
export function deriveCheckInToken(rowId: string): string {
  const secret = process.env.CHECK_IN_TOKEN_SECRET || process.env.SESSION_SECRET || 'dailydose-kiosk-secret';
  return createHmac('sha256', secret).update(`customer-check-in:v1:${rowId}`).digest('base64url');
}

export type CheckInWindowState = 'TOO_EARLY' | 'OPEN' | 'EXPIRED';

export function checkInWindowState(startAt: Date, endAt: Date, now: Date): CheckInWindowState {
  const opensAt = new Date(startAt.getTime() - 30 * 60_000);
  if (now < opensAt) return 'TOO_EARLY';
  return now < endAt ? 'OPEN' : 'EXPIRED';
}

export function isOwningCustomer(
  principal: Pick<SessionPrincipal, 'userId' | 'roles'>,
  customerUserId: string,
): boolean {
  return (
    principal.roles.some(({ role }) => role === 'CUSTOMER') &&
    principal.userId === customerUserId
  );
}

export function isOwningInstructor(
  principal: { userId: string; capabilities?: readonly string[] },
  instructorUserId: string,
): boolean {
  return (
    principal.userId === instructorUserId &&
    Boolean(principal.capabilities?.includes('attendance:self'))
  );
}

function rawTokenFrom(value: string): string {
  const trimmed = value.trim();
  if (RAW_TOKEN.test(trimmed)) return trimmed;
  if (trimmed.startsWith('dd-checkin:v1:')) {
    const token = trimmed.slice('dd-checkin:v1:'.length);
    if (RAW_TOKEN.test(token)) return token;
  }
  if (trimmed.startsWith('ddcheckin:v1:'))
    return rawTokenFrom(trimmed.replace('ddcheckin:', 'dd-checkin:'));
  try {
    const url = new URL(trimmed);
    const token = new URLSearchParams(url.hash.slice(1)).get('token') ?? '';
    const decoded = decodeURIComponent(token);
    if (decoded.startsWith('dd-checkin:v1:') || decoded.startsWith('ddcheckin:v1:'))
      return rawTokenFrom(decoded);
    if (RAW_TOKEN.test(decoded)) return decoded;
  } catch {
    // invalid token format
  }
  throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);
}

function maskedPhone(phone: string | null) {
  if (!phone) return null;
  return `${phone.slice(0, 4)}••••${phone.slice(-3)}`;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private requireBranch(principal: SessionPrincipal, branchId: string, capability: string) {
    if (
      !this.policy.hasCapability(principal, 'branch:all', branchId) &&
      !this.policy.hasCapability(principal, capability, branchId)
    )
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  private authorizeCustomerToken(
    principal: SessionPrincipal,
    booking: { classSlot: { branchId: string }; userId: string },
    staffCapability: 'attendance:read' | 'attendance:manage',
  ) {
    if (isOwningCustomer(principal, booking.userId)) return;
    this.policy.requireCapability(principal.capabilities, staffCapability);
    this.requireBranch(principal, booking.classSlot.branchId, staffCapability);
  }

  /** Issue a QR check-in token for a specific booking (staff or owning customer action). */
  async issue(
    principal: SessionPrincipal,
    bookingId: string,
    input: { expectedVersion?: number },
    _idempotencyKey: string,
    _correlationId: string,
  ) {
    if (!UUID.test(bookingId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`pemesanan_kelas\` WHERE \`id\` = ${bookingId} FOR UPDATE`;
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: bookingId },
          include: {
            user: { select: { displayName: true, phone: true } },
            classSlot: {
              include: {
                classType: { select: { name: true } },
                branch: { select: { id: true, code: true, name: true, timezone: true } },
                studio: { select: { name: true } },
                instructor: { select: { displayName: true } },
              },
            },
          },
        });
        if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.authorizeCustomerToken(principal, booking, 'attendance:manage');
        if (
          booking.status !== 'BOOKED' ||
          !['PUBLISHED', 'CONFIRMED'].includes(booking.classSlot.status)
        )
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        if (booking.classSlot.endAt <= new Date())
          throw new ApiProblem('CHECK_IN_WINDOW_CLOSED', HttpStatus.GONE);

        // Token yang masih berlaku dipakai ulang: membuka QR berkali-kali (beranda, detail booking, tautan dari
        // staf) harus menampilkan QR yang sama. Token asli tidak disimpan, jadi ia diturunkan dari id baris
        // lewat HMAC dan dicocokkan dengan hash yang tersimpan. Token lama bentuk acak (tidak dapat diturunkan),
        // token milik slot yang sudah berpindah jadwal, dan token yang dicabut tidak dipakai ulang.
        const now = new Date();
        const active = await tx.checkInToken.findMany({
          where: { bookingId, isUsed: false, expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
        });
        const reusable = active.find(
          (row) =>
            row.expiresAt.getTime() === booking.classSlot.endAt.getTime() &&
            row.token === sha256(deriveCheckInToken(row.id)),
        );
        let token: { id: string; bookingId: string; expiresAt: Date };
        let rawToken: string;
        if (reusable) {
          token = reusable;
          rawToken = deriveCheckInToken(reusable.id);
          const stale = active.filter((row) => row.id !== reusable.id).map((row) => row.id);
          if (stale.length > 0)
            await tx.checkInToken.updateMany({ where: { id: { in: stale } }, data: { isUsed: true } });
        } else {
          await tx.checkInToken.updateMany({
            where: { bookingId, isUsed: false },
            data: { isUsed: true },
          });
          const id = randomUUID();
          rawToken = deriveCheckInToken(id);
          token = await tx.checkInToken.create({
            data: { id, bookingId, token: sha256(rawToken), expiresAt: booking.classSlot.endAt },
          });
        }

        const payload = `dd-checkin:v1:${rawToken}`;
        const base = (process.env.PUBLIC_WEB_BASE_URL ?? 'http://127.0.0.1:32120').replace(/\/$/u, '');
        const passUrl = `${base}/check-in-pass#token=${encodeURIComponent(payload)}`;
        const checkInLink = `${base}/check-in/${rawToken}`;
        const digits = booking.user.phone?.replace(/\D/gu, '') ?? '';
        const schedule = new Intl.DateTimeFormat('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: booking.classSlot.branch.timezone,
        }).format(booking.classSlot.startAt);
        const message = `Halo ${booking.user.displayName}, berikut link check-in kehadiran Daily Dose untuk kelas ${schedule}. Buka link ini saat tiba di studio sebelum latihan dimulai: ${checkInLink}`;

        return {
          id: token.id,
          purpose: 'CUSTOMER_CHECK_IN' as const,
          bookingId: token.bookingId,
          expiresAt: token.expiresAt.toISOString(),
          // Ringkasan kelas untuk halaman QR pelanggan, agar tidak bergantung pada parameter alamat.
          className: booking.classSlot.classType.name,
          branchName: booking.classSlot.branch.name,
          studioName: booking.classSlot.studio?.name ?? null,
          instructorName: booking.classSlot.instructor?.displayName ?? null,
          startAt: booking.classSlot.startAt.toISOString(),
          endAt: booking.classSlot.endAt.toISOString(),
          timezone: booking.classSlot.branch.timezone,
          token: rawToken,
          qrPayload: payload,
          passUrl,
          checkInLink,
          maskedCustomerPhone: maskedPhone(booking.user.phone ?? null),
          whatsappUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null,
          message,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Issue QR tokens in bulk for all bookings in a class slot. */
  async issueBulk(
    principal: SessionPrincipal,
    classSlotId: string,
    input: { bookingIds?: string[] },
    idempotencyKey: string,
    correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    if (!UUID.test(classSlotId) || !idempotencyKey?.trim())
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    const classSlot = await this.db.slotKelas.findUnique({
      where: { id: classSlotId },
      select: { branchId: true },
    });
    if (!classSlot) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.requireBranch(principal, classSlot.branchId, 'attendance:manage');
    const bookings = await this.db.pemesananKelas.findMany({
      where: {
        classSlotId,
        status: 'BOOKED',
        ...(input.bookingIds?.length ? { id: { in: input.bookingIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const items = [];
    for (const booking of bookings) {
      try {
        items.push({
          bookingId: booking.id,
          ok: true,
          result: await this.issue(principal, booking.id, {}, `${idempotencyKey}:${booking.id}`, correlationId),
        });
      } catch (error) {
        items.push({
          bookingId: booking.id,
          ok: false,
          errorCode: error instanceof ApiProblem ? error.code : 'CHECK_IN_ISSUANCE_FAILED',
        });
      }
    }
    return { classSlotId, items };
  }

  /**
   * Terbitkan QR presensi instruktur untuk satu kelas. Diterbitkan staf studio (`attendance:manage`) dan
   * dipindai instruktur pemilik kelas dengan sesinya sendiri, jadi instruktur tidak dapat menerbitkan
   * bukti kehadirannya sendiri. Token terikat ke kelas (bukan booking) sehingga kelas tanpa booking
   * tetap bisa dipakai; menerbitkan ulang mencabut token lama yang belum terpakai.
   */
  async issueInstructor(
    principal: SessionPrincipal,
    classSlotId: string,
    _idempotencyKey: string,
    _correlationId: string,
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    if (!UUID.test(classSlotId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`slot_kelas\` WHERE \`id\` = ${classSlotId} FOR UPDATE`;
        const slot = await tx.slotKelas.findUnique({
          where: { id: classSlotId },
          include: {
            classType: { select: { name: true } },
            branch: { select: { id: true, code: true, name: true, timezone: true } },
          },
        });
        if (!slot || !this.policy.hasCapability(principal, 'attendance:manage', slot.branchId))
          throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        if (!slot.instructorId || slot.status !== 'CONFIRMED')
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        const window = checkInWindowState(slot.startAt, slot.endAt, now);
        if (window === 'TOO_EARLY') throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);
        if (window === 'EXPIRED') throw new ApiProblem('CHECK_IN_WINDOW_CLOSED', HttpStatus.GONE);

        await tx.instructorCheckInToken.updateMany({
          where: { classSlotId, usedAt: null },
          data: { usedAt: now },
        });
        const rawToken = randomBytes(32).toString('base64url');
        const token = await tx.instructorCheckInToken.create({
          data: {
            classSlotId,
            token: sha256(rawToken),
            expiresAt: slot.endAt,
            issuedById: principal.userId,
          },
        });

        return {
          id: token.id,
          purpose: 'INSTRUCTOR_CHECK_IN' as const,
          resourceType: 'CLASS_SLOT' as const,
          resourceId: classSlotId,
          expiresAt: token.expiresAt.toISOString(),
          token: rawToken,
          qrPayload: `dd-checkin:v1:${rawToken}`,
          className: slot.classType.name,
          branch: slot.branch,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Consume (validate and record) a customer QR check-in token. */
  async consume(
    principal: SessionPrincipal,
    input: { token: string },
    idempotencyKey: string,
    correlationId: string,
    now = new Date(),
  ) {
    if (!idempotencyKey?.trim())
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    const rawToken = rawTokenFrom(input.token);
    const tokenHash = sha256(rawToken);
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT \`id\` FROM \`check_in_token\` WHERE \`token\` = ${tokenHash} FOR UPDATE
        `;
        const id = rows[0]?.id;
        if (!id) throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);
        const token = await tx.checkInToken.findUnique({
          where: { id },
          include: {
            booking: {
              include: {
                attendance: true,
                // Foto selfie dibawa serta supaya meja depan bisa mencocokkan orang yang
                // berdiri di depannya dengan pemilik paket, bukan sekadar membaca namanya.
                user: { select: { displayName: true, profile: { select: { selfieUrl: true } } } },
                classSlot: {
                  include: {
                    classType: { select: { name: true } },
                    branch: { select: { code: true, name: true, timezone: true } },
                  },
                },
              },
            },
          },
        });
        if (!token) throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);
        this.authorizeCustomerToken(principal, token.booking, 'attendance:manage');

        // Already checked in — return existing attendance (idempotent)
        if (token.isUsed && token.booking.attendance) {
          return this.attendanceView(token.booking, token.booking.attendance);
        }
        if (token.isUsed) throw new ApiProblem('CHECK_IN_TOKEN_REVOKED', HttpStatus.GONE);

        const window = checkInWindowState(
          token.booking.classSlot.startAt,
          token.booking.classSlot.endAt,
          now,
        );
        if (window === 'TOO_EARLY') throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);
        if (window === 'EXPIRED' || token.expiresAt <= now)
          throw new ApiProblem('CHECK_IN_WINDOW_CLOSED', HttpStatus.GONE);
        if (
          token.booking.status !== 'BOOKED' ||
          token.booking.classSlot.status !== 'CONFIRMED'
        )
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);

        const attendance = await tx.kehadiranPelanggan.create({
          data: {
            id: randomUUID(),
            bookingId: token.bookingId,
            checkedInAt: now,
          },
        });
        await tx.pemesananKelas.update({
          where: { id: token.bookingId },
          data: { status: 'ATTENDED' },
        });
        await tx.checkInToken.update({
          where: { id: token.id },
          data: { isUsed: true },
        });
        return this.attendanceView(token.booking, attendance);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Backfill/manual attendance recording by staff. */
  async backfillCustomer(
    principal: SessionPrincipal,
    input: { bookingId: string; reason: string; expectedVersion?: number },
    idempotencyKey: string,
    correlationId: string,
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    if (
      !UUID.test(input.bookingId) ||
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 128 ||
      input.reason?.trim().length < 3 ||
      input.reason.trim().length > 500
    )
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.idempotency.execute(
      {
        scope: `attendance:customer-backfill:${input.bookingId}`,
        key: idempotencyKey,
        payload: input,
        ttlMs: 86_400_000,
        leaseMs: 30_000,
      },
      async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`pemesanan_kelas\` WHERE \`id\` = ${input.bookingId} FOR UPDATE`;
        const booking = await tx.pemesananKelas.findUnique({
          where: { id: input.bookingId },
          include: {
            attendance: true,
            user: { select: { displayName: true, profile: { select: { selfieUrl: true } } } },
            classSlot: {
              include: {
                classType: { select: { name: true } },
                branch: { select: { code: true, name: true, timezone: true } },
              },
            },
          },
        });
        if (!booking) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
        this.requireBranch(principal, booking.classSlot.branchId, 'attendance:manage');
        if (booking.attendance)
          throw new ApiProblem('ATTENDANCE_ALREADY_RECORDED', HttpStatus.CONFLICT);
        if (!['BOOKED', 'NO_SHOW'].includes(booking.status))
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        if (!['CONFIRMED', 'COMPLETED'].includes(booking.classSlot.status))
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
        if (booking.classSlot.startAt > now)
          throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);

        // Rule #9: Batas toleransi backfill admin adalah maksimal H+2 jam setelah kelas selesai
        const cutoffBackfill = new Date(booking.classSlot.endAt.getTime() + 2 * 3_600_000);
        if (now > cutoffBackfill)
          throw new ApiProblem('ADMIN_BACKFILL_WINDOW_CLOSED', HttpStatus.GONE);

        const attendance = await tx.kehadiranPelanggan.create({
          data: {
            id: randomUUID(),
            bookingId: booking.id,
            method: CheckInMethod.MANUAL_FRONTDESK,
            recordedById: principal.userId,
            notes: input.reason,
            checkedInAt: now,
          },
        });
        await tx.pemesananKelas.update({
          where: { id: booking.id },
          data: { status: 'ATTENDED' },
        });

        // Jika kelas sudah COMPLETED dan customer baru di-backfill oleh admin:
        // Potong sesi via SessionLedger jika belum pernah tercatat (Rule #1)
        if (booking.classSlot.status === 'COMPLETED') {
          const existingLedger = await tx.sessionLedger.findFirst({
            where: {
              referenceId: booking.id,
              type: SessionMutationType.ATTEND,
            },
          });
          if (!existingLedger) {
            const customerPackage = await tx.paketPelanggan.findUnique({
              where: { id: booking.customerPackageId },
            });
            if (customerPackage) {
              const remainingAfter = customerPackage.remainingSessions - 1;
              await tx.sessionLedger.create({
                data: {
                  customerPackageId: customerPackage.id,
                  type: SessionMutationType.ATTEND,
                  amount: -1,
                  balanceAfter: remainingAfter,
                  referenceId: booking.id,
                  notes: `Admin backfill attendance: ${booking.classSlot.classType.name} at ${booking.classSlot.branch.name} (${input.reason})`,
                  createdById: principal.userId,
                },
              });
              await tx.paketPelanggan.update({
                where: { id: customerPackage.id },
                data: {
                  usedSessions: { increment: 1 },
                  remainingSessions: { decrement: 1 },
                  status: remainingAfter <= 0 ? 'DEPLETED' : customerPackage.status,
                },
              });
            }
          }
        }

        await this.audit?.catat(tx, {
          actorId: principal.userId,
          branchId: booking.classSlot.branchId,
          correlationId,
          action: 'attendance.customer_backfilled',
          objectType: 'Booking',
          objectId: booking.id,
          targetUserId: booking.userId,
          reason: input.reason.trim(),
          beforeMasked: { bookingStatus: booking.status },
          afterMasked: {
            bookingStatus: 'ATTENDED',
            classSlotId: booking.classSlotId,
            sessionDeducted: booking.classSlot.status === 'COMPLETED',
          },
        });

        return {
          status: HttpStatus.CREATED,
          body: {
            id: attendance.id,
            purpose: 'CUSTOMER_BACKFILL',
            resourceId: booking.id,
            status: 'CHECKED_IN',
            checkedInAt: attendance.checkedInAt.toISOString(),
            customerName: booking.user.displayName,
            className: booking.classSlot.classType.name,
            branch: booking.classSlot.branch,
            startAt: booking.classSlot.startAt.toISOString(),
            endAt: booking.classSlot.endAt.toISOString(),
          } as Prisma.InputJsonValue,
        };
      },
    );
  }

  private attendanceView(
    booking: {
      userId: string;
      classSlotId: string;
      user: { displayName: string; profile?: { selfieUrl: string | null } | null };
      classSlot: {
        branchId: string;
        startAt: Date;
        endAt: Date;
        classType: { name: string };
        branch: { code: string; name: string; timezone: string };
      };
    },
    attendance: { id: string; checkedInAt: Date },
  ) {
    return {
      id: attendance.id,
      purpose: 'CUSTOMER_CHECK_IN' as const,
      resourceId: booking.classSlotId,
      status: 'CHECKED_IN',
      checkedInAt: attendance.checkedInAt.toISOString(),
      customerName: booking.user.displayName,
      /** Null bila member belum pernah mengunggah selfie; antarmuka menyebutkannya apa adanya. */
      customerPhotoUrl: booking.user.profile?.selfieUrl
        ? alamatFotoMeja(booking.userId, booking.classSlot.branchId)
        : null,
      className: booking.classSlot.classType.name,
      branch: booking.classSlot.branch,
      startAt: booking.classSlot.startAt.toISOString(),
      endAt: booking.classSlot.endAt.toISOString(),
    };
  }

  // --- Indonesian Domain Aliases ---
  async status(principal: SessionPrincipal, id: string) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    const token = await this.db.checkInToken.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            user: { select: { id: true, displayName: true, email: true } },
            classSlot: {
              include: {
                classType: { select: { name: true } },
                branch: { select: { id: true, code: true, name: true, timezone: true } },
              },
            },
          },
        },
      },
    });
    if (!token) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);

    const now = new Date();
    const isExpired = token.expiresAt < now;
    return {
      id: token.id,
      bookingId: token.bookingId,
      isUsed: token.isUsed,
      isExpired,
      status: token.isUsed ? 'USED' : isExpired ? 'EXPIRED' : 'ACTIVE',
      expiresAt: token.expiresAt.toISOString(),
      booking: token.booking
        ? {
            id: token.booking.id,
            userId: token.booking.userId,
            status: token.booking.status,
            userName: token.booking.user.displayName,
            className: token.booking.classSlot.classType.name,
          }
        : null,
    };
  }

  async revoke(
    principal: SessionPrincipal,
    id: string,
    _body: { expectedVersion?: number; reason?: string },
    _correlationId: string,
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    const token = await this.db.checkInToken.findUnique({ where: { id } });
    if (!token) throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (token.isUsed) throw new ApiProblem('TOKEN_ALREADY_USED', HttpStatus.CONFLICT);

    await this.db.checkInToken.update({
      where: { id },
      data: { isUsed: true },
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      correlationId: _correlationId,
      action: 'attendance.token_revoked',
      objectType: 'CheckInToken',
      objectId: id,
      reason: _body?.reason?.trim() || null,
    });

    return { id, status: 'REVOKED' };
  }

  async consumeInstructor(
    principal: SessionPrincipal,
    body: { token: string; latitude?: number; longitude?: number },
    _idempotencyKey: string,
    _correlationId: string,
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:self');
    const tokenStr = (body.token ?? '').trim();
    const tokenHash = sha256(tokenStr.replace(/^dd-checkin:v1:/u, ''));

    const token = await this.db.instructorCheckInToken.findUnique({
      where: { token: tokenHash },
      include: {
        classSlot: {
          select: {
            id: true,
            branchId: true,
            instructorId: true,
            status: true,
            startAt: true,
            endAt: true,
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
                latitude: true,
                longitude: true,
                geofenceRadiusMeters: true,
              },
            },
          },
        },
      },
    });
    if (!token) throw new ApiProblem('INVALID_TOKEN', HttpStatus.UNPROCESSABLE_ENTITY);
    if (token.usedAt) throw new ApiProblem('TOKEN_ALREADY_USED', HttpStatus.CONFLICT);
    if (token.expiresAt < now) throw new ApiProblem('TOKEN_EXPIRED', HttpStatus.GONE);

    // Hanya instruktur pemilik kelas yang boleh mencatat presensinya, dan hanya di jendela check-in.
    const slot = token.classSlot;
    if (slot.instructorId !== principal.userId)
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (slot.status !== 'CONFIRMED')
      throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
    const window = checkInWindowState(slot.startAt, slot.endAt, now);
    if (window === 'TOO_EARLY') throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);
    if (window === 'EXPIRED') throw new ApiProblem('CHECK_IN_WINDOW_CLOSED', HttpStatus.GONE);

    // Validasi Geofencing jika cabang memiliki koordinat GPS
    const branch = slot.branch;
    let distanceMeters: number | null = null;
    let withinGeofence = true;

    if (branch && branch.latitude !== null && branch.longitude !== null) {
      if (
        body.latitude === undefined ||
        body.longitude === undefined ||
        Number.isNaN(Number(body.latitude)) ||
        Number.isNaN(Number(body.longitude))
      ) {
        throw new ApiProblem('GEOLOCATION_REQUIRED', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const geo = isWithinGeofence(
        { latitude: Number(body.latitude), longitude: Number(body.longitude) },
        { latitude: Number(branch.latitude), longitude: Number(branch.longitude) },
        branch.geofenceRadiusMeters ?? 100,
      );
      distanceMeters = geo.distanceMeters;
      withinGeofence = geo.withinGeofence;

      if (!withinGeofence) {
        throw new ApiProblem('OUT_OF_GEOFENCE', HttpStatus.CONFLICT);
      }
    }

    await this.db.$transaction(async (tx) => {
      await tx.instructorCheckInToken.update({ where: { id: token.id }, data: { usedAt: now } });
      await tx.kehadiranInstruktur.upsert({
        where: { classSlotId: slot.id },
        create: {
          classSlotId: slot.id,
          instructorId: principal.userId,
          method: CheckInMethod.QR_SCAN,
          checkedInAt: now,
          latitude: body.latitude !== undefined ? new Prisma.Decimal(body.latitude) : null,
          longitude: body.longitude !== undefined ? new Prisma.Decimal(body.longitude) : null,
          distanceMeters,
          isWithinGeofence: withinGeofence,
        },
        update: {
          latitude: body.latitude !== undefined ? new Prisma.Decimal(body.latitude) : null,
          longitude: body.longitude !== undefined ? new Prisma.Decimal(body.longitude) : null,
          distanceMeters,
          isWithinGeofence: withinGeofence,
        },
      });
    });

    return {
      status: HttpStatus.OK,
      body: {
        success: true,
        type: 'INSTRUCTOR',
        classSlotId: slot.id,
        checkedInAt: now.toISOString(),
        distanceMeters,
        isWithinGeofence: withinGeofence,
        branchName: branch?.name ?? null,
      },
    };
  }

  /**
   * Verifikasi manual presensi instruktur oleh staf (mis. instruktur lupa scan atau kelas tanpa
   * booking sehingga token QR tidak dapat diterbitkan). Idempotent: presensi yang sudah tercatat
   * tidak ditimpa.
   */
  async verifyInstructorAttendance(
    principal: SessionPrincipal,
    classSlotId: string,
    body: { notes?: string },
    now = new Date(),
  ) {
    this.policy.requireCapability(principal.capabilities, 'attendance:manage');
    if (!UUID.test(classSlotId))
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);
    const notes = body?.notes?.trim() || null;
    if (notes && notes.length > 255)
      throw new ApiProblem('VALIDATION_ERROR', HttpStatus.UNPROCESSABLE_ENTITY);

    const slot = await this.db.slotKelas.findUnique({
      where: { id: classSlotId },
      select: {
        id: true,
        branchId: true,
        instructorId: true,
        status: true,
        startAt: true,
        endAt: true,
        instructorAttendance: { select: { checkedInAt: true, method: true } },
      },
    });
    if (!slot || !this.policy.hasCapability(principal, 'attendance:manage', slot.branchId))
      throw new ApiProblem('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!slot.instructorId || !['CONFIRMED', 'COMPLETED'].includes(slot.status))
      throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);
    if (checkInWindowState(slot.startAt, slot.endAt, now) === 'TOO_EARLY')
      throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);

    if (slot.instructorAttendance) {
      return {
        classSlotId: slot.id,
        checkedInAt: slot.instructorAttendance.checkedInAt.toISOString(),
        method: slot.instructorAttendance.method,
        alreadyRecorded: true,
      };
    }

    // upsert (bukan create) agar klik ganda serentak tidak melanggar unique classSlotId.
    const created = await this.db.kehadiranInstruktur.upsert({
      where: { classSlotId: slot.id },
      create: {
        classSlotId: slot.id,
        instructorId: slot.instructorId,
        method: CheckInMethod.MANUAL_FRONTDESK,
        checkedInAt: now,
        recordedById: principal.userId,
        notes,
      },
      update: {},
    });
    await this.audit?.catat(null, {
      actorId: principal.userId,
      branchId: slot.branchId,
      action: 'attendance.instructor_verified',
      objectType: 'ClassSlot',
      objectId: slot.id,
      targetUserId: slot.instructorId,
      reason: notes,
      afterMasked: { method: created.method, checkedInAt: created.checkedInAt.toISOString() },
    });
    return {
      classSlotId: slot.id,
      checkedInAt: created.checkedInAt.toISOString(),
      method: created.method,
      alreadyRecorded: false,
    };
  }

  /** Dapatkan ringkasan info kelas dari token check-in customer (Rule #1). */
  async getCustomerLinkInfo(tokenInput: string, now = new Date()) {
    const raw = rawTokenFrom(tokenInput);
    const tokenHash = sha256(raw);

    const token = await this.db.checkInToken.findUnique({
      where: { token: tokenHash },
      include: {
        booking: {
          include: {
            attendance: true,
            user: { select: { displayName: true } },
            classSlot: {
              include: {
                classType: { select: { name: true } },
                branch: { select: { code: true, name: true, timezone: true } },
                instructor: { select: { displayName: true } },
                studio: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!token) throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);

    const slot = token.booking.classSlot;
    const opensAt = new Date(slot.startAt.getTime() - 60 * 60_000);
    const isTooEarly = now < opensAt;
    const isExpired = now > slot.endAt || token.expiresAt < now;
    const isAttended = Boolean(token.booking.attendance) || token.booking.status === 'ATTENDED';

    return {
      bookingId: token.bookingId,
      customerName: token.booking.user.displayName,
      className: slot.classType.name,
      branchName: slot.branch.name,
      studioName: slot.studio?.name ?? null,
      instructorName: slot.instructor?.displayName ?? null,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      timezone: slot.branch.timezone,
      status: isAttended ? 'ATTENDED' : isExpired ? 'EXPIRED' : isTooEarly ? 'TOO_EARLY' : 'OPEN',
      canConfirm: !isAttended && !isExpired && !isTooEarly,
    };
  }

  /** Konfirmasi kehadiran customer via tautan web (Rule #1). */
  async confirmCustomerLink(tokenInput: string, now = new Date()) {
    const raw = rawTokenFrom(tokenInput);
    const tokenHash = sha256(raw);

    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT \`id\` FROM \`check_in_token\` WHERE \`token\` = ${tokenHash} FOR UPDATE
        `;
        const id = rows[0]?.id;
        if (!id) throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);

        const token = await tx.checkInToken.findUnique({
          where: { id },
          include: {
            booking: {
              include: {
                attendance: true,
                user: { select: { id: true, displayName: true, email: true } },
                classSlot: {
                  include: {
                    classType: { select: { name: true } },
                    branch: { select: { code: true, name: true, timezone: true } },
                    instructor: { select: { displayName: true } },
                    studio: { select: { name: true } },
                  },
                },
              },
            },
          },
        });
        if (!token) throw new ApiProblem('CHECK_IN_TOKEN_INVALID', HttpStatus.NOT_FOUND);

        // Idempotent: jika sudah hadir
        if (token.booking.attendance || token.booking.status === 'ATTENDED') {
          return {
            ok: true,
            status: 'ALREADY_ATTENDED',
            bookingId: token.bookingId,
            customerName: token.booking.user.displayName,
            className: token.booking.classSlot.classType.name,
            branchName: token.booking.classSlot.branch.name,
            checkedInAt: token.booking.attendance?.checkedInAt?.toISOString() ?? now.toISOString(),
            message: 'Kehadiran Anda sudah terkonfirmasi sebelumnya.',
          };
        }

        if (token.isUsed) throw new ApiProblem('CHECK_IN_TOKEN_REVOKED', HttpStatus.GONE);

        // Window waktu: mulai 60 menit sebelum kelas hingga akhir kelas
        const opensAt = new Date(token.booking.classSlot.startAt.getTime() - 60 * 60_000);
        if (now < opensAt) throw new ApiProblem('CHECK_IN_TOO_EARLY', HttpStatus.CONFLICT);
        if (now > token.booking.classSlot.endAt || token.expiresAt < now)
          throw new ApiProblem('CHECK_IN_WINDOW_CLOSED', HttpStatus.GONE);
        if (!['BOOKED', 'NO_SHOW'].includes(token.booking.status))
          throw new ApiProblem('INVALID_STATE_TRANSITION', HttpStatus.CONFLICT);

        const attendance = await tx.kehadiranPelanggan.create({
          data: {
            id: randomUUID(),
            bookingId: token.bookingId,
            method: CheckInMethod.WEB_LINK,
            checkedInAt: now,
          },
        });

        await tx.pemesananKelas.update({
          where: { id: token.bookingId },
          data: { status: 'ATTENDED' },
        });

        await tx.checkInToken.update({
          where: { id: token.id },
          data: { isUsed: true },
        });

        return {
          ok: true,
          status: 'ATTENDED',
          bookingId: token.bookingId,
          attendanceId: attendance.id,
          customerName: token.booking.user.displayName,
          className: token.booking.classSlot.classType.name,
          instructorName: token.booking.classSlot.instructor?.displayName ?? null,
          branchName: token.booking.classSlot.branch.name,
          studioName: token.booking.classSlot.studio?.name ?? null,
          checkedInAt: attendance.checkedInAt.toISOString(),
          message: 'Kehadiran Anda berhasil dikonfirmasi. Selamat berlatih!',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
