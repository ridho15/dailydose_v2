import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PenjelasanCekOtomatis } from './transfer-proof-viewer';

describe('PenjelasanCekOtomatis', () => {
  it('menjelaskan alasan dan angka yang terbaca, dalam WIB', () => {
    render(
      <PenjelasanCekOtomatis
        cek={{
          hasil: 'WAKTU_DI_LUAR_JENDELA',
          diperiksaPada: '2026-11-24T05:00:00Z',
          nominalTerbaca: [1_500_123],
          waktuTerbaca: ['2026-11-24T01:15:00.000Z'],
        }}
      />,
    );
    const teks = screen.getByText(/Belum disetujui otomatis/).textContent ?? '';
    expect(teks).toContain('lebih dari 1 jam');
    expect(teks).toContain('1.500.123');
    expect(teks).toMatch(/08[.:]15/);
  });

  it('tidak tampil bila sudah cocok', () => {
    const { container } = render(
      <PenjelasanCekOtomatis cek={{ hasil: 'COCOK', diperiksaPada: '', nominalTerbaca: [], waktuTerbaca: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
