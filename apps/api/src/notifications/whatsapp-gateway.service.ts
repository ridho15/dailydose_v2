import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  recipientPhone: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED_DUPLICATE';
  error?: string;
}

export interface SendWhatsAppOptions {
  to: string;
  text: string;
  recipientType: 'CUSTOMER' | 'INSTRUCTOR' | 'ADMIN' | 'OWNER' | 'MANAGER';
  reminderType: string;
  payload?: Record<string, any>;
  bypassDeduplication?: boolean;
  dedupWindowMs?: number; // Jendela waktu deduplikasi (ms)
  sentAt?: Date;
  /** Gambar PNG yang dikirim bersama `text` sebagai keterangannya (mis. QR kehadiran). */
  imagePng?: Buffer;
}

export interface WhatsAppProvider {
  name: string;
  sendMessage(
    to: string,
    text: string,
    payload?: Record<string, any>,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
  /** Kirim gambar PNG dengan keterangan. */
  sendImage?(
    to: string,
    png: Buffer,
    caption: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  name = 'MOCK';
  public sentMessages: Array<{
    to: string;
    text: string;
    payload?: Record<string, any>;
    sentAt: Date;
  }> = [];

  async sendMessage(to: string, text: string, payload?: Record<string, any>) {
    const messageId = `mock-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sentMessages.push({ to, text, payload, sentAt: new Date() });
    return { success: true, messageId };
  }

  async sendImage(to: string, png: Buffer, caption: string) {
    const messageId = `mock-wa-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sentMessages.push({
      to,
      text: caption,
      payload: { image: 'image/png', bytes: png.length },
      sentAt: new Date(),
    });
    return { success: true, messageId };
  }
}

export class OfficialWhatsAppProvider implements WhatsAppProvider {
  name = 'META_CLOUD_API';
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly apiUrl: string;

  constructor(token: string, phoneNumberId: string, apiUrl = 'https://graph.facebook.com/v21.0') {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.apiUrl = apiUrl;
  }

  async sendMessage(to: string, text: string, _payload?: Record<string, any>) {
    try {
      const cleanPhone = to.replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) {
        return { success: false, error: 'Nomor telepon tujuan tidak valid' };
      }
      const response = await fetch(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { preview_url: true, body: text },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Meta API HTTP ${response.status}: ${errorBody}` };
      }

      const data = (await response.json()) as any;
      const messageId = data.messages?.[0]?.id ?? `wa-${Date.now()}`;
      return { success: true, messageId };
    } catch (err: any) {
      return { success: false, error: err.message || 'WhatsApp network error' };
    }
  }

  /** Meta Cloud API: gambar diunggah sebagai media lebih dulu, lalu dikirim dengan id-nya. */
  async sendImage(to: string, png: Buffer, caption: string) {
    try {
      const cleanPhone = to.replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 8) {
        return { success: false, error: 'Nomor telepon tujuan tidak valid' };
      }
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'image/png');
      form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'qr.png');
      const upload = await fetch(`${this.apiUrl}/${this.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      });
      if (!upload.ok) {
        return {
          success: false,
          error: `Meta media HTTP ${upload.status}: ${await upload.text()}`,
        };
      }
      const media = (await upload.json()) as { id?: string };
      if (!media.id) return { success: false, error: 'Meta media tanpa id' };

      const response = await fetch(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'image',
          image: { id: media.id, caption },
        }),
      });
      if (!response.ok) {
        return {
          success: false,
          error: `Meta API HTTP ${response.status}: ${await response.text()}`,
        };
      }
      const data = (await response.json()) as any;
      return { success: true, messageId: data.messages?.[0]?.id ?? `wa-${Date.now()}` };
    } catch (err: any) {
      return { success: false, error: err.message || 'WhatsApp network error' };
    }
  }
}

/**
 * Membaca konfigurasi penyedia WhatsApp dari environment. Menerima kedua nama token yang dipakai
 * dokumentasi (`WHATSAPP_ACCESS_TOKEN`) dan kode lama (`WHATSAPP_API_TOKEN`); `WHATSAPP_PROVIDER=mock`
 * memaksa mode uji. Mengembalikan null bila belum lengkap (gateway jatuh ke mode uji).
 */
export function resolveWhatsAppConfig(env: NodeJS.ProcessEnv) {
  if (env.WHATSAPP_PROVIDER?.trim().toLowerCase() === 'mock') return null;
  const token = (env.WHATSAPP_API_TOKEN || env.WHATSAPP_ACCESS_TOKEN)?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return null;
  const version = env.WHATSAPP_API_VERSION?.trim() || 'v21.0';
  return { token, phoneNumberId, apiUrl: `https://graph.facebook.com/${version}` };
}

@Injectable()
export class WhatsAppGatewayService {
  private readonly logger = new Logger(WhatsAppGatewayService.name);
  private readonly inFlightLocks = new Set<string>();
  private provider: WhatsAppProvider;
  public readonly mockProvider = new MockWhatsAppProvider();

  constructor(private readonly db: PrismaService) {
    const config = resolveWhatsAppConfig(process.env);

    if (config) {
      this.provider = new OfficialWhatsAppProvider(
        config.token,
        config.phoneNumberId,
        config.apiUrl,
      );
      this.logger.log(
        `WhatsApp Gateway aktif menggunakan Official Provider: ${this.provider.name}`,
      );
    } else {
      this.provider = this.mockProvider;
      this.logger.log(`WhatsApp Gateway aktif menggunakan ${this.provider.name} (Dev / Test mode)`);
    }
  }

  /** Nama provider aktif: `MOCK` berarti pesan hanya dicatat, tidak dikirim ke WhatsApp. */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Set provider secara manual (berguna saat test/mocking)
   */
  setProvider(provider: WhatsAppProvider) {
    this.provider = provider;
  }

