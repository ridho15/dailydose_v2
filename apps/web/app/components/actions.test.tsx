import { render, screen } from '@testing-library/react';
import { ArrowRight, Pencil } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Button, ButtonLink, IconButton, StickyActionBar } from './actions';

describe('action primitives', () => {
  it('keeps labels and leading/trailing icons in one aligned row', () => {
    render(
      <>
        <Button leadingIcon={<Pencil data-testid="leading" />}>Edit paket</Button>
        <ButtonLink href="/workspace/packages" trailingIcon={<ArrowRight data-testid="trailing" />}>
          Buka paket
        </ButtonLink>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Edit paket' })).toHaveClass('inline-flex');
    expect(screen.getByText('Edit paket')).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('leading')).toBeInTheDocument();
    expect(screen.getByTestId('trailing')).toBeInTheDocument();
  });

  it('uses an accessible label for icon-only actions', () => {
    render(
      <IconButton label="Edit cabang">
        <Pencil />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Edit cabang' })).toHaveClass(
      'h-11',
      'w-11',
      'min-h-11',
      'min-w-11',
    );
  });

  it('replaces the leading icon with a spinner while loading', () => {
    render(
      <Button loading loadingLabel="Menyimpan" leadingIcon={<Pencil data-testid="hidden-icon" />}>
        Simpan
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Menyimpan' })).toBeDisabled();
    expect(screen.queryByTestId('hidden-icon')).not.toBeInTheDocument();
  });

  it('keeps primary and secondary actions visually distinct with accessible targets', () => {
    render(
      <>
        <Button>Aksi utama</Button>
        <ButtonLink href="/next" variant="secondary" size="sm">
          Aksi sekunder
        </ButtonLink>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Aksi utama' })).toHaveClass(
      'min-h-11',
      'cursor-pointer',
      'bg-dd-forest',
      'text-white',
    );
    expect(screen.getByRole('link', { name: 'Aksi sekunder' })).toHaveClass(
      'min-h-10',
      'border-dd-forest/25',
      'bg-white',
      'text-dd-forest',
    );
  });
});

describe('StickyActionBar di atas navigasi bawah', () => {
  it('memakai tinggi navigasi bawah dari kerangka (var --dd-nav-bawah), jadi tombolnya tidak tertutup', () => {
    render(
      <StickyActionBar>
        <button type="button">Buat pesanan</button>
      </StickyActionBar>,
    );
    const bar = screen.getByRole('button', { name: 'Buat pesanan' }).closest('div.sticky')!;
    expect(bar.className).toContain('bottom-[calc(var(--dd-nav-bawah,0px)+1rem+env(safe-area-inset-bottom))]');
  });
});
