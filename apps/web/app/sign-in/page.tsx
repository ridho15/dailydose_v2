import type { Metadata } from 'next';
import { SignInView } from './sign-in-view';
import { hrGroupEnabled } from '../lib/hr-group';

// Tombol Akun HR Group mengikuti env server saat permintaan (HRG_ENABLED), bukan saat build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Masuk',
};

export default function SignInPage() {
  return <SignInView hrGroupEnabled={hrGroupEnabled()} />;
}
