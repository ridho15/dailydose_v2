'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import {
  browserIdentityClient,
  failureCode,
  failureReference,
  type IdentityClient,
  type UiFailure,
} from '@/api-clients/identity-client';
import { Feedback } from '../ui';
import { useSessionContext } from '../session-context';
import { useHydrated } from '../lib/use-hydrated';
import { useReturnTo } from '../lib/return-to';
import { BrandMark } from '../components/public/brand-mark';
import { GoogleIdentityButton } from '../components/auth/google-identity-button';
import { googleClientId } from '../lib/google-client-id';

const messages: Record<UiFailure, string> = {
  AUTHENTICATION_REQUIRED: 'Email, username/nomor WhatsApp, atau password tidak valid.',
  CONFIGURATION_REQUIRED: 'Layanan masuk sementara tidak tersedia. Silakan coba kembali nanti.',
  INTERNAL_ERROR: 'Layanan masuk sedang mengalami gangguan.',
  RATE_LIMITED: 'Terlalu banyak percobaan. Coba kembali nanti.',
  SERVICE_UNAVAILABLE: 'Proses masuk sementara tidak tersedia. Silakan coba kembali nanti.',
  FORBIDDEN: 'Akses tidak diizinkan.',
  IDENTITY_CONFLICT: 'Identitas memerlukan tinjauan dukungan.',
  STALE_VERSION: 'Data telah berubah. Muat ulang lalu coba kembali.',
  SESSION_REVOKED: 'Sesi telah berakhir. Silakan masuk kembali.',
  NOT_IMPLEMENTED: 'Fitur ini belum tersedia.',
};

type AuthState = 'idle' | 'loading' | 'success' | 'invalid' | UiFailure;

