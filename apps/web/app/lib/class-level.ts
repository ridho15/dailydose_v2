/** Label tingkat kelas untuk pelanggan; nilai mentah dari API (mis. ALL_LEVELS) tidak boleh tampil. */
const levelLabels: Record<string, string> = {
  ALL_LEVELS: 'Semua Level',
  BEGINNER: 'Pemula',
  INTERMEDIATE: 'Menengah',
  ADVANCED: 'Lanjutan',
};

const levelLabelsEn: Record<string, string> = {
  ALL_LEVELS: 'All Levels',
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
};

export function classLevelLabel(
  level: string | null | undefined,
  lang: 'id' | 'en' = 'id',
): string {
  if (!level) return '';
  const known = (lang === 'en' ? levelLabelsEn : levelLabels)[
    level.trim().toUpperCase().replace(/[\s-]+/g, '_')
  ];
  if (known) return known;
  if (lang === 'en') {
    const kata: Record<string, string> = {
      'semua level': 'All Levels',
      pemula: 'Beginner',
      menengah: 'Intermediate',
      lanjutan: 'Advanced',
    };
    const terjemahan = level
      .trim()
      .split(/(\s*[–\-/]\s*)/)
      .map((bagian) => kata[bagian.toLowerCase()] ?? bagian)
      .join('');
    if (terjemahan !== level.trim()) return terjemahan;
  }
  const words = level.trim().replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
