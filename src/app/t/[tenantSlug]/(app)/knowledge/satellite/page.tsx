'use client';

/**
 * Satellite imagery guide — a single explainer page for the vegetation-index
 * map overlays (NDVI / NDMI / NDRE / GNDVI / EVI). The map legend's "Learn
 * more" link deep-links here with the active index as a hash (e.g.
 * `…/knowledge/satellite#ndvi`); the effect below scrolls to that section,
 * Wikipedia-style. One section per index, each with a short blurb and a
 * "how to read the colours" note tied to the same gradient the map uses.
 */
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { cn } from '@/lib/cn';
import { VEGETATION_INDICES } from '@/lib/agro/vegetation-indices';

export default function SatelliteImageryGuidePage() {
    const t = useTranslations('satelliteImagery');
    const router = useRouter();

    // Scroll to the deep-linked section once the client-rendered content
    // exists — native hash scrolling misses it on the first client render.
    useEffect(() => {
        const id = window.location.hash.slice(1);
        if (!id) return;
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    return (
        <div className="mx-auto w-full max-w-3xl space-y-section px-4 py-6">
            <div className="space-y-default">
                <Button variant="ghost" size="sm" onClick={() => router.back()}>
                    {t('back')}
                </Button>
                <Heading level={1}>{t('title')}</Heading>
                <p className="max-w-prose text-content-secondary">{t('intro')}</p>
            </div>

            {/* Table of contents — jump links to each index's section. */}
            <nav
                aria-label={t('tocLabel')}
                className="rounded-lg border border-border-subtle bg-bg-muted p-4"
            >
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-content-subtle">
                    {t('tocLabel')}
                </p>
                <ul className="space-y-tight">
                    {VEGETATION_INDICES.map((idx) => (
                        <li key={idx.id}>
                            <a
                                href={`#${idx.id}`}
                                className="text-content-link underline hover:text-content-emphasis"
                            >
                                {t(`${idx.id}.title`)}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="space-y-section">
                {VEGETATION_INDICES.map((idx) => (
                    <section key={idx.id} id={idx.id} className="scroll-mt-24 space-y-default">
                        <Heading level={2}>{t(`${idx.id}.title`)}</Heading>
                        <p className="max-w-prose text-content-secondary">{t(`${idx.id}.blurb`)}</p>

                        {/* How to read the colours — the exact gradient the map
                            legend paints, with the low/high captions. */}
                        <div className="space-y-tight rounded-lg border border-border-subtle p-3">
                            <div className="flex items-center gap-compact text-xs text-content-subtle">
                                <span>{idx.lowLabel}</span>
                                <span
                                    aria-hidden="true"
                                    className={cn('h-2 w-40 max-w-full rounded-full', idx.legendGradientClass)}
                                />
                                <span>{idx.highLabel}</span>
                            </div>
                            <p className="max-w-prose text-sm text-content-secondary">
                                {t(`${idx.id}.colours`)}
                            </p>
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
