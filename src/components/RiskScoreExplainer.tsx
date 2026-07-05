'use client';

/**
 * RQ2-3 — "why this number" popover for risk scores.
 *
 * Wrap any score chip:
 *
 *   <RiskScoreExplainer tenantSlug={slug} riskId={id}>
 *       <span>{score}</span>
 *   </RiskScoreExplainer>
 *
 * On open it lazy-fetches `/risks/:id/score-explanation` (never
 * eagerly — list pages render hundreds of chips) and answers
 * who / when / why / what-changed without navigation:
 *
 *   formula in the tenant's own language → band → control
 *   derivation (RQ2-2) → quant line (FAIR/SLE) → open appetite
 *   breaches → recent provenance events (RQ2-1, MIGRATION rows
 *   labelled honestly).
 *
 * One component for every surface — the structural ratchet at
 * tests/guardrails/risk-score-explainer.test.ts keeps score chips
 * from rendering bare.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Popover } from '@/components/ui/popover';
import { useKeyboardShortcut } from '@/lib/hooks/use-keyboard-shortcut';
import { formatDateTime } from '@/lib/format-date';
import type { ScoreExplanation } from '@/app-layer/usecases/risk-score-explanation';

/**
 * Plain-language attribution for a provenance event. The grammar
 * varies by source — AI suggestions read "AI suggestion · accepted
 * by Alice" rather than "(accepted AI suggestion) by Alice", which
 * made the human assessor sound incidental to the machine.
 */
function describeProvenance(
    t: ReturnType<typeof useTranslations>,
    source: string,
    actorName: string | null,
): string {
    switch (source) {
        case 'USER':
            return actorName ? t('provManualBy', { name: actorName }) : t('provManual');
        case 'DERIVED':
            return actorName ? t('provDerivedBy', { name: actorName }) : t('provDerived');
        case 'PLAN':
            return actorName ? t('provPlanBy', { name: actorName }) : t('provPlan');
        case 'AI':
            // The assessor is the decision; the AI is the proposer.
            return actorName ? t('provAiBy', { name: actorName }) : t('provAi');
        case 'MIGRATION':
            return t('provMigration');
        default:
            return source;
    }
}

export function RiskScoreExplainer({
    tenantSlug,
    riskId,
    label,
    children,
}: {
    tenantSlug: string;
    riskId: string;
    /**
     * Visible chip content (e.g. `"20 · High"`) — used to compose the
     * trigger's aria-label so screen-reader users hear the number and
     * band before "explain", not just the bare verb.
     */
    label?: string;
    children: React.ReactNode;
}) {
    const t = useTranslations('riskScore');
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<ScoreExplanation | null>(null);
    const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

    // polish #14 — Escape closes the open popover. The underlying
    // Popover primitive registers Escape on its content layer, but
    // when focus is still on the trigger button (the common case for
    // a click-open) the event never reaches the layer. Route through
    // the shared Epic 57 registry — single window listener, scoped to
    // 'overlay' so a parent modal's Escape can still outrank ours.
    useKeyboardShortcut(['Escape'], () => setOpen(false), {
        enabled: open,
        scope: 'overlay',
        description: 'Close the risk score explainer',
    });

    // RQ3-OB-B — load fn is hoisted so the Retry affordance can
    // call it without re-triggering open-change semantics.
    const loadExplanation = () => {
        setState('loading');
        fetch(`/api/t/${tenantSlug}/risks/${riskId}/score-explanation`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
            .then((d) => {
                setData(d);
                setState('idle');
            })
            .catch(() => setState('error'));
    };

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next && !data && state !== 'loading') {
            loadExplanation();
        }
    };

    return (
        <Popover
            openPopover={open}
            setOpenPopover={onOpenChange}
            align="start"
            content={
                <div
                    className="w-80 max-w-[90vw] p-3 text-xs space-y-default"
                    id={`score-explainer-${riskId}`}
                    role="region"
                    aria-label={t('scoreExplanation')}
                >
                    {state === 'loading' && (
                        <p className="text-content-muted">{t('loading')}</p>
                    )}
                    {state === 'error' && (
                        <div className="space-y-tight" data-testid="score-explainer-error">
                            <p className="text-content-muted">{t('loadError')}</p>
                            <button
                                type="button"
                                onClick={loadExplanation}
                                className="text-content-emphasis underline hover:text-content-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                data-testid="score-explainer-retry"
                            >
                                {t('retry')}
                            </button>
                        </div>
                    )}
                    {data && (
                        <>
                            {/* Formula in the tenant's language */}
                            <div>
                                <p className="font-medium text-content-emphasis">
                                    {t('inherent', { score: data.inherent.score })}
                                    {data.inherent.bandName ? ` · ${data.inherent.bandName}` : ''}
                                </p>
                                <p className="text-content-muted">
                                    {data.inherent.likelihoodLabel ?? t('likelihood', { value: data.inherent.likelihood })}
                                    {' × '}
                                    {data.inherent.impactLabel ?? t('impact', { value: data.inherent.impact })}
                                    {` = ${data.inherent.likelihood} × ${data.inherent.impact}`}
                                </p>
                            </div>

                            {/* Residual */}
                            {data.residual && (
                                <div>
                                    <p className="font-medium text-content-emphasis">
                                        {t('residual', { score: data.residual.score ?? '' })}
                                        {data.residual.bandName ? ` · ${data.residual.bandName}` : ''}
                                    </p>
                                    {data.residual.legacyUndecomposed && (
                                        <p className="text-content-muted">
                                            {t('legacyFormula')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Control derivation */}
                            <div>
                                <p className="font-medium text-content-emphasis">{t('controls')}</p>
                                <p className="text-content-muted">{data.controls.summary}</p>
                                {data.controls.suggestedScore !== null &&
                                    data.controls.suggestedScore !== data.residual?.score && (
                                        <p className="text-content-muted">
                                            {t('suggestsResidual', { score: data.controls.suggestedScore })}
                                        </p>
                                    )}
                            </div>

                            {/* Quant line */}
                            {data.quant && (
                                <p className="text-content-muted">{data.quant.line}</p>
                            )}

                            {/* Appetite breaches */}
                            {data.openBreaches.length > 0 && (
                                <p className="text-content-emphasis">
                                    {t('appetiteBreaches', { count: data.openBreaches.length })}
                                </p>
                            )}

                            {/* Provenance trail */}
                            {data.recentEvents.length > 0 && (
                                <div>
                                    <p className="font-medium text-content-emphasis">{t('recentChanges')}</p>
                                    <ul className="space-y-tight">
                                        {data.recentEvents.map((e, i) => (
                                            <li key={i} className="text-content-muted">
                                                {e.kind === 'INHERENT' ? t('inherentLabel') : t('residualLabel')} → {e.score}{' '}
                                                ({describeProvenance(t, e.source, e.actorName)})
                                                {' · '}
                                                {formatDateTime(e.createdAt)}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            }
        >
            <button
                type="button"
                className="cursor-help bg-transparent border-0 p-0 text-inherit"
                aria-label={label ? t('explainLabelled', { label }) : t('explain')}
            >
                {children}
            </button>
        </Popover>
    );
}
