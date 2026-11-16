import { formatRupiah } from '../../lib/formatters';

export type PublicPromotionPrice = {
  label: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  discountRp: number;
  promotionalPriceRp: number;
  activeUntil: string | Date;
};

export function PackagePrice({
  priceRp,
  effectivePriceRp = priceRp,
  promotion,
  sessionCount,
  compact = false,
}: {
  priceRp: number;
  effectivePriceRp?: number;
  promotion?: PublicPromotionPrice | null;
  sessionCount?: number;
  compact?: boolean;
}) {
  const promoted = Boolean(promotion && effectivePriceRp < priceRp);
  return (
    <div className={compact ? 'grid gap-0.5 text-right' : 'grid gap-1'}>
      {promoted && (
        <div className={`flex flex-wrap items-center gap-2 ${compact ? 'justify-end' : ''}`}>
          <del
            className="text-sm font-medium text-ed-muted"
            aria-label={`Harga normal ${formatRupiah(priceRp)}`}
          >
            {formatRupiah(priceRp)}
          </del>
          <span className="rounded-none border border-ed-green/30 bg-ed-mist px-2 py-0.5 text-[13px] font-bold text-ed-green">
            {promotion?.label}
          </span>
        </div>
      )}
      <strong
        className={compact ? 'font-sans text-base text-ed-green font-bold' : 'font-sans text-3xl sm:text-4xl tracking-tight text-ed-green font-bold'}
      >
        {formatRupiah(effectivePriceRp)}
      </strong>
      {promoted && !compact && (
        <span className="text-xs font-semibold text-ed-green">
          Hemat {formatRupiah(promotion?.discountRp ?? 0)}
        </span>
      )}
      {sessionCount !== undefined && sessionCount > 0 && !compact && (
        <span className="text-sm text-ed-muted">
          {formatRupiah(Math.round(effectivePriceRp / sessionCount))} per sesi
        </span>
      )}
    </div>
  );
}
