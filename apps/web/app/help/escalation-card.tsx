'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Mail,
  MessageCircle,
  PhoneCall,
  ShieldAlert,
} from 'lucide-react';
import { useSessionContext } from '../session-context';
import { useStudioPreference } from '../components/public/public-experience';

const CENTRAL_WHATSAPP_E164 = '62895329736127';
const CENTRAL_SUPPORT_EMAIL = 'halo@dailydosepilates.id';

export interface EscalationCardProps {
  contextTitle?: string;
  errorCode?: string;
  branchName?: string;
  className?: string;
}

interface BranchContactOption {
  id: string;
  name: string;
  whatsappE164: string | null;
  supportEmail: string | null;
}

export function EscalationCard({
  contextTitle = 'Kendala Layanan',
  errorCode,
  branchName,
  className = '',
}: EscalationCardProps) {
  const sessionContext = useSessionContext();
  const studioPreference = useStudioPreference();

  // Daftar cabang dari preferensi publik atau context sesi
  const branches = useMemo<BranchContactOption[]>(() => {
    if (studioPreference?.whatsappStudios?.length) {
      return studioPreference.whatsappStudios.map((s) => ({
        id: s.id,
        name: s.nama,
        whatsappE164: null,
        supportEmail: null,
      }));
    }
    if (sessionContext?.session?.branches?.length) {
      return sessionContext.session.branches.map((b) => ({
        id: b.id,
        name: b.name,
        whatsappE164: null,
        supportEmail: null,
      }));
    }
    return [];
  }, [studioPreference?.whatsappStudios, sessionContext?.session?.branches]);

  // Cabang aktif saat ini
  const activeBranch = sessionContext?.activeBranch ?? studioPreference?.preferredStudio ?? null;

  const initialBranchId = activeBranch?.id ?? branches[0]?.id ?? '';
  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialBranchId);

  const currentBranch = useMemo(() => {
    return branches.find((b) => b.id === selectedBranchId) ?? activeBranch ?? null;
  }, [branches, selectedBranchId, activeBranch]);

  // Target nomor WhatsApp (E.164 tanpa tanda plus untuk link wa.me)
  const targetWhatsapp = useMemo(() => {
    const raw =
      (currentBranch as any)?.supportWhatsappE164 ||
      (activeBranch as any)?.supportWhatsappE164 ||
      CENTRAL_WHATSAPP_E164;
    return String(raw).replace(/\D/g, '') || CENTRAL_WHATSAPP_E164;
  }, [currentBranch, activeBranch]);

  // Target alamat Email dukungan
  const targetEmail = useMemo(() => {
    // ponyail: jika cabang memiliki support_email terdaftar, gunakan itu; jika tidak, fallback ke pusat
    const branchEmail = (currentBranch as any)?.supportEmail || (activeBranch as any)?.supportEmail;
    return typeof branchEmail === 'string' && branchEmail.trim()
      ? branchEmail.trim()
      : CENTRAL_SUPPORT_EMAIL;
  }, [currentBranch, activeBranch]);

  const activeBranchLabel = currentBranch?.name || branchName || 'Studio Pusat';

  // Template Pesan WhatsApp
  const whatsappHref = useMemo(() => {
    const text = [
      `Halo Tim Dukungan Daily Dose Pilates (${activeBranchLabel}),`,
      `Saya membutuhkan bantuan terkait: *${contextTitle}*.`,
      errorCode ? `Kode kendala / error: *${errorCode}*` : null,
      `Waktu pelaporan: ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`,
      '',
      'Mohon petunjuk dan tindak lanjut penanganannya. Terima kasih.',
    ]
      .filter((line) => line !== null)
      .join('\n');

    return `https://wa.me/${targetWhatsapp}?text=${encodeURIComponent(text)}`;
  }, [activeBranchLabel, contextTitle, errorCode, targetWhatsapp]);

  // Template Email Mailto
  const mailtoHref = useMemo(() => {
    const subject = `[Bantuan Daily Dose] ${contextTitle}${errorCode ? ` - ${errorCode}` : ''}`;
    const body = [
      `Halo Tim Bantuan Daily Dose Pilates (${activeBranchLabel}),`,
      '',
      `Saya melaporkan kendala pada alur: ${contextTitle}`,
      errorCode ? `Kode Error / Respons: ${errorCode}` : '',
      `Waktu kejadian: ${new Date().toLocaleString('id-ID')}`,
      '',
      'Informasi data pendukung yang saya siapkan:',
      '1. Nama lengkap akun: ',
      '2. Nomor WhatsApp terdaftar: ',
      '3. Screenshot bukti kendala terlampir pada email ini.',
      '',
      'Terima kasih.',
    ].join('\n');

    return `mailto:${targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [activeBranchLabel, contextTitle, errorCode, targetEmail]);

  return (
    <div
      aria-label={`Jalur Eskalasi & Kontak Bantuan - ${contextTitle}`}
      className={`rounded-dd-sm border border-dd-forest/20 bg-gradient-to-br from-dd-forest/5 via-white to-dd-sand/10 p-5 md:p-6 text-dd-ink ${className}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-dd-forest/10 px-3 py-1 text-xs font-semibold text-dd-forest">
            <PhoneCall className="size-3.5" aria-hidden="true" />
            <span>Jalur Eskalasi Dukungan Resmi</span>
          </div>
          <h3 className="text-base font-bold text-dd-ink md:text-lg">
            Solusi Belum Berhasil? Hubungi Tim Dukungan Cabang
          </h3>
          <p className="text-xs text-dd-muted md:text-sm">
            Jika kendala teknis atau operasional berlanjut setelah mengikuti solusi di atas, hubungi
            admin studio cabang terkait atau kontak pusat.
          </p>
        </div>

        {branches.length > 1 && (
          <div className="shrink-0">
            <label
              htmlFor="escalation-branch-select"
              className="block text-[11px] font-semibold text-dd-muted uppercase"
            >
              Pilih Cabang Terkait:
            </label>
            <div className="relative mt-1">
              <select
                id="escalation-branch-select"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full appearance-none rounded-dd-sm border border-dd-line bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-dd-ink shadow-sm focus:border-dd-forest focus:outline-none focus:ring-1 focus:ring-dd-forest"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-dd-muted" />
            </div>
          </div>
        )}
      </div>

      {/* Checklist Persiapan Sebelum Menghubungi */}
      <div className="mt-4 rounded-dd-sm border border-dd-line/80 bg-white/80 p-3.5">
        <p className="flex items-center gap-1.5 text-xs font-bold text-dd-ink">
          <ShieldAlert className="size-4 text-dd-forest" aria-hidden="true" />
          <span>Siapkan 5 Hal Ini Sebelum Menghubungi Admin:</span>
        </p>
        <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-dd-muted sm:grid-cols-2 lg:grid-cols-3">
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 shrink-0 text-dd-forest" />
            <span>1. Nama lengkap akun Anda</span>
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 shrink-0 text-dd-forest" />
            <span>2. Cabang &amp; studio yang dituju</span>
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 shrink-0 text-dd-forest" />
            <span>3. Waktu kejadian tepat</span>
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 shrink-0 text-dd-forest" />
            <span>4. Kode / teks error persis</span>
          </li>
          <li className="flex items-center gap-1.5 sm:col-span-2 lg:col-span-1">
            <CheckCircle2 className="size-3.5 shrink-0 text-dd-forest" />
            <span>5. Tangkapan layar (*screenshot*)</span>
          </li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[42px] items-center gap-2 rounded-dd-sm bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          <span>Chat WhatsApp ({activeBranchLabel})</span>
        </a>

        <a
          href={mailtoHref}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-dd-sm border border-dd-line bg-white px-4 py-2 text-xs font-bold text-dd-ink shadow-sm transition hover:border-dd-forest hover:bg-dd-forest/5 focus:outline-none focus:ring-2 focus:ring-dd-forest focus:ring-offset-1"
        >
          <Mail className="size-4 text-dd-forest" aria-hidden="true" />
          <span>Kirim Email Dukungan ({targetEmail})</span>
        </a>

        <span className="text-[11px] text-dd-muted">
          *Bila kontak cabang tidak aktif, pesan otomatis diteruskan ke nomor &amp; email pusat
          resmi.
        </span>
      </div>
    </div>
  );
}
