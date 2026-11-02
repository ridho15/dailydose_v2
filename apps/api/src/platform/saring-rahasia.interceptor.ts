import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * Kolom yang tidak boleh pernah keluar dari API, di respons mana pun. Banyak query memakai
 * `include` sehingga baris Prisma utuh (mis. instruktur di jadwal kelas) bisa ikut terkirim;
 * penyaring ini jaring pengaman terakhir di samping tampilan yang sudah memilih kolomnya sendiri.
 */
const KOLOM_RAHASIA = new Set([
  'passwordHash',
  'rememberToken',
  'kioskPinHash',
  'tokenHash',
  'refreshTokenHash',
  'secretHash',
]);

export function saringRahasia<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== 'object' || depth > 12) return value;
  if (Buffer.isBuffer(value) || value instanceof Date || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map((item) => saringRahasia(item, depth + 1)) as T;
  const proto = Object.getPrototypeOf(value);
  // Hanya objek biasa (hasil Prisma/literal); objek khusus seperti Decimal dibiarkan.
  if (proto !== Object.prototype && proto !== null) return value;
  const hasil: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (KOLOM_RAHASIA.has(key)) continue;
    hasil[key] = saringRahasia(item, depth + 1);
  }
  return hasil as T;
}

@Injectable()
export class SaringRahasiaInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => saringRahasia(body)));
  }
}
