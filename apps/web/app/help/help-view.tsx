'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  KeyRound,
  Laptop,
  LayoutDashboard,
  Menu,
  Search,
  Smartphone,
  UserCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { publicContainer } from '../components/public/public-styles';
import { useSessionContext } from '../session-context';
import { isCustomerOnlySession } from '../lib/session-audience';
import { EscalationCard } from './escalation-card';
import {
  HELP_ERROR_CATALOG,
  HELP_FAQS,
  HELP_GLOSSARY,
  HELP_SECTIONS_ADMIN,
  HELP_SECTIONS_CUSTOMER,
  HELP_SECTIONS_SUPER_ADMIN,
  type HelpAudienceRole,
  type HelpScreenshot,
  type HelpSection,
} from './help-data';

interface HelpScreenshotViewerProps {
  screenshot?: HelpScreenshot;
}

function HelpScreenshotViewer({ screenshot }: HelpScreenshotViewerProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [variant, setVariant] = useState<'primary' | 'secondary'>('primary');

  if (!screenshot) return null;

  const hasSecondary = Boolean(screenshot.secondaryDesktopUrl);
  const currentTitle =
    variant === 'secondary' && screenshot.secondaryTitle
      ? screenshot.secondaryTitle
      : screenshot.title;
  const currentUrl =
    variant === 'secondary'
      ? device === 'mobile' && screenshot.secondaryMobileUrl
        ? screenshot.secondaryMobileUrl
        : (screenshot.secondaryDesktopUrl ?? screenshot.desktopUrl)
      : device === 'mobile' && screenshot.mobileUrl
        ? screenshot.mobileUrl
        : screenshot.desktopUrl;

  return (
    <div className="flex flex-col justify-between rounded-dd-sm border border-dd-line/80 bg-white p-4 shadow-xs sm:p-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dd-line/60 pb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-dd-muted">
              Tangkapan Layar Asli
            </span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              Live Capture
            </span>
          </div>

          {/* Toggle Device (Desktop / Mobile) */}
          <div className="inline-flex rounded-dd-sm border border-dd-line bg-dd-surface p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setDevice('desktop')}
              className={`inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-xs font-semibold transition ${
                device === 'desktop'
                  ? 'bg-white text-dd-forest shadow-xs'
                  : 'text-dd-muted hover:text-dd-ink'
              }`}
            >
              <Laptop className="size-3.5" />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setDevice('mobile')}
              className={`inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-xs font-semibold transition ${
                device === 'mobile'
                  ? 'bg-white text-dd-forest shadow-xs'
                  : 'text-dd-muted hover:text-dd-ink'
              }`}
            >
              <Smartphone className="size-3.5" />
              <span>Mobile</span>
            </button>
          </div>
        </div>

        {/* Secondary Variant Switcher */}
        {hasSecondary && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setVariant('primary')}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${
                variant === 'primary'
                  ? 'bg-dd-forest text-white'
                  : 'bg-dd-surface text-dd-muted hover:bg-dd-line hover:text-dd-ink'
              }`}
            >
              1. Layar Utama
            </button>
            <button
              type="button"
              onClick={() => setVariant('secondary')}
              className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${
                variant === 'secondary'
                  ? 'bg-dd-forest text-white'
                  : 'bg-dd-surface text-dd-muted hover:bg-dd-line hover:text-dd-ink'
              }`}
            >
              2. {screenshot.secondaryTitle ?? 'Layar Lanjutan'}
            </button>
          </div>
        )}

        <h3 className="mt-3 text-xs sm:text-sm font-bold text-dd-ink">{currentTitle}</h3>
        <p className="mt-1 text-xs text-dd-muted">{screenshot.description}</p>
      </div>

      {/* Frame Gambar Screenshot Nyata */}
      <div className="mt-4 overflow-hidden rounded-dd-sm border border-dd-line bg-dd-surface/30">
        <div className="relative flex items-center justify-center p-2 sm:p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt={`${currentTitle} (${device})`}
            loading="lazy"
            className={`rounded object-contain shadow-xs transition-all duration-200 ${
              device === 'mobile' ? 'max-h-[360px] w-auto max-w-[220px]' : 'max-h-[280px] w-full'
            }`}
          />
        </div>
        <div className="flex items-center justify-between border-t border-dd-line/60 bg-white px-3 py-1.5 text-[11px] text-dd-muted">
          <span>
            Resolusi: {device === 'desktop' ? '1280 × 800 (Desktop)' : '390 × 844 (Mobile)'}
          </span>
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-dd-forest hover:underline"
          >
            <span>Buka Penuh</span>
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function HelpView() {
  const searchParams = useSearchParams();
  const session = useSessionContext()?.session;
  const isStaff = Boolean(session && !isCustomerOnlySession(session));

  // Inisialisasi tab dari URL param (?role=customer | admin | super-admin)
  const initialRole =
    (searchParams.get('role') as HelpAudienceRole) || (isStaff ? 'admin' : 'customer');
  const [activeRole, setActiveRole] = useState<HelpAudienceRole>(
    ['customer', 'admin', 'super-admin'].includes(initialRole) ? initialRole : 'customer',
  );

  const [searchQuery, setSearchQuery] = useState('');

  // Sinkronkan state saat searchParams berubah
  useEffect(() => {
    const roleParam = searchParams.get('role') as HelpAudienceRole;
    if (roleParam && ['customer', 'admin', 'super-admin'].includes(roleParam)) {
      setActiveRole(roleParam);
    }
  }, [searchParams]);

  const handleRoleChange = (role: HelpAudienceRole) => {
    setActiveRole(role);
    const url = new URL(window.location.href);
    url.searchParams.set('role', role);
    window.history.replaceState({}, '', url.toString());
  };

  const sectionsForActiveRole: HelpSection[] = useMemo(() => {
    switch (activeRole) {
      case 'admin':
        return HELP_SECTIONS_ADMIN;
      case 'super-admin':
        return HELP_SECTIONS_SUPER_ADMIN;
      case 'customer':
      default:
        return HELP_SECTIONS_CUSTOMER;
    }
  }, [activeRole]);

  // Filter pencarian
  const query = searchQuery.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!query) return sectionsForActiveRole;
    return sectionsForActiveRole.filter((section) => {
      const matchTitle = section.title.toLowerCase().includes(query);
      const matchPurpose = section.purpose.toLowerCase().includes(query);
      const matchSteps = section.steps.some(
        (s) => s.title.toLowerCase().includes(query) || s.description.toLowerCase().includes(query),
      );
      const matchErrors = section.failureStates.some(
        (e) =>
          e.code.toLowerCase().includes(query) ||
          e.title.toLowerCase().includes(query) ||
          e.message.toLowerCase().includes(query),
      );
      const matchConstraints = section.constraints.some(
        (c) => c.label.toLowerCase().includes(query) || c.limit.toLowerCase().includes(query),
      );
      return matchTitle || matchPurpose || matchSteps || matchErrors || matchConstraints;
    });
  }, [sectionsForActiveRole, query]);

  const filteredErrors = useMemo(() => {
    if (!query) return HELP_ERROR_CATALOG;
    return HELP_ERROR_CATALOG.filter(
      (err) =>
        err.code.toLowerCase().includes(query) ||
        err.meaning.toLowerCase().includes(query) ||
        err.commonCause.toLowerCase().includes(query) ||
        err.resolution.toLowerCase().includes(query),
    );
  }, [query]);

  const filteredGlossary = useMemo(() => {
    if (!query) return HELP_GLOSSARY;
    return HELP_GLOSSARY.filter(
      (item) =>
        item.term.toLowerCase().includes(query) || item.definition.toLowerCase().includes(query),
    );
  }, [query]);

  const filteredFaqs = useMemo(() => {
    if (!query) return HELP_FAQS;
    return HELP_FAQS.filter(
      (faq) =>
        faq.question.toLowerCase().includes(query) || faq.answer.toLowerCase().includes(query),
    );
  }, [query]);

  return (
    <div className="min-h-screen bg-[#FBF9F5] font-sans text-dd-ink antialiased">
      {/* Skip link untuk aksesibilitas WCAG */}
      <a
        href="#help-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-dd-sm focus:bg-dd-forest focus:px-4 focus:py-2 focus:text-white"
      >
        Lewati ke konten utama
      </a>

      {/* Header Utama */}
      <header className="border-b border-dd-line/80 bg-white pt-8 pb-10">
        <div className={publicContainer}>
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-dd-forest/10 px-3 py-1 text-xs font-bold text-dd-forest">
                  <BookOpen className="size-3.5" aria-hidden="true" />
                  Pusat Bantuan &amp; Panduan Terpusat
                </span>
                <span className="rounded-full border border-dd-line bg-dd-surface px-2.5 py-0.5 text-[11px] font-medium text-dd-muted">
                  DailyDose v2
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-dd-ink sm:text-3xl md:text-4xl">
                Panduan Resmi Aplikasi &amp; Penanganan Kendala
              </h1>
              <p className="max-w-2xl text-sm text-dd-muted sm:text-base">
                Acuan alur operasional, angka batas sistem, dan solusi terverifikasi untuk
                Pelanggan, Admin Meja Depan, dan Super Owner.
              </p>
            </div>

            {/* Tombol Pintas Kembali */}
            <div className="flex shrink-0 items-center gap-2.5">
              <Link
                href={isStaff ? '/workspace' : '/'}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-dd-sm border border-dd-line bg-white px-4 py-2 text-xs font-bold text-dd-ink shadow-sm transition hover:border-dd-forest hover:bg-dd-forest/5"
              >
                <span>{isStaff ? 'Kembali ke Workspace' : 'Ke Beranda'}</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* Bilah Pencarian Cepat */}
          <div className="mt-8">
            <div className="relative max-w-2xl">
              <label htmlFor="help-search-input" className="sr-only">
                Cari panduan, kode error, atau istilah
              </label>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-dd-muted" />
              <input
                id="help-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari solusi kendala (misal: cutoff H-24, foto buram, sesi habis, 4-mata)..."
                className="w-full rounded-dd-sm border border-dd-line bg-dd-surface py-3 pl-11 pr-10 text-sm text-dd-ink placeholder:text-dd-muted shadow-sm transition focus:border-dd-forest focus:bg-white focus:outline-none focus:ring-1 focus:ring-dd-forest"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-dd-muted hover:text-dd-ink"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {query && (
              <p className="mt-2 text-xs text-dd-muted">
                Menampilkan hasil pencarian untuk:{' '}
                <strong className="text-dd-ink">"{searchQuery}"</strong> ({filteredSections.length}{' '}
                alur, {filteredErrors.length} kode error, {filteredGlossary.length} glosarium).
              </p>
            )}
          </div>

          {/* Tiga Tab Audiens (Customer, Admin, Super Admin) */}
          <nav
            role="tablist"
            aria-label="Pilih Audiens Panduan"
            className="mt-8 flex flex-wrap gap-2 border-b border-dd-line/60 pb-px"
          >
            <button
              role="tab"
              aria-selected={activeRole === 'customer'}
              aria-controls="tabpanel-help"
              id="tab-customer"
              type="button"
              onClick={() => handleRoleChange('customer')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition-all ${
                activeRole === 'customer'
                  ? 'border-dd-forest text-dd-forest'
                  : 'border-transparent text-dd-muted hover:border-dd-line hover:text-dd-ink'
              }`}
            >
              <UserCheck className="size-4" aria-hidden="true" />
              <span>1. Pelanggan / Member</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-dd-muted">
                {HELP_SECTIONS_CUSTOMER.length} Alur
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeRole === 'admin'}
              aria-controls="tabpanel-help"
              id="tab-admin"
              type="button"
              onClick={() => handleRoleChange('admin')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition-all ${
                activeRole === 'admin'
                  ? 'border-dd-forest text-dd-forest'
                  : 'border-transparent text-dd-muted hover:border-dd-line hover:text-dd-ink'
              }`}
            >
              <ClipboardList className="size-4" aria-hidden="true" />
              <span>2. Admin &amp; Operasional Cabang</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-dd-muted">
                {HELP_SECTIONS_ADMIN.length} Alur
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeRole === 'super-admin'}
              aria-controls="tabpanel-help"
              id="tab-super-admin"
              type="button"
              onClick={() => handleRoleChange('super-admin')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition-all ${
                activeRole === 'super-admin'
                  ? 'border-dd-forest text-dd-forest'
                  : 'border-transparent text-dd-muted hover:border-dd-line hover:text-dd-ink'
              }`}
            >
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span>3. Super Admin &amp; Pemilik</span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-dd-muted">
                {HELP_SECTIONS_SUPER_ADMIN.length} Alur
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Konten Utama */}
      <div id="help-content" className={`${publicContainer} py-10`}>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Sidebar Navigasi Cepat (Sticky di Desktop) */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 space-y-6">
              <div className="rounded-dd-sm border border-dd-line/80 bg-white p-4 shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-wider text-dd-muted">
                  Daftar Alur{' '}
                  {activeRole === 'customer'
                    ? 'Member'
                    : activeRole === 'admin'
                      ? 'Admin Cabang'
                      : 'Super Admin'}
                </h2>
                <nav className="mt-3 flex flex-col space-y-1">
                  {filteredSections.map((sec) => (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      className="block rounded-dd-sm px-3 py-2 text-xs font-medium text-dd-ink transition hover:bg-black/5 hover:text-dd-forest"
                    >
                      <span className="line-clamp-1">{sec.title}</span>
                    </a>
                  ))}
                  <div className="my-2 border-t border-dd-line/60" />
                  <a
                    href="#bagian-umum-glosarium"
                    className="block rounded-dd-sm px-3 py-2 text-xs font-medium text-dd-muted hover:bg-black/5 hover:text-dd-ink"
                  >
                    Glosarium Istilah
                  </a>
                  <a
                    href="#bagian-umum-error"
                    className="block rounded-dd-sm px-3 py-2 text-xs font-medium text-dd-muted hover:bg-black/5 hover:text-dd-ink"
                  >
                    Tabel Kode Error
                  </a>
                  <a
                    href="#bagian-umum-khusus"
                    className="block rounded-dd-sm px-3 py-2 text-xs font-medium text-dd-muted hover:bg-black/5 hover:text-dd-ink"
                  >
                    Solusi Masalah Khas
                  </a>
                  <a
                    href="#bagian-umum-faq"
                    className="block rounded-dd-sm px-3 py-2 text-xs font-medium text-dd-muted hover:bg-black/5 hover:text-dd-ink"
                  >
                    FAQ
                  </a>
                </nav>
              </div>

              {/* Box Info Bantuan Pusat Cepat */}
              <div className="rounded-dd-sm border border-dd-forest/20 bg-dd-forest/5 p-4 text-xs">
                <p className="font-bold text-dd-forest">Kontak Pusat Resmi:</p>
                <p className="mt-1 text-dd-muted">
                  WhatsApp: <strong className="text-dd-ink">+62 895-3297-36127</strong>
                </p>
                <p className="text-dd-muted">
                  Email: <strong className="text-dd-ink">halo@dailydosepilates.id</strong>
                </p>
              </div>
            </div>
          </aside>

          {/* Area Alur Panduan */}
          <main>
            <div
              id="tabpanel-help"
              role="tabpanel"
              aria-labelledby={`tab-${activeRole}`}
              className="space-y-12"
            >
              {filteredSections.length === 0 ? (
                <div className="rounded-dd-sm border border-dd-line bg-white p-8 text-center">
                  <AlertCircle className="mx-auto size-8 text-dd-muted" />
                  <h3 className="mt-2 text-sm font-bold text-dd-ink">Tidak ada alur yang cocok</h3>
                  <p className="mt-1 text-xs text-dd-muted">
                    Coba kata kunci lain atau periksa tab audiens lainnya.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-4 inline-flex items-center rounded-dd-sm bg-dd-forest px-4 py-2 text-xs font-bold text-white hover:bg-dd-forest/90"
                  >
                    Reset Pencarian
                  </button>
                </div>
              ) : (
                filteredSections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-6 rounded-dd-sm border border-dd-line/80 bg-white p-6 shadow-sm sm:p-8"
                  >
                    {/* Judul & Header Alur */}
                    <div className="border-b border-dd-line/60 pb-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-dd-forest/10 px-2.5 py-0.5 text-[11px] font-bold text-dd-forest uppercase">
                          {section.badge}
                        </span>
                        <span className="text-xs text-dd-muted">
                          Hak Akses: <strong className="text-dd-ink">{section.requiredRole}</strong>
                        </span>
                      </div>
                      <h2 className="mt-2 text-xl font-bold tracking-tight text-dd-ink sm:text-2xl">
                        {section.title}
                      </h2>
                      <p className="mt-1 text-xs text-dd-muted sm:text-sm">
                        <strong className="text-dd-ink">Tujuan:</strong> {section.purpose}
                      </p>
                      <p className="mt-1 text-xs text-dd-muted">
                        <strong className="text-dd-ink">Prasyarat:</strong> {section.prerequisites}
                      </p>
                    </div>

                    {/* Grid: Langkah & Screenshot Placeholder */}
                    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      {/* Langkah Demi Langkah */}
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-dd-muted">
                          Langkah Demi Langkah
                        </h3>
                        <ol className="m-0 list-none space-y-3 p-0">
                          {section.steps.map((step) => (
                            <li
                              key={step.number}
                              className="flex items-start gap-3 rounded-dd-sm bg-dd-surface/60 p-3"
                            >
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-dd-forest text-xs font-bold text-white">
                                {step.number}
                              </span>
                              <div className="space-y-1">
                                <h4 className="text-xs font-bold text-dd-ink sm:text-sm">
                                  {step.title}
                                </h4>
                                <p className="text-xs text-dd-muted leading-relaxed">
                                  {step.description}
                                </p>
                                {step.tips && (
                                  <p className="text-[11px] text-dd-forest italic">
                                    💡 Tips: {step.tips}
                                  </p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* Penampil Screenshot Asli Playwright dengan Toggle Desktop / Mobile */}
                      <HelpScreenshotViewer screenshot={section.screenshot} />
                    </div>

                    {/* Hasil Berhasil & Hasil Gagal */}
                    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                      {/* Hasil Berhasil */}
                      <div className="rounded-dd-sm border border-dd-forest/30 bg-emerald-50/60 p-4">
                        <div className="flex items-center gap-2 text-emerald-800">
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-700" />
                          <h3 className="text-xs font-bold uppercase tracking-wider">
                            Hasil Berhasil
                          </h3>
                        </div>
                        <h4 className="mt-2 text-sm font-bold text-emerald-950">
                          {section.successState.title}
                        </h4>
                        <p className="mt-1 text-xs text-emerald-900 leading-relaxed">
                          {section.successState.message}
                        </p>
                        <p className="mt-2 border-t border-emerald-200/80 pt-2 text-[11px] font-medium text-emerald-800">
                          ➡️ Langkah Selanjutnya: {section.successState.nextStep}
                        </p>
                      </div>

                      {/* Hasil Gagal & Error Handling */}
                      <div className="rounded-dd-sm border border-amber-300/60 bg-amber-50/60 p-4">
                        <div className="flex items-center gap-2 text-amber-900">
                          <AlertTriangle className="size-4 shrink-0 text-amber-700" />
                          <h3 className="text-xs font-bold uppercase tracking-wider">
                            Hasil Gagal &amp; Penanganan
                          </h3>
                        </div>
                        <div className="mt-2 space-y-3">
                          {section.failureStates.map((fail) => (
                            <div key={fail.code} className="space-y-1">
                              <span className="font-mono text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                                {fail.code}
                              </span>
                              <h4 className="text-xs font-bold text-amber-950">{fail.title}</h4>
                              <p className="text-[11px] text-amber-900">
                                <em>Pesan: "{fail.message}"</em>
                              </p>
                              <p className="text-[11px] text-amber-800">
                                <strong>Penyebab:</strong> {fail.cause}
                              </p>
                              <ul className="m-0 list-disc pl-4 text-[11px] text-amber-900">
                                {fail.stepsToResolve.map((st, i) => (
                                  <li key={i}>{st}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Pembatasan Sistem */}
                    {section.constraints.length > 0 && (
                      <div className="mt-6 rounded-dd-sm border border-dd-line/80 bg-dd-surface/40 p-4">
                        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-dd-muted">
                          <Clock className="size-3.5 text-dd-forest" />
                          <span>Pembatasan Resmi Sistem</span>
                        </h3>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {section.constraints.map((c, i) => (
                            <div
                              key={i}
                              className="rounded border border-dd-line/60 bg-white p-3 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-dd-ink">{c.label}</span>
                                <span className="font-mono font-semibold text-dd-forest">
                                  {c.limit}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-dd-muted">
                                <strong>Alasan:</strong> {c.reason}
                              </p>
                              <p className="mt-0.5 text-[11px] text-dd-forest">
                                <strong>Solusi / Jalur Alternatif:</strong> {c.alternative}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Kartu Eskalasi di Akhir Tiap Alur */}
                    <div className="mt-6">
                      <EscalationCard
                        contextTitle={section.title}
                        errorCode={section.failureStates[0]?.code}
                      />
                    </div>
                  </section>
                ))
              )}

              {/* ============================================================== */}
              {/* BAGIAN UMUM (GLOSARIUM, ERROR TABLE, SOLUSI KHAS, FAQ)       */}
              {/* ============================================================== */}
              <div className="space-y-12 border-t border-dd-line/80 pt-10">
                {/* 1. Glosarium Istilah */}
                <section
                  id="bagian-umum-glosarium"
                  className="scroll-mt-6 rounded-dd-sm border border-dd-line/80 bg-white p-6 sm:p-8 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-5 text-dd-forest" />
                    <h2 className="text-xl font-bold text-dd-ink">
                      Glosarium Istilah Resmi Daily Dose
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-dd-muted sm:text-sm">
                    Kamus istilah teknis dan operasional yang dipakai di seluruh modul Daily Dose
                    Pilates.
                  </p>

                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredGlossary.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-dd-sm border border-dd-line/70 bg-dd-surface/30 p-3.5"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-dd-ink">{item.term}</h3>
                          <span className="rounded bg-black/5 px-2 py-0.5 text-[10px] font-semibold text-dd-muted">
                            {item.category}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-dd-muted leading-relaxed">
                          {item.definition}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 2. Tabel Kode Error Lengkap */}
                <section
                  id="bagian-umum-error"
                  className="scroll-mt-6 rounded-dd-sm border border-dd-line/80 bg-white p-6 sm:p-8 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-amber-700" />
                    <h2 className="text-xl font-bold text-dd-ink">
                      Tabel Lengkap Kode Error &amp; Respons Sistem
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-dd-muted sm:text-sm">
                    Daftar seluruh kode masalah yang dikeluarkan server Daily Dose beserta penyebab
                    dan cara penyelesaiannya.
                  </p>

                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-dd-line bg-dd-surface/80 text-dd-muted uppercase">
                          <th className="p-3 font-bold">Kode Error</th>
                          <th className="p-3 font-bold">HTTP</th>
                          <th className="p-3 font-bold">Arti Pesan</th>
                          <th className="p-3 font-bold">Penyebab Umum</th>
                          <th className="p-3 font-bold">Solusi Langkah Demi Langkah</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dd-line/60">
                        {filteredErrors.map((err) => (
                          <tr key={err.code} className="hover:bg-black/[0.02]">
                            <td className="p-3 font-mono font-bold text-dd-forest whitespace-nowrap">
                              {err.code}
                            </td>
                            <td className="p-3 font-mono text-dd-muted">{err.httpStatus}</td>
                            <td className="p-3 font-semibold text-dd-ink">{err.meaning}</td>
                            <td className="p-3 text-dd-muted">{err.commonCause}</td>
                            <td className="p-3 text-dd-ink leading-relaxed">{err.resolution}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* 3. Penanganan Masalah Khas */}
                <section
                  id="bagian-umum-khusus"
                  className="scroll-mt-6 rounded-dd-sm border border-dd-line/80 bg-white p-6 sm:p-8 shadow-sm"
                >
                  <h2 className="text-xl font-bold text-dd-ink">Penanganan Masalah Khas</h2>
                  <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
                    {/* Menu Tidak Muncul */}
                    <div className="rounded-dd-sm border border-dd-line p-4 space-y-2">
                      <div className="flex items-center gap-2 text-dd-forest">
                        <Menu className="size-4" />
                        <h3 className="text-xs font-bold uppercase tracking-wider">
                          &quot;Menu Saya Tidak Muncul&quot;
                        </h3>
                      </div>
                      <p className="text-xs text-dd-muted leading-relaxed">
                        Staf Front Desk dibatasi pada 4 menu utama (Hari Ini, Timetable, Booking,
                        Kas). Menu lain memerlukan hak Manager/Finance/Owner serta pemilihan{' '}
                        <strong>Cabang Aktif</strong> di topbar.
                      </p>
                      <p className="text-[11px] text-dd-forest">
                        <strong>Solusi:</strong> Pastikan Anda memilih cabang di dropdown topbar
                        atas.
                      </p>
                    </div>

                    {/* Sesi Habis */}
                    <div className="rounded-dd-sm border border-dd-line p-4 space-y-2">
                      <div className="flex items-center gap-2 text-dd-forest">
                        <KeyRound className="size-4" />
                        <h3 className="text-xs font-bold uppercase tracking-wider">
                          &quot;Sesi Berakhir / Habis&quot;
                        </h3>
                      </div>
                      <p className="text-xs text-dd-muted leading-relaxed">
                        Access token berlaku 15 menit dan diperbarui otomatis via Refresh Token (30
                        hari). Jika token dipakai bersamaan di browser lain, sistem mencabut sesi
                        demi keamanan.
                      </p>
                      <p className="text-[11px] text-dd-forest">
                        <strong>Solusi:</strong> Masuk kembali melalui halaman /sign-in untuk
                        membuat sesi baru.
                      </p>
                    </div>

                    {/* Offline */}
                    <div className="rounded-dd-sm border border-dd-line p-4 space-y-2">
                      <div className="flex items-center gap-2 text-dd-forest">
                        <WifiOff className="size-4" />
                        <h3 className="text-xs font-bold uppercase tracking-wider">
                          &quot;Koneksi Offline &amp; Gangguan&quot;
                        </h3>
                      </div>
                      <p className="text-xs text-dd-muted leading-relaxed">
                        Sistem dilengkapi <em>Kunci Anti-Duplikasi Otomatis</em>. Jika jaringan
                        terputus saat checkout atau booking, kuota Anda tidak akan terpotong ganda
                        saat tombol ditekan ulang.
                      </p>
                      <p className="text-[11px] text-dd-forest">
                        <strong>Solusi:</strong> Periksa koneksi internet, lalu muat ulang halaman.
                      </p>
                    </div>
                  </div>
                </section>

                {/* 4. FAQ */}
                <section
                  id="bagian-umum-faq"
                  className="scroll-mt-6 rounded-dd-sm border border-dd-line/80 bg-white p-6 sm:p-8 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle className="size-5 text-dd-forest" />
                    <h2 className="text-xl font-bold text-dd-ink">Pertanyaan Umum (FAQ)</h2>
                  </div>

                  <div className="mt-6 space-y-4">
                    {filteredFaqs.map((faq, i) => (
                      <details
                        key={i}
                        className="group rounded-dd-sm border border-dd-line bg-dd-surface/30 p-4 transition open:bg-white"
                      >
                        <summary className="flex cursor-pointer items-center justify-between text-xs sm:text-sm font-bold text-dd-ink">
                          <span>{faq.question}</span>
                          <ChevronDown className="size-4 text-dd-muted transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="mt-3 text-xs text-dd-muted leading-relaxed border-t border-dd-line/40 pt-3">
                          {faq.answer}
                        </p>
                      </details>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
