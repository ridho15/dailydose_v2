#!/usr/bin/env bash
# Memastikan berkas env produksi memuat konfigurasi fitur booking. Tanpa ini API membalas 503
# CONFIGURATION_REQUIRED dan pelanggan melihat "Fitur booking yang diminta belum tersedia."
# Pemakaian: tools/check-env.sh [berkas-env]   (default: .env.production)
set -u
file="${1:-.env.production}"
[ -f "$file" ] || { echo "GAGAL: $file tidak ditemukan." >&2; exit 1; }

value() {
  grep -E "^$1=" "$file" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^["'\'']|["'\'']$//g; s/^[[:space:]]+|[[:space:]]+$//g'
}

errors=0
fail() { echo "GAGAL: $1" >&2; errors=$((errors + 1)); }

for feature in BOOKING RESCHEDULE BOOKING_CANCELLATION; do
  enabled="$(value "${feature}_ENABLED")"
  hours="$(value "${feature}_CUTOFF_HOURS")"
  [ "$enabled" = "true" ] || fail "${feature}_ENABLED harus persis 'true' di $file (nilai sekarang: '${enabled:-kosong}'). Perbaikan: tambahkan ${feature}_ENABLED=true."
  [[ "$hours" =~ ^[1-9][0-9]*$ ]] || fail "${feature}_CUTOFF_HOURS harus bilangan bulat >= 1 di $file (nilai sekarang: '${hours:-kosong}'). Perbaikan: tambahkan ${feature}_CUTOFF_HOURS=24."
done

[ "$errors" -eq 0 ] && echo "OK: konfigurasi booking, reschedule, dan pembatalan lengkap di $file."
exit $((errors > 0))