export function SignInView({ client = browserIdentityClient }: { client?: IdentityClient }) {
  const [state, setState] = useState<AuthState>('idle');
  const [reference, setReference] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // Sebelum hidrasi, submit native akan menaruh email dan password di URL; tahan sampai handler aktif.
  const hydrated = useHydrated();
  const sessionContext = useSessionContext();
  const { withReturnTo } = useReturnTo();
  const googleEnabled = Boolean(googleClientId());

  const complete = useCallback(async () => {
    if (sessionContext) {
      const searchParams = new URLSearchParams(window.location.search);
      const destination =
        searchParams.get('returnTo') || searchParams.get('returnUrl') || '/workspace';
      const completed = await sessionContext.completeSignIn(destination);
      if (!completed) throw { response: { status: 401 } };
    }
    setState('success');
  }, [sessionContext]);

  const fail = useCallback((error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const code = failureCode(error);
    setReference(failureReference(error));
    setState(status === 401 || code === 'AUTHENTICATION_REQUIRED' ? 'invalid' : code);
  }, []);

  return (
    <main
      className="ed-scope grid min-h-svh grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(460px,0.9fr)] bg-ed-cream text-ed-ink"
      id="main-content"
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-ed-forest focus:text-white focus:text-[13px] focus:font-bold focus: focus: focus:shadow-lg focus:outline-none focus:rounded-none"
        href="#auth-form"
      >
        Langsung ke formulir masuk
      </a>

      {/* Left Visual Panel */}
      <section
        className="auth-visual-panel relative isolate hidden lg:flex flex-col justify-between overflow-hidden p-12 min-h-svh sticky top-0 self-start border-r border-ed-line"
        aria-label="Daily Dose Pilates"
      >
        <div className="absolute inset-0 -z-20 overflow-hidden">
          <Image
            className="object-cover object-[58%_center]"
            src="/images/public/landing/hero-pilates.png"
            fill
            priority
            sizes="55vw"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ed-deep/95 via-ed-forest/80 to-ed-forest/50" />
        </div>

        {/* Top Brand Tag */}
        <div className="flex items-center gap-2 text-white/90">
          <span className="text-[13px] font-bold text-ed-mint">Daily Dose Portal</span>
        </div>

        {/* Bottom Editorial Copy */}
        <div className="space-y-5 text-white max-w-lg">
          <div className="space-y-3">
            <p className="ed-eyebrow text-ed-mint tracking-[0.18em]">Move better, live better</p>
            <h1 className="ed-display text-4xl xl:text-5xl font-normal leading-[1.02] tracking-[-0.04em] text-ed-cream">
              Welcome back to <span className="ed-serif italic text-ed-mint">your Daily Dose.</span>
            </h1>
            <blockquote className="border-l border-ed-mint/60 pl-4 ed-serif text-lg italic text-ed-cream/90">
              “Stronger body. Calmer mind.”
            </blockquote>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-ed-cream/75 pt-3 border-t border-white/10">
            <span>Akses Multi-Cabang Resmi</span>
            <span>•</span>
            <span>Studio Terverifikasi</span>
          </div>
        </div>
      </section>

      {/* Right Form Panel */}
      <section
        className="flex flex-col items-center justify-center w-full min-w-0 p-3 sm:p-8 lg:p-16"
        aria-labelledby="sign-in-title"
      >
        <div
          className="w-full max-w-[480px] min-w-0 rounded-none border border-ed-line bg-white p-4 sm:p-8 lg:p-10 shadow-none"
          id="auth-form"
        >
          {/* Header Top */}
          <div className="mb-6 sm:mb-8 flex items-center justify-between gap-2 sm:gap-3 border-b border-ed-line pb-4 sm:pb-5">
            <BrandMark className="w-28 sm:w-40 shrink-0" priority />
            <Link
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 sm:gap-2 rounded-none px-2.5 sm:px-3 text-[13px] font-bold text-ed-forest hover:bg-ed-tint transition-colors no-underline"
              href="/"
            >
              <ArrowLeft className="size-3.5 shrink-0" />
              <span>Ke beranda</span>
            </Link>
          </div>

          <div className="space-y-2">
            <p className="ed-eyebrow text-ed-green">Akses Member Resmi</p>
            <h2
              className="ed-display text-2xl sm:text-3xl font-normal tracking-[-0.04em] text-ed-ink"
              id="sign-in-title"
            >
              Masuk ke Daily Dose
            </h2>
            <p className="text-sm leading-relaxed text-ed-muted">
              {googleEnabled
                ? 'Masuk dengan email, username, atau nomor WhatsApp yang terdaftar, atau lanjutkan dengan akun Google Anda.'
                : 'Masuk dengan email, username, atau nomor WhatsApp yang terdaftar beserta password Anda.'}
            </p>
          </div>

          <form
            method="post"
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setReference(null);
              setState('loading');
              void client
                .signInWithPassword(String(form.get('email')), String(form.get('password')))
                .then(complete)
                .catch(fail);
            }}
          >
            <label className="block space-y-1.5 text-[13px] font-bold text-ed-ink">
              <span>Email, Username, atau WhatsApp</span>
              <div className="relative flex items-center">
                <input
                  aria-label="Email, Username, atau WhatsApp"
                  className="w-full min-h-12 rounded-none border border-ed-border-ui bg-white px-4 py-2.5 text-sm text-ed-ink transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
                  name="email"
                  type="text"
                  autoComplete="username"
                  placeholder="username, nama@email.com, atau 0812..."
                  required
                />
              </div>
            </label>

            <label className="block space-y-1.5 text-[13px] font-bold text-ed-ink">
              <span>Password</span>
              <div className="relative flex items-center">
                <input
                  className="w-full min-h-12 rounded-none border border-ed-border-ui bg-white px-4 pr-24 py-2.5 text-sm text-ed-ink transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={128}
                  placeholder="Masukkan password"
                  required
                />
                <button
                  aria-pressed={showPassword}
                  className="absolute right-2 inline-flex min-h-[44px] items-center px-3 py-1.5 text-[13px] font-bold text-ed-forest hover:text-ed-deep transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? 'Sembunyikan' : 'Lihat'}
                </button>
              </div>
            </label>

            <div className="flex items-center justify-between gap-4 pt-1 text-xs">
              <Link className="font-bold text-ed-forest hover:underline" href="/forgot-password">
                Lupa password?
              </Link>
              <span className="text-ed-muted">Akses sesuai hak akun</span>
            </div>

            <button
              className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-none bg-dd-forest px-5 text-sm font-bold text-white transition-colors hover:bg-ed-deep disabled:bg-ed-line disabled:text-ed-muted active:bg-ed-deep shadow-none"
              disabled={state === 'loading' || !hydrated}
              type="submit"
            >
              {state === 'loading' ? 'Memeriksa akses…' : 'Masuk ke Akun'}
            </button>
          </form>

          {state === 'invalid' && (
            <div className="mt-4">
              <Feedback kind="error">
                Email, username/nomor WhatsApp, atau password tidak valid.
              </Feedback>
            </div>
          )}
          {state in messages && (
            <div className="mt-4">
              <Feedback kind="error">
                {messages[state as UiFailure]}
                {reference && (state === 'INTERNAL_ERROR' || state === 'SERVICE_UNAVAILABLE')
                  ? ` Kode bantuan: ${reference}.`
                  : ''}
              </Feedback>
            </div>
          )}

          <div className="mt-6 border-t border-ed-line pt-4 text-center space-y-2">
            <p className="text-xs text-ed-muted">
              Belum punya akun?{' '}
              <Link
                className="font-bold text-ed-forest hover:underline"
                href={withReturnTo('/register')}
              >
                Daftar akun baru
              </Link>
            </p>
            <p className="text-xs text-ed-muted">
              Lupa akun atau butuh bantuan?{' '}
              <a
                href="https://wa.me/62895329736127"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-ed-forest hover:underline"
              >
                Chat WhatsApp Admin Studio
              </a>
            </p>
          </div>
          {state === 'success' && (
            <div className="mt-4">
              <Feedback kind="status">Identitas terverifikasi.</Feedback>
            </div>
          )}

          {googleEnabled && (
            <>
              <div className="my-6 flex items-center gap-4 text-[13px] font-bold text-ed-muted before:h-px before:flex-1 before:bg-ed-line after:h-px after:flex-1 after:bg-ed-line">
                atau
              </div>
              <GoogleIdentityButton client={client} onComplete={complete} onFailure={fail} />
            </>
          )}

          <div className="mt-6 border-t border-ed-line pt-4 text-xs leading-relaxed text-ed-muted">
            <strong className="block font-semibold text-ed-ink">
              Akses terlindungi &amp; Terenkripsi
            </strong>
            Seluruh data dan tindakan dibatasi berdasarkan hak akses peran serta cabang resmi
            terdaftar.
          </div>
        </div>
      </section>
    </main>
  );
}
