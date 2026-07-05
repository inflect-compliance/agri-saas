'use client';

/**
 * RQ2-4 — guided qualitative assessment: inherent → controls →
 * residual, in the tenant's own matrix language.
 *
 * The pre-RQ2 flow buried likelihood/impact in an edit modal and
 * left residual to a divisor formula. This panel makes assessment a
 * first-class surface:
 *
 *   Step 1 — Inherent. L/I steppers labelled with the tenant's
 *     `RiskMatrixConfig.levelLabels`; the band chip updates live so
 *     the assessor sees the consequence of each click before saving.
 *   Step 2 — Controls. The RQ2-2 contribution breakdown: which
 *     linked controls participate (MEASURED beats DECLARED), which
 *     are excluded and why — the data-quality nudge stays visible.
 *   Step 3 — Residual. Asserted vs control-suggested side by side.
 *     Accept recomputes SERVER-side (the POST body carries only a
 *     justification); manual override sends decomposed dims + a
 *     justification and the server derives the rollup (RQ2-1).
 *
 * The "Quantify this risk" bridge hands over to the FAIR tab — one
 * narrative, two depths; nothing here duplicates the quant inputs.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useToast } from '@/components/ui/hooks';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { Eyebrow, Heading } from '@/components/ui/typography';
import { SkeletonCard } from '@/components/ui/skeleton';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { calculateRiskScore } from '@/lib/risk-scoring';
import { resolveBandForScore } from '@/lib/risk-matrix/scoring';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import type { ResidualSuggestionPayload } from '@/app-layer/usecases/risk-residual-suggestion';

export interface AssessmentRisk {
    likelihood: number;
    impact: number;
    inherentScore: number;
    residualLikelihood: number | null;
    residualImpact: number | null;
    residualScore: number | null;
    /**
     * RQ3-OB-D — drives the adaptive bridge copy. When the risk
     * already carries a FAIR-derived ALE, "Quantify this risk →"
     * reads wrong (the work is done); the bridge becomes "Review the
     * FAIR analysis →". Null/undefined → not yet quantified.
     */
    fairAle?: number | null;
}

function BandChip({ score, config }: { score: number; config: RiskMatrixConfigShape }) {
    const band = resolveBandForScore(score, config.bands);
    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-bold tabular-nums text-content-emphasis"
            style={{ backgroundColor: `${band.color}33` }}
            data-band={band.name}
        >
            <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: band.color }}
            />
            {score} · {band.name}
        </span>
    );
}

function levelLabel(config: RiskMatrixConfigShape, axis: 'likelihood' | 'impact', level: number): string {
    const label = config.levelLabels?.[axis]?.[level - 1];
    return label ? `${level} — ${label}` : String(level);
}

