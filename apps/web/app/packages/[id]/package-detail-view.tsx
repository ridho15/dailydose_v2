'use client';

import Link from 'next/link';
import { Check, Clock3, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  publicDetailClient,
  publicDetailFailure,
  type PublicPackageDetail,
} from '@/api-clients/public-detail-client';
import {
  AudienceAction,
  DetailFailure,
  DetailFactLedger,
  DetailHero,
  DetailLoading,
  PublicDetailFrame,
  RelatedSchedules,
  publicSecondaryButton,
} from '../../components/public/public-detail-shared';
import { PackagePrice } from '../../components/public/package-price';
import { formatRupiah } from '../../lib/formatters';

export function PackageDetailView({
  id,
  initialData = null,
}: {
  id: string;
  initialData?: PublicPackageDetail | null;
}) {
  const [item, setItem] = useState<PublicPackageDetail | null>(initialData);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (initialData && attempt === 0) return;
    setFailure('');
    publicDetailClient
      .package(id)
      .then((value) => active && setItem(value))
      .catch((error) => active && setFailure(publicDetailFailure(error)));
    return () => {
      active = false;
    };
  }, [attempt, id, initialData]);

  return (
    <PublicDetailFrame
      breadcrumb={[{ label: 'Paket', href: '/packages' }, { label: item?.name ?? 'Detail' }]}
    >
      {!item && !failure && <DetailLoading label="paket" />}
      {failure && (
        <DetailFailure
          message={failure}
          listHref="/packages"
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      {item && (
        <>
          <DetailHero
            eyebrow={`${item.classType?.name ?? 'Pilates'} · ${item.branch?.publicProfile?.area ?? item.branch?.name ?? ''}`}
            title={item.name}
            summary={item.publicProfile?.summary ?? ''}
            imageKey={item.branch?.publicProfile?.heroImageKey ?? ''}
            facts={
              <DetailFactLedger
                items={
                  item.perpanjanganMasaAktif
                    ? [
                        { label: 'Harga', value: formatRupiah(item.effectivePriceRp) },
                        { label: 'Jenis', value: 'Perpanjangan masa aktif' },
                        { label: 'Tambahan', value: `${item.extensionDays ?? 30} hari` },
                      ]
                    : [
                        { label: 'Harga', value: formatRupiah(item.effectivePriceRp) },
                        { label: 'Per sesi', value: formatRupiah(item.pricePerSessionRp ?? 0) },
                        { label: 'Jumlah', value: `${item.sessionCount} sesi` },
                        { label: 'Berlaku', value: `${item.durationDays} hari` },
                      ]
                }
              />
            }
            actions={
              <>
                <AudienceAction kind="package" id={item.id} branchId={item.branch?.id} />
                <Link
                  className={publicSecondaryButton}
                  href={`/locations/${item.branch?.publicProfile?.slug ?? ''}`}
                >
                  <MapPin className="size-4" /> Detail studio
                </Link>
              </>
            }
          />
          {item.promotion && (
            <section className="ed-wrap pt-8" aria-label="Promo paket aktif">
              <div className="flex flex-col gap-4 rounded-none border border-ed-line bg-ed-tint p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="ed-eyebrow text-ed-green">
                    {item.promotion.label}
                  </p>
                  <p className="mt-1 text-sm text-ed-muted">
                    Promo berlaku sampai{' '}
                    {new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(
                      new Date(item.promotion.activeUntil),
                    )}
                    .
                  </p>
                </div>
                <PackagePrice
                  priceRp={item.priceRp}
                  effectivePriceRp={item.effectivePriceRp}
                  promotion={item.promotion}
                  sessionCount={item.sessionCount}
                />
              </div>
            </section>
          )}
          <section className="ed-wrap grid gap-8 py-10 lg:grid-cols-[1fr_0.78fr]">
            <div className="grid gap-8">
              <article>
                <p className="ed-eyebrow text-ed-green">
                  Tentang paket
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-ed-ink sm:text-3xl">
                  Ritme latihan yang lebih konsisten
                </h2>
                <p className="mt-4 text-base leading-relaxed text-ed-muted">{item.publicProfile.description}</p>
                <ul className="mt-6 grid list-none gap-3 p-0 sm:grid-cols-2">
                  {(Array.isArray(item.publicProfile?.highlights) ? item.publicProfile.highlights : []).map(
                    (highlight) => (
                      <li
                        className="flex items-start gap-3 rounded-none border border-ed-line bg-white p-4 text-sm font-medium text-ed-ink"
                        key={highlight}
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-ed-green" />
                        {highlight}
                      </li>
                    ),
                  )}
                </ul>
              </article>
              <article>
                <h2 className="text-2xl font-bold tracking-tight text-ed-ink">Jadwal terkait</h2>
                <div className="mt-4">
                  <RelatedSchedules
                    items={item.schedules.map((schedule) => ({ ...schedule, branch: item.branch }))}
                  />
                </div>
              </article>
            </div>
            <aside className="grid content-start gap-5">
              <div className="rounded-none border border-ed-line bg-white p-6 shadow-none">
                <Clock3 className="size-5 text-ed-green" />
                <h2 className="mt-3 text-lg font-bold text-ed-ink">Cara menggunakan</h2>
                <p className="mt-3 text-sm leading-relaxed text-ed-muted">
                  {item.publicProfile?.usageGuidance ?? ''}
                </p>
              </div>
              <div className="rounded-none border border-ed-line bg-ed-tint/60 p-6 shadow-none">
                <h2 className="text-lg font-bold text-ed-ink">Ketentuan paket</h2>
                <ul className="mt-4 grid gap-3 pl-5 text-sm leading-relaxed text-ed-muted">
                  {(Array.isArray(item.publicProfile?.terms) ? item.publicProfile.terms : []).map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </section>
        </>
      )}
    </PublicDetailFrame>
  );
}
