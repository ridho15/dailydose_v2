import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { LandingIntro } from './landing-intro';

describe('LandingIntro', () => {
  it('menampilkan judul pengantar dan empat keunggulan studio dengan anchor lama', async () => {
    const view = render(<LandingIntro />);

    const section = view.container.querySelector('section');
    expect(section).toHaveAttribute('id', 'about');
    expect(section).toHaveClass('ed-scope');
    expect(
      screen.getByRole('heading', { level: 2, name: 'A small space to move differently.' }),
    ).toBeInTheDocument();

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    [
      'Small, Exclusive Classes',
      'Certified Instructors',
      'Modern Pilates Equipment',
      'A Calm Studio',
    ].forEach((title, index) => {
      expect(within(items[index]!).getByRole('heading', { level: 3, name: title })).toBeVisible();
    });
    expect(within(items[0]!).getByText('Up to 4 people per session')).toBeInTheDocument();
    expect((await axe(view.container)).violations).toHaveLength(0);
  });
});
