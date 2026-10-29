import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import type { PublicSiteConfig } from '@/api-clients/account-client';
import { LandingClasses } from './landing-classes';
import { LandingPackages } from './landing-packages';
import { LandingTestimonials } from './landing-testimonials';

const classes: PublicSiteConfig['classes'] = [
  {
    code: 'REFORMER',
    name: 'Reformer Pilates',
    slug: 'reformer-pilates',
    summary: 'Latihan seluruh tubuh dengan reformer.',
    description: 'Latihan terarah.',
    level: 'Semua level',
    durationMinutes: 50,
    equipment: ['Reformer'],
    benefits: ['Kekuatan'],
    heroImageKey: 'classes/reformer-pilates.png',
  },
  {
    code: 'MAT',
    name: 'Mat Pilates',
    slug: 'mat-pilates',
    summary: 'Gerak presisi di atas mat.',
    description: 'Bangun kontrol tubuh.',
    level: 'Semua level',
    durationMinutes: 50,
    equipment: ['Mat'],
    benefits: ['Kontrol'],
    heroImageKey: 'classes/mat-pilates.png',
  },
];

describe('LandingClasses', () => {
  it('renders each class as a numbered row with a descriptive detail link', async () => {
    const view = render(<LandingClasses classes={classes} />);

    const list = screen.getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('heading', { name: 'Reformer Pilates' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Latihan seluruh tubuh dengan reformer.')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Gerak presisi di atas mat.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Reformer Pilates details' })).toHaveAttribute(
      'href',
      '/classes/reformer-pilates',
    );
    expect(screen.getByRole('link', { name: 'View Mat Pilates details' })).toHaveAttribute(
      'href',
      '/classes/mat-pilates',
    );
    expect(screen.getByRole('link', { name: /See all classes/ })).toHaveAttribute('href', '/classes');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('shows only the first six classes and links to the full list when there are more', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...classes[0]!,
      code: `TYPE_${index}`,
      name: `Kelas ${index + 1}`,
      slug: `kelas-${index + 1}`,
    }));
    const { rerender } = render(<LandingClasses classes={many} />);

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Kelas 7' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all 8 classes' })).toHaveAttribute(
      'href',
      '/classes',
    );

    rerender(<LandingClasses classes={many.slice(0, 6)} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(screen.queryByRole('link', { name: /See all \d+ classes/ })).not.toBeInTheDocument();
  });

  it('shows a busy placeholder list while the catalog is loading', async () => {
    const view = render(<LandingClasses classes={null} />);

    expect(screen.getByLabelText('Loading classes')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });

  it('shows the error and empty states without a class list', () => {
    const { rerender } = render(
      <LandingClasses classes={null} error="Informasi studio belum dapat dimuat." />,
    );
    expect(screen.getByText('Informasi studio belum dapat dimuat.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    rerender(<LandingClasses classes={[]} />);
    expect(screen.getByText('No classes are available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('LandingTestimonials', () => {
  it('renders one featured quote, two supporting quotes and the studio philosophy', async () => {
    const view = render(<LandingTestimonials />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /Refined Movement\.\s*Real Transformation\./,
    );
    expect(view.container.querySelectorAll('blockquote')).toHaveLength(3);
    expect(screen.getByText('Maya S.')).toBeInTheDocument();
    expect(screen.getByText('Ronald K.')).toBeInTheDocument();
    expect(screen.getByText('Clarissa W.')).toBeInTheDocument();
    expect(screen.getByText(/Consistency is not perfection/)).toBeInTheDocument();
    expect(view.container.querySelector('#testimonials')).not.toBeNull();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });
});

describe('LandingPackages', () => {
  it('keeps the package journey test id with three numbered steps and both calls to action', async () => {
    const view = render(<LandingPackages />);

    const journey = view.container.querySelector('[data-testid="package-journey"]') as HTMLElement;
    expect(journey).not.toBeNull();
    expect(within(journey).getByRole('heading', { level: 2 })).toHaveTextContent(
      /Build a routine that\s*lasts/,
    );
    const steps = within(journey).getByRole('list');
    expect(steps.children).toHaveLength(3);
    expect(within(steps).getByText('Choose a studio')).toBeInTheDocument();
    expect(within(steps).getByText('Compare packages')).toBeInTheDocument();
    expect(within(steps).getByText('Book a class')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a Package' })).toHaveAttribute('href', '/packages');
    expect(screen.getByRole('link', { name: 'See Schedule' })).toHaveAttribute(
      'href',
      '/classes#schedule',
    );
    expect((await axe(view.container)).violations).toHaveLength(0);
  });
});
