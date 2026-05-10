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
import { useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { SankeyChart } from '@/components/ui/SankeyChart';
import type { TraceabilityGraph } from '@/lib/traceability-graph/types';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

export interface ControlsSankeyClientProps {
    initialGraph: TraceabilityGraph;
    tenantSlug: string;
}

export function ControlsSankeyClient({
    initialGraph,
    tenantSlug,
}: ControlsSankeyClientProps) {
    const [searchQuery, setSearchQuery] = useState('');

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
                        Back to Controls
                    </Link>
                    <Heading level={1} className="mt-2" id="controls-sankey-heading">
                        Controls flow
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        How assets expose risks and how controls mitigate them, at a glance.
                    </p>
                </div>
            </div>

            {/* Search filter — narrows the underlying graph before
                the Sankey projects it. Useful when a tenant has
                hundreds of assets/risks/controls. */}
            <div className={cardVariants({ density: 'compact' })} id="controls-sankey-filters">
                <div className="relative">
                    <Search
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-subtle"
                        aria-hidden="true"
                    />
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter by node label, code, or status..."
                        className="input w-full pl-8"
                        id="controls-sankey-search"
                        aria-label="Filter Sankey flows"
                    />
                </div>
            </div>

            <SankeyChart graph={initialGraph} searchQuery={searchQuery} />
        </div>
    );
}
