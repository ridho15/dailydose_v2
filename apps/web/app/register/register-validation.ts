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
      if (!displayName) return 'Nama lengkap wajib diisi.';
      if (displayName.length > 160) return 'Nama lengkap maksimal 160 karakter.';
      return undefined;
    }
    case 'phone': {
      const raw = values.phone.trim();
      if (!raw) return 'Nomor WhatsApp wajib diisi.';
      const normalized = normalizeRegistrationPhone(raw);
      if (!indonesianMobilePattern.test(normalized))
        return 'Masukkan nomor WhatsApp yang valid (awalan 08 atau +62), misalnya 0812 3456 7890.';
      return undefined;
    }
    case 'email':
      if (!values.email.trim()) return 'Email wajib diisi.';
      if (!emailPattern.test(values.email.trim())) return 'Masukkan alamat email yang valid.';
      if (values.email.trim().length > 254) return 'Email maksimal 254 karakter.';
      return undefined;
    case 'password':
      if (!values.password) return 'Password wajib diisi.';
      if (values.password.length < 8) return 'Password minimal 8 karakter.';
      if (values.password.length > 128) return 'Password maksimal 128 karakter.';
      return undefined;
    case 'consent':
      if (!values.consent)
        return 'Anda wajib menyetujui Syarat & Ketentuan serta Kebijakan Privasi Daily Dose.';
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
    return 'Nomor WhatsApp ini sudah terdaftar. Akun Anda mungkin sudah dibuatkan oleh staf studio. Silakan langsung masuk.';
  }
  if (code === 'EMAIL_ALREADY_REGISTERED') {
    return 'Alamat email ini sudah terdaftar. Silakan gunakan email lain atau masuk ke akun Anda.';
  }
  if (code === 'UPLOAD_REJECTED' && details?.[0]?.issue) {
    return details[0].issue;
  }
  if (status === 409) return 'Email atau nomor WhatsApp sudah digunakan.';
  if (status === 422) {
    if (details?.[0]?.issue) return details[0].issue;
    return 'Periksa kembali data yang diisi.';
  }
  return 'Registrasi belum dapat diproses. Coba kembali.';
}
