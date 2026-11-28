import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { toDataURL } from 'qrcode';
import { PrismaService } from '../database/prisma.service';
import { bacaOpsional, tabelOpsionalAda } from '../foundation/tabel-opsional';
import type { SessionPrincipal } from '../identity/identity.service';
import { ApiProblem } from '../identity/security';
import { dekripsi, enkripsi, jidDariNomor, kunciSesiDariEnv, nomorDariIdAkun } from './wa-tertaut-kunci';

export type StatusWaTertaut = 'BELUM_TERSAMBUNG' | 'MENUNGGU_SCAN' | 'TERSAMBUNG' | 'TERPUTUS';

/** Jeda antar pesan dari satu nomor (ms): pengiriman beruntun cepat paling mudah dianggap spam. */
const JEDA_MIN_MS = 4_000;
const JEDA_ACAK_MS = 6_000;
/** QR WhatsApp kedaluwarsa sendiri; tanpa scan selama ini, percobaan sambung dihentikan. */
const BATAS_MENUNGGU_SCAN_MS = 3 * 60_000;

/** Bentuk modul `baileys` yang dipakai; dimuat saat dibutuhkan supaya tes dan server tanpa fitur ini ringan. */
type Baileys = any;
type Soket = any;

interface Sambungan {
  userId: string;
  soket: Soket | null;
  qr: string | null;
  status: StatusWaTertaut;
  antrean: Promise<unknown>;
  batasScan?: NodeJS.Timeout;
}

/** Pemuat pustaka, bisa diganti di tes. */
export type PemuatBaileys = () => Promise<Baileys>;
const muatBaileys: PemuatBaileys = async () => import('baileys');

/**
 * WhatsApp admin yang ditautkan lewat QR (keputusan pemilik 28 November 2026). Admin scan QR dari HP-nya
 * sendiri (Perangkat tertaut, seperti WhatsApp Web); pesan otomatis ke member cabangnya lalu dikirim dari
 * nomor admin itu. Kunci sesi disimpan terenkripsi di `wa_tertaut_sesi`. Pustaka tidak resmi (Baileys):
 * bila WhatsApp mengubah protokolnya, sambungan bisa putus sampai pustakanya diperbarui.
 */
