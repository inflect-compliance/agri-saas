'use client';

/**
 * Sankey flow client island for /controls/sankey.
 *
 * Pure presentation: page-level header (back-to-controls link
 * + title) + the SankeyChart projection of the
 * `TraceabilityGraph` payload (Assets → Risks → Controls). No
 * graph view, no table view, no view-toggle — those were the
 * other two surfaces on the deprecated /traceability page.
 *
 * Search is preserved as a tenant-wide narrowing affordance so
 * the user can isolate flows around a specific entity. State is
 * ephemeral (no persistence) — the Sankey is a glance-and-leave
 * surface, not a long-running workspace.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SankeyChart } from '@/components/ui/SankeyChart';
import type { TraceabilityGraph } from '@/lib/traceability-graph/types';
import { Heading } from '@/components/ui/typography';

export interface ControlsSankeyClientProps {
    initialGraph: TraceabilityGraph;
    tenantSlug: string;
}

export function ControlsSankeyClient({
    initialGraph,
    tenantSlug,
}: ControlsSankeyClientProps) {
    const t = useTranslations('controls');
    // R14-PR7 — standalone search input retired (the user's
    // directive: per-page searchbars die; users search via the
    // global command palette or page filters). For sankey
    // specifically, the input fed `searchQuery` to <SankeyChart>
    // which used it to dim non-matching nodes. The chart now
    // renders the full graph. If chart-level filtering becomes
    // load-bearing again, re-introduce via a dedicated chart-
    // control primitive — never via a bare `<input type="search">`.

    return (
        <div className="space-y-default" id="controls-sankey-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-compact">
                <div>
                    <Link
                        href={`/t/${tenantSlug}/controls`}
                        className="inline-flex items-center gap-1 text-content-muted hover:text-content-emphasis transition-colors text-sm"
                        id="controls-sankey-back"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('sankey.backToControls')}
                    </Link>
                    <Heading level={1} className="mt-2" id="controls-sankey-heading">
                        {t('sankey.heading')}
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        {t('sankey.description')}
                    </p>
                </div>
            </div>

            <SankeyChart graph={initialGraph} searchQuery="" />
        </div>
    );
}
