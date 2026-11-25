import type { Metadata } from 'next';
import { ResetPasswordView } from './reset-password-view';

export const metadata: Metadata = {
  title: 'Set a new password',
};

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
