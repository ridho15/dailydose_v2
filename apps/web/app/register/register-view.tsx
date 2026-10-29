'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';
import { Camera, Eye, EyeOff, Lock, ShieldCheck, User, UserCheck } from 'lucide-react';
import { AuthPageShell } from '../components/auth/auth-page-shell';
import { Button } from '../components/actions';
import { FieldError, FormField, TextInput, editorialControlClassName } from '../components/forms';
import { Feedback } from '../ui';
import { verificationClient } from '@/api-clients/identity-verification-client';
import { browserIdentityClient } from '@/api-clients/identity-client';
import { useSessionContext } from '../session-context';
import { useReturnTo } from '../lib/return-to';
import { GoogleIdentityButton } from '../components/auth/google-identity-button';
import { googleClientId } from '../lib/google-client-id';
import {
  type RegisterErrors,
  type RegisterFieldName,
  type RegisterValues,
  registrationRequestErrorMessage,
  validateRegisterField,
  validateRegistration,
} from './register-validation';

const fieldOrder: RegisterFieldName[] = ['displayName', 'phone', 'email', 'password', 'consent'];

function errorId(name: RegisterFieldName) {
  return `register-${name}-error`;
}

function PasswordField({
  id,
  label,
  name,
  placeholder,
  error,
  disabled,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  name: 'password';
  placeholder: string;
  error?: string;
  disabled: boolean;
  onBlur(event: FocusEvent<HTMLInputElement>): void;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      label={label}
      htmlFor={id}
      required
      variant="editorial"
      error={error ? <span id={errorId(name)}>{error}</span> : undefined}
    >
      <div className="relative flex items-center">
        <input
          className={`${editorialControlClassName} min-h-12 pr-12`}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          placeholder={placeholder}
          required
          disabled={disabled}
          aria-label={label}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId(name) : undefined}
          onBlur={onBlur}
          onChange={onChange}
        />
        <button
          type="button"
          className="absolute right-2 flex size-11 items-center justify-center rounded-none text-ed-muted hover:text-ed-ink transition focus-visible:outline-2 focus-visible:outline-ed-forest"
          aria-label={`${visible ? 'Sembunyikan' : 'Tampilkan'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </FormField>
  );
}

function formValues(form: HTMLFormElement): RegisterValues {
  const data = new FormData(form);
  return {
    displayName: String(data.get('displayName') ?? ''),
    phone: String(data.get('phone') ?? ''),
    email: String(data.get('email') ?? ''),
    password: String(data.get('password') ?? ''),
    consent: data.get('consent') === 'true',
  };
}

export function RegisterView() {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  /** Selfie wajib saat mendaftar: staf mencocokkannya dengan wajah member saat check-in. */
  const [selfie, setSelfie] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState('');
  const [selfieError, setSelfieError] = useState('');
  useEffect(() => {
    if (!selfie) {
      setSelfiePreview('');
      return;
    }
    // Tanpa pratinjau pun foto tetap terkirim; jangan sampai formulir gagal karena peramban lama.
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(selfie);
    setSelfiePreview(url);
    return () => URL.revokeObjectURL?.(url);
  }, [selfie]);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const session = useSessionContext();
  const { withReturnTo } = useReturnTo();
  const loading = state === 'loading';
  const googleEnabled = Boolean(googleClientId());

  const handleGoogleComplete = async () => {
    if (session) {
      const searchParams = new URLSearchParams(window.location.search);
      const destination =
        searchParams.get('returnTo') || searchParams.get('returnUrl') || '/account/profile';
      await session.completeSignIn(destination);
    }
  };

  const handleGoogleFailure = () => {
    setState('error');
    setMessage(
      'Proses masuk dengan Google belum dapat diselesaikan. Silakan lengkapi formulir pendaftaran di bawah.',
    );
  };

  const clearRequestError = () => {
    if (state === 'error') setState('idle');
    if (message) setMessage('');
  };

  const validateOne = (name: RegisterFieldName, form = formRef.current) => {
    if (!form) return;
    const error = validateRegisterField(name, formValues(form));
    setErrors((current) => {
      const next = { ...current };
      if (error) next[name] = error;
      else delete next[name];
      return next;
    });
  };

  const handleTextBlur = (name: RegisterFieldName) => () => validateOne(name);
  const handleTextChange = (name: RegisterFieldName) => () => {
    clearRequestError();
    if (errors[name]) validateOne(name);
  };

  return (
    <AuthPageShell
      eyebrow="Registrasi customer"
      title="Buat akun Daily Dose"
      description="Tiga isian dan satu foto selfie. Tidak perlu KTP."
      compactMobileVisual
      visualSrc="/images/public/landing/register-illustration.webp"
      loginLabel="Masuk"
      loginHref={withReturnTo('/sign-in')}
    >
      {/* Kotak Callout Khusus Member Lama Studio (Spesifikasi 5.9 / Tiket T-09) */}
      <div className="mb-6 rounded-none border border-ed-line bg-ed-tint/60 p-4 text-xs leading-relaxed text-ed-ink">
        <div className="flex items-start gap-3">
          <UserCheck className="size-5 shrink-0 text-ed-forest mt-0.5" />
          <div className="space-y-1">
            <strong className="block font-semibold text-ed-ink">
              Sudah pernah latihan di studio?
            </strong>
            <p className="text-ed-muted">
              Akun kamu mungkin sudah dibuatkan staf. Masuk pakai nomor WhatsApp yang kamu berikan
              ke studio.
            </p>
            <Link
              href={withReturnTo('/sign-in')}
              className="inline-flex items-center gap-1 font-bold text-ed-forest hover:text-ed-green hover:underline pt-0.5"
            >
              <span>Masuk dengan nomor WhatsApp</span>
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      </div>

      {googleEnabled && (
        <div className="mb-6 space-y-4">
          <div className="rounded-none border border-ed-line bg-ed-tint/30 p-4 shadow-none">
            <p className="mb-3 text-center text-xs font-semibold text-ed-muted">
              Daftar cepat dengan akun Google Anda:
            </p>
            <GoogleIdentityButton
              client={browserIdentityClient}
              text="signup_with"
              onComplete={handleGoogleComplete}
              onFailure={handleGoogleFailure}
            />
          </div>
          <div className="flex items-center gap-4 text-[13px] font-bold text-ed-muted before:h-px before:flex-1 before:bg-ed-line after:h-px after:flex-1 after:bg-ed-line">
            atau isi data akun secara manual
          </div>
        </div>
      )}

      <form
        ref={formRef}
        aria-label="Registrasi customer"
        method="post"
        noValidate
        className="space-y-6"
        onSubmit={async (event) => {
          event.preventDefault();
          clearRequestError();
          const values = formValues(event.currentTarget);
          const nextErrors = validateRegistration(values);
          setErrors(nextErrors);
          const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
          if (firstInvalid) {
            const field = event.currentTarget.elements.namedItem(firstInvalid);
            if (field instanceof HTMLElement) field.focus();
            return;
          }
          if (!selfie) {
            setSelfieError(
              'Ambil foto selfie dulu. Foto ini yang dicocokkan staf saat Anda datang.',
            );
            document.getElementById('register-selfie')?.focus();
            return;
          }

          setState('loading');
          try {
            await verificationClient.register({
              displayName: values.displayName.trim(),
              phone: values.phone.trim(),
              email: values.email.trim(),
              password: values.password,
              consent: values.consent,
              selfie,
            });
            const searchParams = new URLSearchParams(window.location.search);
            const returnTo =
              searchParams.get('returnTo') || searchParams.get('returnUrl') || '/classes#schedule';
            const completed = await session?.completeSignIn(returnTo);
            if (!completed) throw new Error('session');
          } catch (error) {
            const status = (error as { response?: { status?: number } }).response?.status;
            setMessage(registrationRequestErrorMessage(status));
            setState('error');
          }
        }}
      >
        {/* Info Pendaftaran Cepat */}
        <div className="flex items-center justify-between gap-2 rounded-none border border-ed-line bg-ed-tint/50 p-2.5 sm:p-3 text-xs">
          <div className="flex items-center gap-2 text-ed-forest font-semibold min-w-0">
            <User className="size-4 shrink-0 text-ed-green" />
            <span className="truncate">Pendaftaran Akun Baru</span>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-none border border-ed-line bg-white px-2.5 py-0.5 font-bold text-ed-forest text-[13px]">
            Cepat &amp; Praktis
          </span>
        </div>

        {/* Section 1: Data Diri & Kontak */}
        <div className="space-y-4 rounded-none border border-ed-line bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2 border-b border-ed-line pb-2 text-[13px] font-bold text-ed-forest">
            <User className="size-3.5 text-ed-green" /> 1. Data Diri &amp; Kontak
          </div>
          <TextInput
            id="register-display-name"
            label="Nama lengkap"
            name="displayName"
            variant="editorial"
            autoComplete="name"
            maxLength={160}
            placeholder="Contoh: Nadia Putri"
            required
            disabled={loading}
            error={
              errors.displayName ? (
                <span id={errorId('displayName')}>{errors.displayName}</span>
              ) : undefined
            }
            aria-describedby={errors.displayName ? errorId('displayName') : undefined}
            onBlur={handleTextBlur('displayName')}
            onChange={handleTextChange('displayName')}
          />
          <TextInput
            id="register-phone"
            label="Nomor WhatsApp"
            name="phone"
            variant="editorial"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0812 3456 7890"
            required
            disabled={loading}
            error={errors.phone ? <span id={errorId('phone')}>{errors.phone}</span> : undefined}
            aria-describedby={errors.phone ? errorId('phone') : undefined}
            onBlur={handleTextBlur('phone')}
            onChange={handleTextChange('phone')}
          />
          <TextInput
            id="register-email"
            label="Email"
            name="email"
            variant="editorial"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="nama@email.com"
            required
            disabled={loading}
            error={errors.email ? <span id={errorId('email')}>{errors.email}</span> : undefined}
            aria-describedby={errors.email ? errorId('email') : undefined}
            onBlur={handleTextBlur('email')}
            onChange={handleTextChange('email')}
          />
        </div>

        {/* Section 2: Keamanan Akun */}
        <div className="space-y-4 rounded-none border border-ed-line bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2 border-b border-ed-line pb-2 text-[13px] font-bold text-ed-forest">
            <Lock className="size-3.5 text-ed-green" /> 2. Keamanan Akun
          </div>
          <PasswordField
            id="register-password"
            label="Password"
            name="password"
            placeholder="Minimal 8 karakter"
            error={errors.password}
            disabled={loading}
            onBlur={handleTextBlur('password')}
            onChange={handleTextChange('password')}
          />
        </div>

        {/* Section 3: Foto selfie, wajib sejak pendaftaran */}
        <div className="space-y-3 rounded-none border border-ed-line bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2 border-b border-ed-line pb-2 text-[13px] font-bold text-ed-forest">
            <Camera className="size-3.5 text-ed-green" /> 3. Foto selfie
          </div>
          <p className="text-sm leading-relaxed text-ed-ink">
            Dipakai staf studio untuk mengenali Anda saat datang, supaya paket Anda tidak bisa
            dipakai orang lain. Tidak ditampilkan ke member lain.
          </p>
          <div className="flex items-center gap-4">
            {selfiePreview ? (
              <img
                src={selfiePreview}
                alt="Pratinjau foto selfie Anda"
                className="size-24 shrink-0 border border-ed-line object-cover"
              />
            ) : (
              <span className="flex size-24 shrink-0 items-center justify-center border border-ed-line bg-ed-tint/50 p-2 text-center text-xs text-ed-muted">
                Belum ada foto
              </span>
            )}
            <label
              htmlFor="register-selfie"
              className="inline-flex min-h-[48px] cursor-pointer items-center justify-center bg-ed-forest px-5 text-sm font-bold text-white transition hover:bg-ed-green focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[#09371f]"
            >
              {selfie ? 'Ambil ulang' : 'Ambil foto sekarang'}
              <input
                id="register-selfie"
                name="selfie"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                className="sr-only"
                disabled={loading}
                aria-invalid={Boolean(selfieError) || undefined}
                aria-describedby={selfieError ? 'register-selfie-error' : 'register-selfie-hint'}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelfie(file);
                  if (file) setSelfieError('');
                }}
              />
            </label>
          </div>
          {selfieError ? (
            <p
              id="register-selfie-error"
              role="alert"
              className="text-xs font-medium text-ed-danger"
            >
              {selfieError}
            </p>
          ) : (
            <p id="register-selfie-hint" className="text-xs text-ed-muted">
              Cukup wajah terlihat jelas dan tidak gelap. Bisa diganti kapan saja lewat menu Akun.
            </p>
          )}
        </div>

        {/* Section 4: Privacy Notice & Consent */}
        <div
          id="register-privacy-notice"
          className="flex items-start gap-3 rounded-none border border-ed-line bg-ed-tint/60 p-3.5 text-xs leading-relaxed text-ed-muted shadow-none"
          role="note"
        >
          <ShieldCheck className="size-5 shrink-0 text-ed-green mt-0.5" />
          <span>
            Data pendaftaran Anda disimpan secara privat dan aman, dan hanya digunakan untuk layanan
            keanggotaan studio Daily Dose. Foto selfie hanya dilihat staf studio, tidak ditampilkan
            ke member lain.
          </span>
        </div>

        <div className="space-y-1.5 pt-1">
          <label
            className="flex min-h-[44px] items-start gap-3 text-xs leading-5 text-ed-ink cursor-pointer select-none"
            htmlFor="register-consent"
          >
            <input
              className="mt-0.5 size-4 shrink-0 rounded-none border-ed-border-ui text-ed-forest focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f] accent-ed-forest"
              id="register-consent"
              name="consent"
              type="checkbox"
              value="true"
              disabled={loading}
              aria-invalid={Boolean(errors.consent) || undefined}
              aria-describedby={[
                'register-privacy-notice',
                errors.consent ? errorId('consent') : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onBlur={() => validateOne('consent')}
              onChange={() => {
                clearRequestError();
                if (errors.consent) validateOne('consent');
              }}
            />
            <span className="font-medium">
              Saya menyetujui Syarat &amp; Ketentuan Layanan serta Kebijakan Privasi Daily Dose.
            </span>
          </label>
          {errors.consent && <FieldError id={errorId('consent')}>{errors.consent}</FieldError>}
        </div>

        {/* Submit Action */}
        <Button type="submit" size="lg" fullWidth loading={loading} loadingLabel="Membuat akun…">
          Daftar dan masuk
        </Button>
        {state === 'error' && (
          <div className="space-y-2">
            <Feedback kind="error">{message}</Feedback>
            {(message.includes('terdaftar') || message.includes('digunakan')) && (
              <div className="rounded-none bg-ed-tint/50 p-3 text-center text-xs text-ed-ink border border-ed-line">
                <span>Sudah memiliki akun? </span>
                <Link
                  href={withReturnTo('/sign-in')}
                  className="font-bold text-ed-forest hover:underline"
                >
                  Masuk ke Akun Sekarang &rarr;
                </Link>
              </div>
            )}
          </div>
        )}
      </form>
    </AuthPageShell>
  );
}
