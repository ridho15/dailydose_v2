import type { Metadata } from 'next';
import { PayrollView } from './payroll-view';

export const metadata: Metadata = { title: 'Payroll saya' };

export default function PayrollPage() {
  return <PayrollView />;
}
