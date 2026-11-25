export type RegisterFieldName = 'displayName' | 'phone' | 'email' | 'password' | 'consent';

export type RegisterValues = {
  displayName: string;
  phone: string;
  email: string;
  password: string;
  consent: boolean;
};

export type RegisterErrors = Partial<Record<RegisterFieldName, string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const indonesianMobilePattern = /^\+628[1-9]\d{7,11}$/u;

export function normalizeRegistrationPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (compact.startsWith('0')) return `+62${compact.slice(1)}`;
  if (compact.startsWith('62')) return `+${compact}`;
  return compact;
}

export function validateRegisterField(
  name: RegisterFieldName,
  values: RegisterValues,
): string | undefined {
  switch (name) {
    case 'displayName': {
      const displayName = values.displayName.trim();
      if (!displayName) return 'Please enter your full name.';
      if (displayName.length > 160) return 'Full name can be up to 160 characters.';
      return undefined;
    }
    case 'phone': {
      const raw = values.phone.trim();
      if (!raw) return 'Please enter your WhatsApp number.';
      const normalized = normalizeRegistrationPhone(raw);
      if (!indonesianMobilePattern.test(normalized))
        return 'Please enter a valid Indonesian WhatsApp number starting with 08 or +62, for example 0812 3456 7890.';
      return undefined;
    }
    case 'email':
      if (!values.email.trim()) return 'Please enter your email.';
      if (!emailPattern.test(values.email.trim())) return 'Please enter a valid email address.';
      if (values.email.trim().length > 254) return 'Email can be up to 254 characters.';
      return undefined;
    case 'password':
      if (!values.password) return 'Please choose a password.';
      if (values.password.length < 8) return 'Your password needs at least 8 characters.';
      if (values.password.length > 128) return 'Your password can be up to 128 characters.';
      return undefined;
    case 'consent':
      if (!values.consent)
        return 'Please agree to the Terms & Conditions and Privacy Policy to continue.';
      return undefined;
  }
}

export function validateRegistration(values: RegisterValues): RegisterErrors {
  const fields: RegisterFieldName[] = [
    'displayName',
    'phone',
    'email',
    'password',
    'consent',
  ];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const error = validateRegisterField(field, values);
      return error ? [[field, error]] : [];
    }),
  );
}

export function registrationRequestErrorMessage(
  status?: number,
  code?: string,
  details?: Array<{ field?: string; issue?: string }>,
): string {
  if (code === 'PHONE_ALREADY_REGISTERED') {
    return 'This WhatsApp number is already registered. The studio may have created your account for you, so just sign in.';
  }
  if (code === 'EMAIL_ALREADY_REGISTERED') {
    return 'This email is already registered. Sign in instead, or use a different email.';
  }
  if (code === 'UPLOAD_REJECTED') {
    return 'Please use a JPG, PNG, or WEBP photo.';
  }
  if (status === 409) return 'This email or WhatsApp number is already in use.';
  if (status === 422) {
    // Pesan rinci dari server berbahasa Indonesia; halaman daftar memakai bahasa Inggris.
    if (details?.[0]?.field === 'selfie') return 'Please take a clear selfie to continue.';
    if (details?.[0]?.field === 'consent') return 'Please agree to the Terms & Conditions and Privacy Policy to continue.';
    return 'Please check your details and try again.';
  }
  return "We couldn't create your account just now. Please try again.";
}
