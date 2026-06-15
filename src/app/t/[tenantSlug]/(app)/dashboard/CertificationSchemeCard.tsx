'use client';

import { Card } from '@/components/ui/card';
import { Heading, TextLink } from '@/components/ui/typography';
import { ProgressBar, type ProgressBarVariant } from '@/components/ui/progress-bar';
import type { AgDashboardCertification } from '@/app-layer/usecases/ag-dashboard';

interface CertificationSchemeCardProps {
    /** Tenant-scoped href to the schemes list (`/t/{slug}/schemes`). */
    href: string;
    certification: AgDashboardCertification;
}

/** Bucket the readiness score into a status colour. */
function scoreVariant(score: number): ProgressBarVariant {
    if (score >= 80) return 'success';
    if (score >= 50) return 'warning';
    return 'error';
}

/**
 * Certification readiness — the readiness score of the tenant's top
 * certification scheme (an AG_SCHEME framework). Mirrors LowStockCard's
 * chassis; reads the read-model from <AgDashboardStrip>.
 */
export default function CertificationSchemeCard({ href, certification }: CertificationSchemeCardProps) {
    const { schemeName, score } = certification;
    return (
        <Card>
            <div className="flex items-baseline justify-between mb-3 gap-tight">
                <Heading level={3} id="certification-heading">
                    Certification
                </Heading>
                <TextLink href={href} tone="muted" className="text-xs">
                    View all
                </TextLink>
            </div>
            <div
                className="space-y-tight"
                role="region"
                aria-labelledby="certification-heading"
            >
                <div className="flex items-baseline justify-between gap-tight">
                    <span className="text-content-default font-medium truncate">{schemeName}</span>
                    <span className="text-content-emphasis whitespace-nowrap tabular-nums text-sm font-semibold">
                        {score}
                    </span>
                </div>
                <ProgressBar
                    value={score}
                    variant={scoreVariant(score)}
                    size="sm"
                    aria-label={`${schemeName} readiness score`}
                />
                <p className="text-content-subtle text-xs">Readiness score</p>
            </div>
        </Card>
    );
}