  /**
   * Normalisasi nomor telepon ke format E.164 Indonesia (+62)
   */
  normalizePhone(phone: string | null | undefined): string {
    if (!phone || typeof phone !== 'string') return '';
    const trimmed = phone.trim();
    if (!trimmed) return '';
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) return '';

    if (trimmed.startsWith('+')) {
      return `+${digitsOnly}`;
    }
    if (digitsOnly.startsWith('62')) {
      return `+${digitsOnly}`;
    }
    if (digitsOnly.startsWith('0')) {
      return `+62${digitsOnly.slice(1)}`;
    }
    if (digitsOnly.startsWith('8')) {
      return `+62${digitsOnly}`;
    }
    return `+${digitsOnly}`;
  }

  /**
   * Kirim pesan WhatsApp dengan pengecekan Idempotency via ReminderLog
   */
  async sendMessage(options: SendWhatsAppOptions): Promise<WhatsAppSendResult> {
    const phone = this.normalizePhone(options.to);
    const dedupWindowMs = options.dedupWindowMs ?? 3 * 3_600_000; // Default 3 jam
    const now = options.sentAt ?? new Date();

    // Validasi format nomor telepon dasar (E.164 minimal 8 digit)
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      this.logger.warn(
        `[INVALID_PHONE] Nomor telepon tujuan tidak valid: "${options.to}" untuk reminder ${options.reminderType}`,
      );
      return {
        success: false,
        provider: this.provider.name,
        recipientPhone: phone || (typeof options.to === 'string' ? options.to : ''),
        status: 'FAILED',
        error: `Nomor telepon tujuan tidak valid: ${options.to}`,
      };
    }

    const flightKey = `${phone}:${options.reminderType}`;

    // 1. Idempotency Guard via In-Flight Lock & ReminderLog
    if (!options.bypassDeduplication) {
      if (this.inFlightLocks.has(flightKey)) {
        this.logger.debug(
          `[DEDUPLICATED] Pesan ke ${phone} (${options.reminderType}) dilewati karena sedang dalam proses pengiriman serentak.`,
        );
        return {
          success: true,
          messageId: 'in-flight-duplicate',
          provider: 'IDEMPOTENCY_GUARD',
          recipientPhone: phone,
          status: 'SKIPPED_DUPLICATE',
        };
      }

      // Kunci in-flight secara sinkron SEBELUM yield await apapun
      this.inFlightLocks.add(flightKey);

      const cutoffTime = new Date(now.getTime() - dedupWindowMs);
      const existingLog = await this.db.reminderLog.findFirst({
        where: {
          recipientPhone: phone,
          reminderType: options.reminderType,
          status: 'SENT',
          sentAt: { gte: cutoffTime, lte: now },
        },
        orderBy: { sentAt: 'desc' },
      });

      if (existingLog) {
        this.logger.debug(
          `[DEDUPLICATED] Pesan ke ${phone} (${options.reminderType}) dilewati karena sudah terkirim pada ${existingLog.sentAt.toISOString()}`,
        );
        return {
          success: true,
          messageId: existingLog.id,
          provider: 'IDEMPOTENCY_GUARD',
          recipientPhone: phone,
          status: 'SKIPPED_DUPLICATE',
        };
      }
    }

    try {
      // 2. Eksekusi Pengiriman Pesan via Provider
      const result = options.imagePng
        ? this.provider.sendImage
          ? await this.provider.sendImage(phone, options.imagePng, options.text)
          : { success: false, error: 'Penyedia WhatsApp tidak mendukung gambar' }
        : await this.provider.sendMessage(phone, options.text, options.payload);

      // 3. Catat ke tabel ReminderLog
      const status = result.success ? 'SENT' : 'FAILED';
      const logRecord = await this.db.reminderLog.create({
        data: {
          recipientPhone: phone,
          recipientType: options.recipientType,
          reminderType: options.reminderType,
          payload: {
            ...(options.payload ?? {}),
            provider: this.provider.name,
            messageId: result.messageId,
            textPreview: options.text.slice(0, 160),
            ...(options.imagePng ? { image: 'image/png' } : {}),
            error: result.error,
          },
          status,
          sentAt: now,
        },
      });

      return {
        success: result.success,
        messageId: result.messageId ?? logRecord.id,
        provider: this.provider.name,
        recipientPhone: phone,
        status,
        error: result.error,
      };
    } finally {
      if (!options.bypassDeduplication) {
        setTimeout(() => this.inFlightLocks.delete(flightKey), 1000);
      }
    }
  }

  private buildLogsWhere(params: { phone?: string; reminderType?: string; status?: string }) {
    const where: any = {};
    if (params.phone) {
      where.recipientPhone = { contains: params.phone.replace(/[^0-9]/g, '') };
    }
    if (params.reminderType) {
      where.reminderType = params.reminderType;
    }
    if (params.status) {
      where.status = params.status;
    }
    return where;
  }

  /**
   * Kueri log pengingat
   */
  async listLogs(params: {
    phone?: string;
    reminderType?: string;
    status?: string;
    limit?: number;
    skip?: number;
    page?: number;
  }) {
    const where = this.buildLogsWhere(params);
    const take = params.limit ?? 50;
    const skip = params.skip ?? (params.page ? (params.page - 1) * take : undefined);

    return this.db.reminderLog.findMany({
      where,
      take,
      skip,
      orderBy: { sentAt: 'desc' },
    });
  }

  /**
   * Hitung total log pengingat sesuai filter
   */
  async countLogs(params: { phone?: string; reminderType?: string; status?: string }) {
    const where = this.buildLogsWhere(params);
    return this.db.reminderLog.count({ where });
  }
}