@Injectable()
export class WaTertautService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WaTertaut');
  private readonly sambungan = new Map<string, Sambungan>();
  private berhenti = false;

  constructor(private readonly db: PrismaService) {}

  /** Bisa diganti di tes. */
  muat: PemuatBaileys = muatBaileys;
  /** Bisa diganti di tes (0 = tanpa jeda). */
  jeda = () => JEDA_MIN_MS + Math.floor(Math.random() * JEDA_ACAK_MS);

  private kunci() {
    return kunciSesiDariEnv();
  }

  /** Fitur siap bila kunci enkripsi ada dan tabelnya sudah dibuat. */
  async siap(): Promise<boolean> {
    return Boolean(this.kunci()) && (await tabelOpsionalAda(this.db, 'wa_tertaut_sesi'));
  }

  private async pastikanSiap() {
    if (!this.kunci())
      throw new ApiProblem('WA_LINK_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    if (!(await tabelOpsionalAda(this.db, 'wa_tertaut_sesi')))
      throw new ApiProblem('WA_LINK_TABLE_MISSING', HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** Hanya Admin cabang yang boleh menautkan WhatsApp-nya; cabangnya cabang penugasan admin. */
  private cabangAdmin(principal: SessionPrincipal): string {
    const peran = principal.roles.find((r) => r.role === 'ADMIN' && r.branchId);
    if (!peran?.branchId) throw new ApiProblem('WA_LINK_ADMIN_ONLY', HttpStatus.FORBIDDEN);
    return peran.branchId;
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !(await this.siap().catch(() => false))) return;
    const tersimpan = await this.db.waTertautSesi.findMany({
      where: { status: 'TERSAMBUNG', data: { not: null } },
      select: { userId: true },
    });
    for (const s of tersimpan)
      void this.sambungkan(s.userId).catch((e) =>
        this.logger.warn(`Sesi WhatsApp ${s.userId} gagal dipulihkan: ${(e as Error).message}`),
      );
  }

  async onModuleDestroy() {
    this.berhenti = true;
    for (const s of this.sambungan.values()) s.soket?.end?.(undefined);
    this.sambungan.clear();
  }

  // ---------- Endpoint admin ----------

  async status(principal: SessionPrincipal) {
    this.cabangAdmin(principal);
    const siap = await this.siap();
    if (!siap) return { siap, status: 'BELUM_TERSAMBUNG' as StatusWaTertaut, nomor: null, qr: null, galat: null };
    const row = await this.db.waTertautSesi.findUnique({ where: { userId: principal.userId } });
    const aktif = this.sambungan.get(principal.userId);
    const status: StatusWaTertaut = aktif?.status ?? (row?.status as StatusWaTertaut | undefined) ?? 'BELUM_TERSAMBUNG';
    return {
      siap,
      status,
      nomor: row?.nomor ?? null,
      qr: status === 'MENUNGGU_SCAN' && aktif?.qr ? await toDataURL(aktif.qr, { margin: 1, width: 280 }) : null,
      galat: status === 'TERPUTUS' ? (row?.terakhirGalat ?? null) : null,
    };
  }

  /** Mulai menautkan: menampilkan QR baru. Sesi lama milik admin ini dibuang dulu. */
  async mulai(principal: SessionPrincipal) {
    const branchId = this.cabangAdmin(principal);
    await this.pastikanSiap();
    await this.tutup(principal.userId, false);
    await this.db.waTertautSesi.upsert({
      where: { userId: principal.userId },
      create: { userId: principal.userId, branchId, status: 'MENUNGGU_SCAN', data: null },
      update: { branchId, status: 'MENUNGGU_SCAN', data: null, nomor: null, terakhirGalat: null },
    });
    await this.sambungkan(principal.userId);
    return this.status(principal);
  }

  async uji(principal: SessionPrincipal) {
    this.cabangAdmin(principal);
    const row = await this.db.waTertautSesi.findUnique({ where: { userId: principal.userId } });
    if (row?.status !== 'TERSAMBUNG' || !row.nomor) throw new ApiProblem('WA_LINK_NOT_CONNECTED', HttpStatus.CONFLICT);
    const hasil = await this.kirimDari(
      principal.userId,
      row.nomor,
      'Tes WhatsApp otomatis Daily Dose Pilates berhasil. Pesan ke member cabang Anda akan dikirim dari nomor ini.',
    );
    if (!hasil.success) throw new ApiProblem('WA_LINK_SEND_FAILED', HttpStatus.BAD_GATEWAY, true);
    return { terkirim: true };
  }

  async putuskan(principal: SessionPrincipal) {
    this.cabangAdmin(principal);
    await this.tutup(principal.userId, true);
    await bacaOpsional('wa_tertaut_sesi', () => this.db.waTertautSesi.deleteMany({ where: { userId: principal.userId } }), null);
    return { status: 'BELUM_TERSAMBUNG' as StatusWaTertaut };
  }

  // ---------- Pengiriman ----------

  /** Admin cabang yang WhatsApp-nya tersambung (yang paling baru aktif); null bila tidak ada. */
  async pengirimCabang(branchId: string): Promise<string | null> {
    if (!(await this.siap())) return null;
    const rows = await this.db.waTertautSesi.findMany({
      where: { branchId, status: 'TERSAMBUNG' },
      orderBy: { terakhirAktif: 'desc' },
      select: { userId: true },
    });
    return rows.find((r) => this.sambungan.get(r.userId)?.status === 'TERSAMBUNG')?.userId ?? null;
  }

  /** Kirim teks dari WhatsApp admin `userId`. Antre per nomor dengan jeda acak; tidak pernah melempar. */
  kirimDari(userId: string, ke: string, teks: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const s = this.sambungan.get(userId);
    const jid = jidDariNomor(ke);
    if (!s || s.status !== 'TERSAMBUNG' || !s.soket) return Promise.resolve({ success: false, error: 'WhatsApp admin tidak tersambung' });
    if (!jid) return Promise.resolve({ success: false, error: `Nomor tujuan tidak valid: ${ke}` });
    const kirim = s.antrean.then(async () => {
      try {
        const pesan = await s.soket.sendMessage(jid, { text: teks });
        return { success: true, messageId: pesan?.key?.id as string | undefined };
      } catch (error) {
        return { success: false, error: (error as Error).message?.slice(0, 200) ?? 'gagal kirim' };
      } finally {
        await new Promise((r) => setTimeout(r, this.jeda()));
      }
    });
    s.antrean = kirim.catch(() => undefined);
    return kirim;
  }

  // ---------- Sambungan Baileys ----------

  private async tutup(userId: string, keluar: boolean) {
    const s = this.sambungan.get(userId);
    if (!s) return;
    this.sambungan.delete(userId);
    if (s.batasScan) clearTimeout(s.batasScan);
    try {
      if (keluar) await s.soket?.logout?.();
      else s.soket?.end?.(undefined);
    } catch {
      // Soket yang sudah mati tidak perlu ditutup lagi.
    }
  }

  private async simpan(userId: string, data: Partial<{ status: string; nomor: string | null; data: string | null; terakhirGalat: string | null }>) {
    await bacaOpsional(
      'wa_tertaut_sesi',
      () => this.db.waTertautSesi.update({ where: { userId }, data: { ...data, terakhirAktif: new Date() } }),
      null,
    );
  }

  /** Membuka (atau memulihkan) soket untuk admin `userId` dengan kunci sesi dari database. */
  private async sambungkan(userId: string): Promise<void> {
    const kunci = this.kunci();
    if (!kunci) return;
    const b = await this.muat();
    const row = await this.db.waTertautSesi.findUnique({ where: { userId } });
    const tersimpan = row?.data ? JSON.parse(dekripsi(row.data, kunci), b.BufferJSON.reviver) : null;
    const state: { creds: any; keys: Record<string, Record<string, unknown>> } = tersimpan ?? {
      creds: b.initAuthCreds(),
      keys: {},
    };
    let tulisTertunda: NodeJS.Timeout | null = null;
    const tulis = () => {
      if (tulisTertunda) clearTimeout(tulisTertunda);
      tulisTertunda = setTimeout(() => {
        void this.simpan(userId, { data: enkripsi(JSON.stringify(state, b.BufferJSON.replacer), kunci) });
      }, 500);
    };
    const keys = {
      get: async (type: string, ids: string[]) => {
        const hasil: Record<string, unknown> = {};
        for (const id of ids) {
          let v = state.keys[type]?.[id];
          if (type === 'app-state-sync-key' && v) v = b.proto.Message.AppStateSyncKeyData.fromObject(v);
          if (v !== undefined) hasil[id] = v;
        }
        return hasil;
      },
      set: async (data: Record<string, Record<string, unknown>>) => {
        for (const type of Object.keys(data)) {
          state.keys[type] ??= {};
          for (const [id, v] of Object.entries(data[type]!)) {
            if (v) state.keys[type]![id] = v;
            else delete state.keys[type]![id];
          }
        }
        tulis();
      },
    };

    const s: Sambungan = this.sambungan.get(userId) ?? {
      userId,
      soket: null,
      qr: null,
      status: tersimpan ? 'TERPUTUS' : 'MENUNGGU_SCAN',
      antrean: Promise.resolve(),
    };
    this.sambungan.set(userId, s);
    const makeWASocket = b.makeWASocket ?? b.default;
    const soket = makeWASocket({
      auth: { creds: state.creds, keys },
      browser: ['Daily Dose Pilates', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: diam,
    });
    s.soket = soket;
    if (!tersimpan) {
      s.batasScan = setTimeout(() => {
        if (s.status !== 'MENUNGGU_SCAN') return;
        void this.tutup(userId, false);
        void this.simpan(userId, { status: 'TERPUTUS', terakhirGalat: 'QR tidak di-scan dalam 3 menit. Klik Sambungkan lagi.' });
      }, BATAS_MENUNGGU_SCAN_MS);
    }

    soket.ev.on('creds.update', (creds: unknown) => {
      Object.assign(state.creds, creds);
      tulis();
    });
    soket.ev.on('connection.update', (u: any) => {
      if (this.sambungan.get(userId) !== s) return;
      if (u.qr) {
        s.qr = u.qr;
        s.status = 'MENUNGGU_SCAN';
      }
      if (u.connection === 'open') {
        s.status = 'TERSAMBUNG';
        s.qr = null;
        if (s.batasScan) clearTimeout(s.batasScan);
        const nomor = nomorDariIdAkun(soket.user?.id);
        tulis();
        void this.simpan(userId, { status: 'TERSAMBUNG', nomor, terakhirGalat: null });
      }
      if (u.connection === 'close') {
        const kode = u.lastDisconnect?.error?.output?.statusCode;
        const keluar = kode === b.DisconnectReason.loggedOut;
        this.sambungan.delete(userId);
        if (this.berhenti) return;
        if (keluar) {
          void this.simpan(userId, {
            status: 'TERPUTUS',
            data: null,
            terakhirGalat: 'Perangkat tertaut dihapus dari HP. Klik Sambungkan dan scan QR lagi.',
          });
          return;
        }
        if (s.status === 'MENUNGGU_SCAN' && !tersimpan && kode !== b.DisconnectReason.restartRequired) {
          if (s.batasScan) clearTimeout(s.batasScan);
          void this.simpan(userId, { status: 'TERPUTUS', terakhirGalat: 'QR kedaluwarsa sebelum di-scan. Klik Sambungkan lagi.' });
          return;
        }
        // Putus sementara (jaringan, restart setelah scan): sambung ulang memakai kunci tersimpan.
        setTimeout(() => {
          if (!this.berhenti && !this.sambungan.has(userId))
            void this.sambungkan(userId).catch((e) => this.logger.warn(`Sambung ulang ${userId}: ${(e as Error).message}`));
        }, 3_000);
      }
    });
  }
}

/** Logger pino minimal yang tidak mencetak apa pun (log Baileys sangat ramai). */
const diam: any = {
  level: 'silent',
  child: () => diam,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};
