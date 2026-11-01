import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { frontendPages } from '@/lib/frontend-pages';
import { PageMetaProvider } from './page-meta';
import { ScopeChip } from './scope-chip';

let context: unknown = null;
vi.mock('../../session-context', () => ({ useSessionContext: () => context }));

const page = (href: string) => frontendPages.find((item) => item.href === href)!;
const session = (capabilities: string[]) => ({
  session: { capabilities },
  activeBranch: { id: 'b1', name: 'Jakarta' },
});

describe('ScopeChip', () => {
  beforeEach(() => {
    context = null;
  });

  it('shows the active branch on branch-scoped pages', () => {
    context = session(['booking:read']);
    render(
      <PageMetaProvider value={page('/workspace/bookings')}>
        <ScopeChip />
      </PageMetaProvider>,
    );
    expect(screen.getByText(/Cakupan:/)).toHaveTextContent('Cakupan: Jakarta');
  });

  it('always says every branch on global pages, whatever the topbar has selected', () => {
    context = session(['branch:all']);
    render(
      <PageMetaProvider value={page('/workspace/vouchers')}>
        <ScopeChip />
      </PageMetaProvider>,
    );
    expect(screen.getByText(/Cakupan:/)).toHaveTextContent('Cakupan: Semua cabang');
  });

  it('describes limited staff as assigned branches on global pages', () => {
    context = session(['voucher:read']);
    render(
      <PageMetaProvider value={page('/workspace/vouchers')}>
        <ScopeChip />
      </PageMetaProvider>,
    );
    expect(screen.getByText(/Cakupan:/)).toHaveTextContent('Semua cabang penugasan');
  });

  it('renders nothing outside the shell or without a session', () => {
    const { container } = render(<ScopeChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