export function RiskAssessmentPanel({
    riskId,
    risk,
    canWrite,
    onRiskUpdated,
    onQuantify,
    onLinkControls,
}: {
    riskId: string;
    risk: AssessmentRisk;
    canWrite: boolean;
    /** Parent refetches the risk after any save here. */
    onRiskUpdated: () => void;
    /** Bridge to the Quantification (FAIR) tab. */
    onQuantify: () => void;
    /** Bridge to the Traceability tab (where controls are linked). */
    onLinkControls: () => void;
}) {
    const ta = useTranslations('riskAssessment');
    const apiUrl = useTenantApiUrl();
    const toast = useToast();

    const [config, setConfig] = useState<RiskMatrixConfigShape | null>(null);
    const [suggestion, setSuggestion] = useState<ResidualSuggestionPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    // RQ3-7 — currently-breached KRIs for this risk. Drives the
    // re-assess nudge: a sensor fired, the conclusion should catch
    // up. Failure-soft — a failed load just hides the nudge.
    const [kriBreaches, setKriBreaches] = useState<Array<{ kriId: string; name: string; value: number }>>([]);

    // Step 1 draft state.
    const [likelihood, setLikelihood] = useState(risk.likelihood);
    const [impact, setImpact] = useState(risk.impact);
    const [savingInherent, setSavingInherent] = useState(false);

    // Step 3 draft state.
    const [residualLikelihood, setResidualLikelihood] = useState(risk.residualLikelihood ?? risk.likelihood);
    const [residualImpact, setResidualImpact] = useState(risk.residualImpact ?? risk.impact);
    const [justification, setJustification] = useState('');
    const [overriding, setOverriding] = useState(false);
    const [savingResidual, setSavingResidual] = useState(false);
    const [accepting, setAccepting] = useState(false);
    // polish #15 — when inherent saves while a manual residual draft
    // is open, the draft now applies to a DIFFERENT inherent
    // baseline. The user gets an in-line warning until they save or
    // cancel the draft; silently rebasing would corrupt the
    // conclusion. State lives above the early-returns to keep the
    // hook order stable across loading/loaded transitions.
    const [residualBaselineDirty, setResidualBaselineDirty] = useState(false);

    const loadSuggestion = useCallback(async () => {
        const res = await fetch(apiUrl(`/risks/${riskId}/residual-suggestion`));
        if (!res.ok) throw new Error(`Failed to load control derivation (${res.status})`);
        setSuggestion(await res.json());
    }, [apiUrl, riskId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [configRes] = await Promise.all([
                    fetch(apiUrl('/risk-matrix-config')),
                    loadSuggestion(),
                ]);
                if (!configRes.ok) throw new Error(`Failed to load matrix config (${configRes.status})`);
                const cfg = await configRes.json();
                if (!cancelled) setConfig(cfg);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : ta('failedLoad'));
            }
        })();
        return () => { cancelled = true; };
    }, [apiUrl, loadSuggestion]);

    // RQ3-7 — load the KRI breach signal independently (failure-soft:
    // never blocks the panel, just hides the nudge on error).
    useEffect(() => {
        let cancelled = false;
        fetch(apiUrl(`/risks/${riskId}/kri-breaches`))
            .then((r) => (r.ok ? r.json() : null))
            // eslint-disable-next-line react-hooks/set-state-in-effect
            .then((d) => { if (!cancelled) setKriBreaches(d?.breaches ?? []); })
            .catch(() => { if (!cancelled) setKriBreaches([]); });
        return () => { cancelled = true; };
    }, [apiUrl, riskId]);

    if (error) {
        return <div className={cn(cardVariants({ density: 'compact' }), 'border-border-error text-content-error text-sm')}>{error}</div>;
    }
    if (!config || !suggestion) {
        return <SkeletonCard lines={4} />;
    }

    const maxScale = Math.max(config.likelihoodLevels, config.impactLevels);
    const draftInherentScore = calculateRiskScore(likelihood, impact, maxScale);
    const inherentDirty = likelihood !== risk.likelihood || impact !== risk.impact;
    const draftResidualScore = calculateRiskScore(residualLikelihood, residualImpact, maxScale);

    const saveInherent = async () => {
        setSavingInherent(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/risks/${riskId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ likelihood, impact }),
            });
            if (!res.ok) throw new Error(`Failed to save assessment (${res.status})`);
            if (overriding) setResidualBaselineDirty(true);
            onRiskUpdated();
            await loadSuggestion();
        } catch (err) {
            setError(err instanceof Error ? err.message : ta('failedSave'));
        } finally {
            setSavingInherent(false);
        }
    };

    const acceptSuggestion = async () => {
        setAccepting(true);
        setError(null);
        try {
            // Body carries ONLY the justification — values are
            // recomputed server-side (RQ2-2 contract).
            const res = await fetch(apiUrl(`/risks/${riskId}/residual-suggestion`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ justification: justification || null }),
            });
            if (!res.ok) throw new Error(`Failed to accept suggestion (${res.status})`);
            // RQ3-OB-D — "accepting deserves an answer". The success
            // toast carries the SERVER-derived one-liner (composed in
            // acceptResidualSuggestion from the recomputed values), so
            // the message reflects exactly what was persisted — never
            // client draft state, which could disagree.
            const body = await res.json().catch(() => null);
            const summary: string | undefined = body?.accepted?.summary;
            toast.success(summary ?? ta('acceptedFallback'));
            onRiskUpdated();
            await loadSuggestion();
        } catch (err) {
            setError(err instanceof Error ? err.message : ta('failedAccept'));
        } finally {
            setAccepting(false);
        }
    };

    const saveResidualOverride = async () => {
        setSavingResidual(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/risks/${riskId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    residualLikelihood,
                    residualImpact,
                    scoreJustification: justification || null,
                }),
            });
            if (!res.ok) throw new Error(`Failed to save residual (${res.status})`);
            setOverriding(false);
            setResidualBaselineDirty(false);
            onRiskUpdated();
            await loadSuggestion();
        } catch (err) {
            setError(err instanceof Error ? err.message : ta('failedSave'));
        } finally {
            setSavingResidual(false);
        }
    };

    const participating = suggestion.combined.contributions.filter((c) => c.affects !== null);
    const excluded = suggestion.combined.contributions.filter((c) => c.affects === null);

    return (
        <div className="space-y-section" id="risk-assessment-panel">
            {/* RQ3-7 — re-assess nudge. A linked KRI's latest reading
                sits in RED: the sensor moved, the conclusion should
                catch up. Closes the KRI ⇄ assessment loop — sensors
                that change no conclusion are decoration. Disappears
                automatically once the KRI recovers (latest reading no
                longer RED). */}
            {kriBreaches.length > 0 && (
                <div
                    className="rounded-md border border-border-warning bg-bg-warning/15 p-3 text-sm text-content-warning"
                    data-testid="kri-reassess-nudge"
                >
                    <p className="font-medium">
                        {kriBreaches.length === 1
                            ? ta('kriBreachedOne', { name: kriBreaches[0].name })
                            : ta('kriBreachedMany', { count: kriBreaches.length })}
                    </p>
                    <p className="mt-0.5 text-content-muted">
                        {ta('kriNudge')}
                    </p>
                </div>
            )}

            {/* ── Step 1 — Inherent ─────────────────────────────── */}
            <div className={cn(cardVariants(), 'space-y-default')}>
                <div className="flex items-center justify-between">
                    <Heading level={3}>{ta('inherentStep')}</Heading>
                    <BandChip score={draftInherentScore} config={config} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                    <div>
                        <Eyebrow>{config.axisLikelihoodLabel || ta('likelihood')}</Eyebrow>
                        <NumberStepper
                            id="assessment-likelihood"
                            value={likelihood}
                            onChange={setLikelihood}
                            min={1}
                            max={config.likelihoodLevels}
                            disabled={!canWrite}
                            ariaLabel={ta('likelihoodLevel')}
                            formatValue={(v) => levelLabel(config, 'likelihood', v)}
                        />
                    </div>
                    <div>
                        <Eyebrow>{config.axisImpactLabel || ta('impact')}</Eyebrow>
                        <NumberStepper
                            id="assessment-impact"
                            value={impact}
                            onChange={setImpact}
                            min={1}
                            max={config.impactLevels}
                            disabled={!canWrite}
                            ariaLabel={ta('impactLevel')}
                            formatValue={(v) => levelLabel(config, 'impact', v)}
                        />
                    </div>
                </div>
                {canWrite && inherentDirty && (
                    <div className="flex justify-end">
                        <Button
                            variant="secondary"
                            id="save-inherent-btn"
                            onClick={saveInherent}
                            disabled={savingInherent}
                        >
                            {savingInherent ? ta('saving') : ta('saveAssessment')}
                        </Button>
                    </div>
                )}
            </div>

            {/* ── Step 2 — Controls ─────────────────────────────── */}
            <div className={cn(cardVariants(), 'space-y-default')} id="assessment-controls">
                <Heading level={3}>{ta('controlsStep')}</Heading>
                <p className="text-sm text-content-muted">{suggestion.summary}</p>
                {participating.length > 0 && (
                    <ul className="space-y-tight">
                        {participating.map((c) => (
                            <li key={c.controlId} className="flex items-center gap-tight text-sm">
                                <span className="text-content-default">
                                    {c.code ? `${c.code} — ` : ''}{c.name}
                                </span>
                                <span className="text-content-muted">
                                    {ta('effectiveReduces', {
                                        effectiveness: c.effectiveness ?? 0,
                                        source: c.source === 'MEASURED' ? ta('measuredFromTests') : ta('declared'),
                                        axis: c.affects === 'LIKELIHOOD' ? ta('axisLikelihood') : ta('axisImpact'),
                                    })}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {excluded.length > 0 && (
                    <div className="text-xs text-content-muted">
                        <Eyebrow>{ta('notParticipating')}</Eyebrow>
                        <ul className="space-y-tight">
                            {excluded.map((c) => (
                                <li key={c.controlId}>
                                    {c.code ? `${c.code} — ` : ''}{c.name}:{' '}
                                    {c.excludedReason === 'NO_EFFECTIVENESS'
                                        ? ta('noEffectivenessSignal')
                                        : ta('noMitigationType')}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {suggestion.combined.contributions.length === 0 && (
                    <p className="text-sm text-content-muted">
                        {ta('noControlsLinked')}{' '}
                        <button
                            type="button"
                            className="underline text-content-default"
                            onClick={onLinkControls}
                            id="assessment-link-controls"
                        >
                            {ta('linkControlsInTraceability')}
                        </button>
                        {' '}{ta('toDeriveResidual')}
                    </p>
                )}
            </div>

            {/* ── Step 3 — Residual ─────────────────────────────── */}
            <div className={cn(cardVariants(), 'space-y-default')} id="assessment-residual">
                <Heading level={3}>{ta('residualStep')}</Heading>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                    <div className={cn(cardVariants({ density: 'compact' }), 'space-y-tight')}>
                        <Eyebrow>{ta('currentAsserted')}</Eyebrow>
                        {risk.residualScore !== null ? (
                            <>
                                <BandChip score={risk.residualScore} config={config} />
                                <p className="text-xs text-content-muted">
                                    {risk.residualLikelihood !== null && risk.residualImpact !== null
                                        ? `${levelLabel(config, 'likelihood', risk.residualLikelihood)} × ${levelLabel(config, 'impact', risk.residualImpact)}`
                                        : ta('legacyFormula')}
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-content-muted">{ta('notAssessed')}</p>
                        )}
                    </div>
                    <div className={cn(cardVariants({ density: 'compact' }), 'space-y-tight')}>
                        <Eyebrow>{ta('suggestedFromControls')}</Eyebrow>
                        {suggestion.suggestion ? (
                            <>
                                <BandChip score={suggestion.suggestion.residualScore} config={config} />
                                <p className="text-xs text-content-muted">
                                    {levelLabel(config, 'likelihood', suggestion.suggestion.residualLikelihood)} ×{' '}
                                    {levelLabel(config, 'impact', suggestion.suggestion.residualImpact)}
                                </p>
                                {canWrite && (
                                    <Button
                                        variant="secondary"
                                        id="accept-suggestion-btn"
                                        onClick={acceptSuggestion}
                                        disabled={accepting}
                                    >
                                        {accepting ? ta('accepting') : ta('acceptSuggestion')}
                                    </Button>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-content-muted">
                                {ta('noDerivableResidual')}
                            </p>
                        )}
                    </div>
                </div>

                {canWrite && !overriding && (
                    <Button variant="secondary" id="override-residual-btn" onClick={() => setOverriding(true)}>
                        {ta('assessResidualManually')}
                    </Button>
                )}
                {canWrite && overriding && (
                    <div className="space-y-default border-t border-border-subtle pt-4">
                        {residualBaselineDirty && (
                            <div
                                className="rounded-md border border-border-warning bg-bg-warning/20 p-2 text-xs text-content-warning"
                                data-testid="residual-baseline-warning"
                            >
                                {ta('residualBaselineWarning', { likelihood: risk.likelihood, impact: risk.impact })}
                            </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                            <div>
                                <Eyebrow>{ta('residualLikelihood', { label: config.axisLikelihoodLabel || ta('axisLikelihood') })}</Eyebrow>
                                <NumberStepper
                                    id="residual-likelihood"
                                    value={residualLikelihood}
                                    onChange={setResidualLikelihood}
                                    min={1}
                                    max={config.likelihoodLevels}
                                    ariaLabel={ta('residualLikelihoodLevel')}
                                    formatValue={(v) => levelLabel(config, 'likelihood', v)}
                                />
                            </div>
                            <div>
                                <Eyebrow>{ta('residualLikelihood', { label: config.axisImpactLabel || ta('axisImpact') })}</Eyebrow>
                                <NumberStepper
                                    id="residual-impact"
                                    value={residualImpact}
                                    onChange={setResidualImpact}
                                    min={1}
                                    max={config.impactLevels}
                                    ariaLabel={ta('residualImpactLevel')}
                                    formatValue={(v) => levelLabel(config, 'impact', v)}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-tight text-sm">
                            <span className="text-content-muted">{ta('resultingScore')}</span>
                            <BandChip score={draftResidualScore} config={config} />
                        </div>
                        <FormField label={ta('justification')}>
                            <Input
                                id="residual-justification"
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                placeholder={ta('justificationPlaceholder')}
                                maxLength={2000}
                            />
                        </FormField>
                        <div className="flex gap-tight justify-end">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setOverriding(false);
                                    setResidualBaselineDirty(false);
                                }}
                            >
                                {ta('cancel')}
                            </Button>
                            <Button
                                variant="secondary"
                                id="save-residual-btn"
                                onClick={saveResidualOverride}
                                disabled={savingResidual}
                            >
                                {savingResidual ? ta('saving') : ta('saveResidual')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Quantify bridge ───────────────────────────────── */}
            {/* RQ3-OB-D — the bridge knows where you've been. When a
                FAIR ALE already exists, "Quantify this risk →" is the
                wrong invitation (the work is done) — the copy adapts
                to "Review the FAIR analysis →" and the helper text
                follows. The callback is the same; only the framing
                changes. */}
            <div
                className={cn(cardVariants({ density: 'compact' }), 'flex items-center justify-between')}
                data-testid="quantify-bridge"
                data-quantified={risk.fairAle != null ? 'true' : 'false'}
            >
                <p className="text-sm text-content-muted">
                    {risk.fairAle != null
                        ? ta('bridgeQuantified')
                        : ta('bridgeUnquantified')}
                </p>
                <Button variant="secondary" id="quantify-bridge-btn" onClick={onQuantify}>
                    {risk.fairAle != null ? ta('reviewFair') : ta('quantifyThis')}
                </Button>
            </div>
        </div>
    );
}
