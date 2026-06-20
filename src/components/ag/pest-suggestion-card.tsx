'use client';

import { AiSuggestionCard } from './ai-suggestion-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ProgressBar } from '@/components/ui/progress-bar';

/**
 * Advisory card for the async leaf/crop photo classification produced by
 * the `classify-photo` job (feat/ai-vision). Shape mirrors `StoredPestId`
 * persisted at `LogEntry.attributesJson.pestId`.
 *
 * This component imports ONLY the TYPE of the result — never a vision
 * provider (those load native addons / the Anthropic SDK and are
 * server-only). The card is advisory: there is NO "apply" button that
 * mutates the entry.
 *
 * Three guard-rails are non-negotiable here:
 *   1. CONFIDENCE shown as a % + bar (icon/text, not colour-only).
 *   2. A mandatory "AI suggestion — verify with an agronomist, not a
 *      diagnosis" disclaimer (the AiSuggestionCard shell + the explicit
 *      stored disclaimer).
 *   3. A lab-vs-field accuracy caveat, plus low-confidence results
 *      visibly de-emphasised / flagged.
 */

/** The persisted result shape (kept in sync with `StoredPestId`). */
export interface PestSuggestionData {
    identifiedPest: string;
    confidence: number;
    recommendation: string;
    modelVersion: string;
    backend: 'onnx' | 'claude';
    lowConfidence: boolean;
    disclaimer: string;
    at?: string;
    fileRecordId?: string;
}

const FIELD_CAVEAT =
    'Field photos are noisier than lab images — treat low-confidence results with extra caution.';

export function PestSuggestionCard({ data }: { data: PestSuggestionData | null | undefined }) {
    if (!data) return null;

    const pct = Math.round(Math.max(0, Math.min(1, data.confidence)) * 100);
    const isHealthy = data.identifiedPest.toLowerCase() === 'healthy';
    const title = isHealthy
        ? 'No pest or disease detected'
        : data.identifiedPest === 'unknown'
          ? 'Photo analysed — inconclusive'
          : data.identifiedPest;

    // Map the numeric confidence onto the shell's confidence badge band.
    const confidenceBand = data.lowConfidence ? 'low' : pct >= 80 ? 'high' : 'medium';
    const meta = `${data.modelVersion} · ${data.backend === 'onnx' ? 'on-device' : 'cloud'}`;

    return (
        <AiSuggestionCard
            title={title}
            confidence={confidenceBand}
            meta={meta}
            className={data.lowConfidence ? 'opacity-80 border-dashed' : undefined}
        >
            <div className="space-y-tight">
                <div className="flex items-center gap-tight">
                    {data.lowConfidence && (
                        <StatusBadge variant="warning" size="sm">
                            Low confidence
                        </StatusBadge>
                    )}
                    {!isHealthy && data.identifiedPest !== 'unknown' && (
                        <StatusBadge variant="neutral" size="sm">
                            Suggestion only
                        </StatusBadge>
                    )}
                </div>

                <ProgressBar
                    value={pct}
                    variant={data.lowConfidence ? 'warning' : pct >= 80 ? 'success' : 'info'}
                    size="sm"
                    showValue
                    aria-label="Classification confidence"
                />

                <p>{data.recommendation}</p>

                {/* The mandatory hard disclaimer — the exact stored text. */}
                <p className="text-[11px] font-medium text-content-warning">{data.disclaimer}</p>

                {/* Lab-vs-field accuracy caveat. */}
                <p className="text-[11px] text-content-subtle">{FIELD_CAVEAT}</p>
            </div>
        </AiSuggestionCard>
    );
}
