/**
 * Label peran untuk UI. Backend hanya mengirim kode kanonik (SUPER_OWNER, OWNER, MANAGER, ADMIN,
 * FINANCE, INSTRUCTOR, CUSTOMER). Pencarian label tetap tidak boleh mengasumsikan kode selalu dikenal.
 */
type RoleLabelVariant = 'scoped' | 'short';

const labels: Record<string, { scoped: string; short: string }> = {
  SUPER_OWNER: { scoped: 'Super Owner', short: 'Super Owner' },
  OWNER: { scoped: 'Owner cabang', short: 'Owner' },
  ADMIN: { scoped: 'Admin cabang', short: 'Admin' },
  MANAGER: { scoped: 'Manager cabang', short: 'Manager' },
  FINANCE: { scoped: 'Finance', short: 'Finance' },
  INSTRUCTOR: { scoped: 'Instruktur', short: 'Instruktur' },
  CUSTOMER: { scoped: 'Pelanggan', short: 'Pelanggan' },
};

function humanizeRoleCode(role: string): string {
  const words = role
    .trim()
    .split(/[\s_:-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return words.length ? words.join(' ') : 'Role tidak dikenal';
}

export function roleLabel(role: string | null | undefined, variant: RoleLabelVariant = 'scoped') {
  if (!role) return 'Role tidak dikenal';
  return labels[role]?.[variant] ?? humanizeRoleCode(role);
}
