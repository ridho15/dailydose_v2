'use client';

import { useEffect, useState } from 'react';

/**
 * True di layar HP (di bawah 640 px). Tanpa `matchMedia` (mis. tes) dianggap layar lebar, jadi
 * tampilan bawaan tidak berubah.
 */
export function useLayarKecil(query = '(max-width: 639px)') {
  const [kecil, setKecil] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const ubah = () => setKecil(media.matches);
    ubah();
    media.addEventListener('change', ubah);
    return () => media.removeEventListener('change', ubah);
  }, [query]);
  return kecil;
}
