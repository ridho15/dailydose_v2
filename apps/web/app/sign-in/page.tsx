import type { Metadata } from 'next';
import { SignInView } from './sign-in-view';

// Silent JIT mode: sinkronisasi HR Group berjalan di backend tanpa menampilkan tombol SSO di halaman login.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function SignInPage() {
  return <SignInView hrGroupEnabled={false} />;
}
