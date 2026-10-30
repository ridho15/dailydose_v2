/**
 * Preset pesan WhatsApp operasional untuk admin frontdesk studio.
 * Dirancang dengan gaya komunikasi ramah, santun, dan profesional ("Daily Dose Voice").
 */

export interface WhatsAppReminderContext {
  customerName: string;
  phone?: string | null;
  className?: string;
  branchName?: string;
  classTime?: string;
  instructorName?: string;
  remainingSessions?: number;
  checkInUrl?: string;
}

export interface WhatsAppPreset {
  id: 'class_reminder' | 'checkin_link' | 'running_late' | 'package_renewal';
  label: string;
  badge: string;
  description: string;
  generateText: (ctx: WhatsAppReminderContext) => string;
}

function formatCoach(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (/^coach\s+/i.test(trimmed)) return trimmed;
  return `Coach ${trimmed}`;
}

export const WHATSAPP_REMINDER_PRESETS: WhatsAppPreset[] = [
  {
    id: 'class_reminder',
    label: 'Pengingat Jadwal Kelas',
    badge: '⏰ Jadwal Hari Ini',
    description: 'Kirimkan ke member sebelum kelas dimulai sebagai pengingat waktu & studio.',
    generateText: (ctx) =>
      `Halo Kak ${ctx.customerName}! ✨\n\nMengingatkan jadwal latihan *${ctx.className ?? 'Pilates'}* Kakak hari ini jam *${ctx.classTime ?? ''}* di *${ctx.branchName ?? 'Daily Dose Pilates'}*${ctx.instructorName ? ` bersama ${formatCoach(ctx.instructorName)}` : ''}.\n\nMohon hadir 10 menit lebih awal untuk persiapan dan membawa kaus kaki antiselip ya Kak. Ditunggu kedatangannya di studio! 🙏`,
  },
  {
    id: 'checkin_link',
    label: 'Tautan Presensi Mandiri',
    badge: '📲 Presensi Cepat',
    description: 'Bantu member melakukan konfirmasi kehadiran mandiri lewat smartphone.',
    generateText: (ctx) =>
      `Halo Kak ${ctx.customerName}! 👋\n\nUntuk kenyamanan Kakak saat tiba di studio, Kakak dapat melakukan presensi mandiri untuk kelas *${ctx.className ?? 'Pilates'}* hari ini melalui tautan berikut:\n${ctx.checkInUrl ?? 'https://dailydosepilates.com/check-in'}\n\nTerima kasih dan selamat berlatih! 🧘‍♀️`,
  },
  {
    id: 'running_late',
    label: 'Konfirmasi Keterlambatan',
    badge: '🏃 Hampir Mulai',
    description: 'Tanyakan dengan sopan jika kelas segera dimulai dan member belum terlihat di resepsionis.',
    generateText: (ctx) =>
      `Halo Kak ${ctx.customerName}! 🙏\n\nKelas *${ctx.className ?? 'Pilates'}* di *${ctx.branchName ?? 'Daily Dose'}* akan segera dimulai dalam beberapa menit. Apakah Kakak sedang dalam perjalanan ke studio?\n\nMohon kabari kami ya Kak agar instruktur dapat mempersiapkan reformer untuk Kakak. Terima kasih banyak!`,
  },
  {
    id: 'package_renewal',
    label: 'Pengingat Perpanjangan Paket',
    badge: '💳 Sisa Sesi Sedikit',
    description: 'Informasikan sisa sesi yang hampir habis agar rutinitas latihan member tidak terputus.',
    generateText: (ctx) =>
      `Halo Kak ${ctx.customerName}! ✨\n\nTerima kasih telah aktif dan bersemangat latihan bersama kami di *${ctx.branchName ?? 'Daily Dose Pilates'}*. Kami informasikan bahwa paket latihan Kakak saat ini tersisa *${ctx.remainingSessions ?? 1} sesi* lagi.\n\nAgar jadwal latihan rutin Kakak tetap terjaga tanpa jeda, Kakak dapat memperpanjang paket kapan saja di meja resepsionis atau melalui aplikasi. Tim kami siap membantu Kakak! 🙏`,
  },
];

/**
 * Normalisasi nomor WhatsApp lokal (08xx atau +628xx atau 8xx) menjadi format internasional E.164 tanpa tanda plus.
 */
export function cleanWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

/**
 * Bangun tautan langsung wa.me lengkap dengan pesan teks ter-encode.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  const clean = cleanWhatsAppPhone(phone);
  if (!clean) return null;
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}
