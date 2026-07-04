'use client';

import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { formatDate } from '@/lib/format-date';
import type { FieldBriefingPayload } from '@/app-layer/usecases/satellite-briefing';
import type { BriefingAction } from '@/app-layer/ai/field-briefing';

const PRIORITY_DOT: Record<BriefingAction['priority'], string> = {
    high: 'bg-content-error',
    medium: 'bg-content-warning',
    low: 'bg-content-subtle',
};

const PRIORITY_LABEL: Record<BriefingAction['priority'], string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
};

/**
 * FieldBriefingCard — the AI "what's important to do today" briefing that
 * replaced the static season-recap card. Reads the field-briefing
 * read-model (today's satellite NDVI/NDMI per field + crop / season /
 * activity context, summarised by Claude Haiku).
 *
 * Self-hides (renders nothing) until there's a briefing to show, so a
 * deployment with no Claude key — or a tenant with no farm data yet — never
 * sees an empty or error card. A footer notes whether the briefing used
 * live satellite imagery or the farm's records.
 */
export function FieldBriefingCard() {
    const { data } = useTenantSWR<FieldBriefingPayload>('/reports/field-briefing');

    // Loading, not configured, or generation failed → show nothing.
    if (!data || !data.briefing) return null;

    const { briefing } = data;
    const basis = data.satelliteAvailable
        ? 'Based on today’s satellite imagery'
        : 'Based on your farm records';

    return (
        <Card>
            <div className="flex items-baseline justify-between gap-tight mb-2">
                <div className="flex items-center gap-tight">
                    <span
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-full bg-content-success"
                    />
                    <Heading level={3} id="field-briefing-heading">
                        Field briefing
                    </Heading>
                </div>
                <span className="text-xs text-content-subtle whitespace-nowrap">AI · Haiku</span>
            </div>

            <div
                id="field-briefing"
                className="space-y-default"
                role="region"
                aria-labelledby="field-briefing-heading"
            >
                <div className="space-y-tight">
                    <p className="text-sm font-medium text-content-emphasis">{briefing.headline}</p>
                    <p className="text-sm text-content-secondary">{briefing.summary}</p>
                </div>

                {briefing.actions.length > 0 && (
                    <ul className="space-y-tight">
                        {briefing.actions.map((a, i) => (
                            <li key={i} className="flex items-start gap-tight text-sm">
                                <span
                                    aria-hidden
                                    className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[a.priority]}`}
                                />
                                <span className="text-content-default">
                                    {a.field ? (
                                        <span className="font-medium text-content-emphasis">{a.field}: </span>
                                    ) : null}
                                    {a.action}
                                </span>
                                <span className="ml-auto shrink-0 text-xs text-content-subtle whitespace-nowrap">
                                    {PRIORITY_LABEL[a.priority]}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}

                <p className="text-xs text-content-subtle">
                    {basis} · {formatDate(data.date)}
                </p>
            </div>
        </Card>
    );
}

export default FieldBriefingCard;
