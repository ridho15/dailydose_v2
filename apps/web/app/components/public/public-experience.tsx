'use client';

import { MessageCircle, MapPin, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  accountClient,
  type MyProfile,
  type PreferredStudio,
  type PublicSiteConfig,
} from '@/api-clients/account-client';
import { useSessionContext } from '../../session-context';
import { isCustomerOnlySession } from '@/lib/session-audience';
import { Button } from '../actions';
import { Modal, useAppFeedback } from '../app-feedback';
import { RadioCard } from '../forms';
import { formatTimezone } from '@/lib/system-dictionary';

const visiblePaths = new Set(['/', '/classes', '/packages', '/locations', '/contact', '/terms', '/privacy', '/guide', '/help']);
const hiddenPathPrefixes = [
  '/sign-in',
  '/register',
  '/activate-account',
  '/forgot-password',
  '/reset-password',
  '/check-in-pass',
  '/workspace',
  '/check-ins',
  '/checkout',
  '/bookings/new',
  '/bookings/',
  '/orders/',
  '/ledger',
  '/health',
];

const namaPendek = (studio: PreferredStudio) => studio.name.replace(/^Daily Dose\s+/i, '');

export function whatsappHref(phone: string, studio: PreferredStudio, pathname: string) {
  const number = phone.replace(/\D/g, '');
  // Beranda publik berbahasa Inggris, jadi pesan pembukanya juga.
  if (pathname === '/') {
    const message = `Hi Daily Dose ${namaPendek(studio)}, I would like to ask about your studio.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }
  const context =
    pathname === '/packages'
      ? 'paket'
      : pathname === '/classes'
        ? 'jadwal kelas'
        : 'informasi studio';
  const message = `Halo Daily Dose ${namaPendek(studio)}, saya ingin bertanya tentang ${context}.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** Teks pemilih cabang WhatsApp: bahasa Inggris di beranda, bahasa Indonesia di halaman lain. */
const teksWa = (english: boolean) =>
  english
    ? {
        tombol: 'Chat with Daily Dose on WhatsApp',
        judul: 'Chat with a studio',
        keterangan: 'Pick the studio you want to reach. WhatsApp opens with a message ready.',
        studioSaya: 'Your studio',
        tutup: 'Close',
      }
    : {
        tombol: 'Hubungi Daily Dose melalui WhatsApp',
        judul: 'Hubungi studio',
        keterangan: 'Pilih studio yang ingin dihubungi. WhatsApp terbuka dengan pesan siap kirim.',
        studioSaya: 'Studio Anda',
        tutup: 'Tutup',
      };

/** Satu cabang yang bisa dihubungi lewat WhatsApp, dengan tautan pesan yang sudah siap. */
export interface CabangWhatsapp {
  id: string;
  nama: string;
  area: string | null;
  href: string;
  studioSaya: boolean;
}

export interface StudioPreferenceController {
  preferredStudio: PreferredStudio | null;
  /** Cabang untuk tombol WhatsApp di dalam halaman (mis. halaman Kontak); kosong selama dimuat. */
  whatsappStudios?: CabangWhatsapp[];
  openStudioPreference(): void;
  closeStudioPreference(): void;
}

const StudioPreferenceContext = createContext<StudioPreferenceController | null>(null);

export function useStudioPreference() {
  return useContext(StudioPreferenceContext);
}

export function PublicExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const context = useSessionContext();
  const feedback = useAppFeedback();
  const session = context?.session;
  const customerOnly = isCustomerOnlySession(session);
  const [config, setConfig] = useState<PublicSiteConfig | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const tombolWaRef = useRef<HTMLButtonElement>(null);
  const panelWaRef = useRef<HTMLDivElement>(null);
  const [selectedStudioId, setSelectedStudioId] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [nextConfig, nextProfile] = await Promise.all([
        accountClient.siteConfig(),
        customerOnly ? accountClient.profile() : Promise.resolve(null),
      ]);
      setConfig(nextConfig);
      setProfile(nextProfile);
      setSelectedStudioId(nextProfile?.preferredBranch?.id ?? session?.preferredBranch?.id ?? '');
      setState('idle');
    } catch {
      setState('error');
    }
  }, [customerOnly, session?.preferredBranch?.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const preferred = profile?.preferredBranch ?? session?.preferredBranch ?? null;
  const mandatory = customerOnly && state === 'idle' && !preferred;
  const showFab =
    !hiddenPathPrefixes.some((prefix) => pathname.startsWith(prefix)) &&
    (visiblePaths.has(pathname) || customerOnly);
  const supportAvailable = useMemo(
    () =>
      Boolean(
        config?.fallbackWhatsappE164 ||
        config?.branches?.some((branch) => branch.supportWhatsappE164),
      ),
    [config],
  );

  // Cabang yang bisa dihubungi, studio pilihan member paling atas.
  const cabangWa = useMemo(() => {
    const daftar = (config?.branches ?? []).filter(
      (studio) => studio.supportWhatsappE164 || config?.fallbackWhatsappE164,
    );
    return preferred
      ? [...daftar].sort((a, b) => Number(b.id === preferred.id) - Number(a.id === preferred.id))
      : daftar;
  }, [config, preferred]);
  const teks = teksWa(pathname === '/');
  const whatsappStudios = useMemo<CabangWhatsapp[]>(
    () =>
      cabangWa.map((studio) => {
        const lokasi = studio.publicProfile?.area || studio.publicProfile?.city;
        return {
          id: studio.id,
          nama: namaPendek(studio),
          // Area yang sama dengan nama cabang tidak diulang.
          area: lokasi && lokasi !== namaPendek(studio) ? lokasi : null,
          href: whatsappHref(
            studio.supportWhatsappE164 || config?.fallbackWhatsappE164 || '',
            studio,
            pathname,
          ),
          studioSaya: preferred?.id === studio.id,
        };
      }),
    [cabangWa, config, pathname, preferred],
  );

  const tutupWa = useCallback((kembalikanFokus = true) => {
    setWaOpen(false);
    if (kembalikanFokus) tombolWaRef.current?.focus();
  }, []);

  // Escape dan klik di luar menutup pilihan cabang tanpa berpindah halaman.
  useEffect(() => {
    if (!waOpen) return;
    panelWaRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const tekan = (event: KeyboardEvent) => {
      if (event.key === 'Escape') tutupWa();
    };
    const klik = (event: PointerEvent) => {
      const sasaran = event.target as Node;
      if (!panelWaRef.current?.contains(sasaran) && !tombolWaRef.current?.contains(sasaran)) {
        tutupWa(false);
      }
    };
    document.addEventListener('keydown', tekan);
    document.addEventListener('pointerdown', klik);
    return () => {
      document.removeEventListener('keydown', tekan);
      document.removeEventListener('pointerdown', klik);
    };
  }, [waOpen, tutupWa]);

  const openWhatsapp = (studio: PreferredStudio) => {
    const phone = studio.supportWhatsappE164 || config?.fallbackWhatsappE164;
    if (phone) window.open(whatsappHref(phone, studio, pathname), '_blank', 'noopener,noreferrer');
  };

  const choose = async (studio: PreferredStudio) => {
    if (!customerOnly || !profile) {
      openWhatsapp(studio);
      setChooserOpen(false);
      return;
    }
    setState('saving');
    try {
      const updated = await accountClient.updateProfile({
        displayName: profile.displayName,
        preferredBranchId: studio.id,
        expectedVersion: profile.version,
      });
      setProfile(updated);
      setChooserOpen(false);
      setState('idle');
      feedback.showToast({
        tone: 'success',
        title: 'Studio utama diperbarui',
        message: `${studio.name} menjadi default untuk jadwal dan paket berikutnya.`,
      });
      await context?.refresh();
    } catch {
      setState('error');
      feedback.showAlert({
        tone: 'danger',
        title: 'Studio belum dapat disimpan',
        message: 'Muat ulang pilihan studio lalu coba kembali.',
      });
    }
  };

  const dialogOpen = mandatory || chooserOpen;
  // Tombol ada di footer dialog (di luar area gulir) supaya "Simpan studio" selalu terlihat di layar HP.
  const showStudioActions = state !== 'loading' && !(state === 'error' && !config);
  return (
    <StudioPreferenceContext.Provider
      value={{
        preferredStudio: preferred,
        whatsappStudios,
        openStudioPreference: () => {
          setSelectedStudioId(preferred?.id ?? '');
          setChooserOpen(true);
        },
        closeStudioPreference: () => {
          if (!mandatory) setChooserOpen(false);
        },
      }}
    >
      {children}
      {showFab && supportAvailable && !dialogOpen && (
        <>
          {waOpen && (
            <div
              ref={panelWaRef}
              id="wa-cabang"
              role="region"
              aria-labelledby="wa-cabang-judul"
              className={`fixed right-3 z-40 w-[min(340px,calc(100vw-24px))] rounded-dd-lg border border-ed-line bg-white p-4 text-ed-ink shadow-dd-float sm:right-6 ${
                pathname === '/checkout'
                  ? 'bottom-[calc(10rem+env(safe-area-inset-bottom))] sm:bottom-24'
                  : 'bottom-[calc(9.25rem+env(safe-area-inset-bottom))] sm:bottom-24'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="wa-cabang-judul" className="m-0 text-lg font-semibold text-ed-ink">
                    {teks.judul}
                  </h2>
                  <p className="m-0 mt-1 text-sm leading-5 text-ed-muted">{teks.keterangan}</p>
                </div>
                <button
                  type="button"
                  onClick={() => tutupWa()}
                  aria-label={teks.tutup}
                  className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ed-muted hover:bg-ed-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ed-forest"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <ul className="m-0 mt-3 grid list-none gap-1.5 p-0">
                {cabangWa.map((studio) => {
                  const nomor = studio.supportWhatsappE164 || config?.fallbackWhatsappE164 || '';
                  const lokasi = studio.publicProfile?.area || studio.publicProfile?.city;
                  // Area yang sama dengan nama cabang tidak diulang.
                  const area = lokasi && lokasi !== namaPendek(studio) ? lokasi : null;
                  return (
                    <li key={studio.id}>
                      <a
                        href={whatsappHref(nomor, studio, pathname)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => tutupWa(false)}
                        className="flex min-h-12 items-center gap-3 rounded-dd-md border border-ed-line px-3 py-2 no-underline transition-colors hover:border-[#1f8f5f] hover:bg-ed-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ed-forest"
                      >
                        <MessageCircle className="size-5 shrink-0 text-[#1f8f5f]" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-ed-ink">{namaPendek(studio)}</span>
                          {area && <span className="block text-sm text-ed-muted">{area}</span>}
                        </span>
                        {preferred?.id === studio.id && (
                          <span className="shrink-0 text-xs font-semibold text-ed-forest">
                            {teks.studioSaya}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <button
            ref={tombolWaRef}
            type="button"
            aria-label={teks.tombol}
            aria-expanded={waOpen}
            aria-controls="wa-cabang"
            onClick={() => (waOpen ? tutupWa() : setWaOpen(true))}
            className={`public-whatsapp-fab fixed right-3 z-40 grid size-14 min-h-14 w-14 place-items-center rounded-full border border-white/30 bg-[#1f8f5f] p-0 text-white  transition hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ed-green/25 motion-reduce:transform-none sm:right-6 ${
              pathname === '/checkout'
              ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6'
              : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-6'
            }`}
          >
            {waOpen ? (
              <X className="size-6" aria-hidden="true" />
            ) : (
              <MessageCircle className="size-6" aria-hidden="true" />
            )}
          </button>
        </>
      )}
      <Modal
        open={dialogOpen}
        title="Pilih studio utama Anda"
        description="Studio ini menjadi default untuk jadwal, paket baru, checkout baru, dan bantuan WhatsApp. Pesanan serta booking yang sudah ada tidak berubah."
        onClose={() => {
          if (!mandatory) setChooserOpen(false);
        }}
        closeOnEscape={!mandatory}
        closeOnBackdrop={!mandatory}
        showCloseButton={!mandatory}
        footer={showStudioActions ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!mandatory && (
          <Button
            type="button"
            variant="secondary"
            disabled={state === 'saving'}
            onClick={() => setChooserOpen(false)}
          >
            Batal
          </Button>
        )}
        <Button
          type="button"
          loading={state === 'saving'}
          loadingLabel="Menyimpan studio…"
          disabled={!selectedStudioId}
          onClick={() => {
            const studio = config?.branches.find((item) => item.id === selectedStudioId);
            if (studio) void choose(studio);
          }}
        >
          <MapPin className="size-4" aria-hidden="true" />
          {customerOnly ? 'Simpan studio' : 'Lanjutkan ke WhatsApp'}
        </Button>
      </div>
        ) : undefined}
      >
        {state === 'loading' ? (
          <p className="mt-5 animate-pulse rounded-none bg-ed-tint p-5 text-center">
            Memuat studio…
          </p>
        ) : state === 'error' && !config ? (
          <div className="mt-5 rounded-none bg-dd-danger-soft p-4 text-dd-danger">
            <p>Studio belum dapat dimuat.</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <fieldset className="grid gap-3">
              <legend className="sr-only">Studio utama</legend>
              {config?.branches.map((studio) => (
                <RadioCard
                  key={studio.id}
                  name="preferredStudio"
                  value={studio.id}
                  checked={selectedStudioId === studio.id}
                  disabled={state === 'saving'}
                  onChange={() => setSelectedStudioId(studio.id)}
                  label={studio.name}
                  description={formatTimezone(studio.timezone)}
                  className="min-h-16 items-center"
                />
              ))}
            </fieldset>
          </div>
        )}
        {state === 'error' && config && (
          <p
            role="alert"
            className="mt-4 rounded-none bg-dd-danger-soft p-3 text-sm text-dd-danger"
          >
            Pilihan belum tersimpan. Muat ulang lalu coba kembali.
          </p>
        )}
      </Modal>
    </StudioPreferenceContext.Provider>
  );
}
