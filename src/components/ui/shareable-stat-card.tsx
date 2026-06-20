'use client';

import { useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { useToast } from '@/components/ui/hooks';
import { exportShareCard } from '@/lib/share-card';

/**
 * ShareableStatCard — a branded summary card a farmer can keep/show
 * (feat/delight-shareables). The bordered surface is captured to a crisp PNG
 * (html-to-image, 2×) and shared via the native sheet or downloaded. Used by
 * the season recap, field report, and spray-job completion cards.
 *
 * The captured surface carries a solid token background so the exported image
 * is self-contained (it adapts to the active theme — a dark or light card both
 * read well when shared).
 */

export interface ShareStat {
    label: string;
    value: string;
}

interface ShareableStatCardProps {
    eyebrow?: string;
    title: string;
    subtitle?: string;
    stats: ShareStat[];
    /** Extra content inside the captured surface (e.g. a top-fields list). */
    footer?: ReactNode;
    /** Filename stem + share title. */
    fileName: string;
    className?: string;
}

export function ShareableStatCard({
    eyebrow,
    title,
    subtitle,
    stats,
    footer,
    fileName,
    className,
}: ShareableStatCardProps) {
    const captureRef = useRef<HTMLDivElement>(null);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    async function onShare() {
        if (!captureRef.current) return;
        setBusy(true);
        const result = await exportShareCard(captureRef.current, fileName);
        setBusy(false);
        if (result === 'shared') toast.success('Shared');
        else if (result === 'downloaded') toast.success('Image saved');
        else toast.error("Couldn't create the image", { description: 'Please try again.' });
    }

    return (
        <div className={className}>
            <div
                ref={captureRef}
                className="space-y-default rounded-lg border border-border-default bg-bg-default p-section"
            >
                {eyebrow && (
                    <p className="text-xs font-medium uppercase tracking-wide text-content-muted">
                        {eyebrow}
                    </p>
                )}
                <div className="space-y-1">
                    <Heading level={2} className="text-lg">
                        {title}
                    </Heading>
                    {subtitle && <p className="text-sm text-content-secondary">{subtitle}</p>}
                </div>
                <dl className="grid grid-cols-2 gap-default">
                    {stats.map((s) => (
                        <div key={s.label}>
                            <dt className="text-xs text-content-secondary">{s.label}</dt>
                            <dd className="text-xl font-semibold text-content-emphasis">{s.value}</dd>
                        </div>
                    ))}
                </dl>
                {footer}
            </div>
            <div className="mt-default flex justify-end">
                <Button variant="secondary" size="sm" loading={busy} onClick={onShare}>
                    Save / share
                </Button>
            </div>
        </div>
    );
}

export default ShareableStatCard;
