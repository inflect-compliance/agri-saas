'use client';

/**
 * RQ-1 / RQ3-2 — FAIR Analysis panel on the risk detail page.
 *
 * Range-first estimation (RQ3-2): every loss/frequency factor is a
 * calibrated min/likely/max interval — "give the range you're 90%
 * sure contains the true value" — replacing the false-precision
 * point-float ritual. The derived point estimate (Beta-PERT mean) is
 * SHOWN per factor, never asked. Legacy point values load as
 * degenerate triples (min = likely = max), so the round-trip is
 * backward compatible; saving writes the five PERT triples to
 * `fairInputsJson` (the simulator's preferred input) and the server
 * derives the point columns + LEF/ALE from the PERT means.
 *
 * Calibration aids (RQ2-7, extended to ranges): live reflections
 * mirror the likely value and call out wide spreads; warnings
 * (`validateFairTriples` + `validatePertTriple`) stay warn-only —
 * they NEVER disable the save button.
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Heading } from '@/components/ui/typography';
import { useTenantApiUrl, useMoneyFormatter } from '@/lib/tenant-context-provider';
import {
    computeTEF,
    computeVulnerability,
    computeLEF,
    computePLM,
    computeFairALE,
    pertMean,
} from '@/app-layer/usecases/fair-calculator';
import {
    reflectTriple,
    validateFairTriples,
    getCategoryPrior,
    FAIR_FACTOR_KEYS,
    FAIR_FACTOR_LABELS,
    type FairFactorKey,
    type TripleDraft,
} from '@/lib/fair-calibration';

type Conf = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FairInitial {
    threatEventFrequency: number | null;
    contactFrequency: number | null;
    probabilityOfAction: number | null;
    vulnerabilityProbability: number | null;
    threatCapability: number | null;
    controlStrength: number | null;
    primaryLossMagnitude: number | null;
    productivityLoss: number | null;
    responseCost: number | null;
    replacementCost: number | null;
    secondaryLossEventFrequency: number | null;
    secondaryLossMagnitude: number | null;
    fairConfidence: Conf | null;
    /** RQ3-2 — stored PERT triples; preferred over the point columns. */
    fairInputsJson?: Record<string, unknown> | null;
}

type Bound = 'min' | 'mode' | 'max';
type Triples = Record<FairFactorKey, TripleDraft>;

const EMPTY: TripleDraft = { min: null, mode: null, max: null };
const N = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const complete = (t: TripleDraft): t is { min: number; mode: number; max: number } =>
    t.min != null && t.mode != null && t.max != null;

/** Parse one stored triple from fairInputsJson, if well-formed. */
function parseStoredTriple(json: Record<string, unknown> | null | undefined, key: FairFactorKey): TripleDraft | null {
    const raw = json?.[key];
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as Record<string, unknown>;
    if (typeof t.min !== 'number' || typeof t.mode !== 'number' || typeof t.max !== 'number') return null;
    return { min: t.min, mode: t.mode, max: t.max };
}

/**
 * RQ3-2 — backward-compatible seeding: stored triples win; otherwise
 * legacy point values (including the sub-factor derivations the
 * point-era panel offered: CF×P(action) → TEF, capability vs control
 * → vulnerability, cost components → PLM) migrate as DEGENERATE
 * triples (min = likely = max) the user then widens.
 */
export function seedTriples(initial: FairInitial): Triples {
    const json = initial.fairInputsJson ?? null;
    const degenerate = (v: number | null): TripleDraft =>
        v == null ? { ...EMPTY } : { min: v, mode: v, max: v };

    const tefPoint =
        initial.threatEventFrequency ??
        (initial.contactFrequency != null && initial.probabilityOfAction != null
            ? computeTEF(initial.contactFrequency, initial.probabilityOfAction)
            : null);
    const vulnPoint =
        initial.vulnerabilityProbability ??
        (initial.threatCapability != null && initial.controlStrength != null
            ? computeVulnerability(initial.threatCapability, initial.controlStrength)
            : null);
    const hasPlm =
        initial.primaryLossMagnitude != null ||
        initial.productivityLoss != null ||
        initial.responseCost != null ||
        initial.replacementCost != null;
    const plmPoint = hasPlm
        ? computePLM({
              productivityLoss: initial.productivityLoss,
              responseCost: initial.responseCost,
              replacementCost: initial.replacementCost,
              flatEstimate: initial.primaryLossMagnitude,
          })
        : null;

    return {
        tef: parseStoredTriple(json, 'tef') ?? degenerate(tefPoint),
        vulnerability: parseStoredTriple(json, 'vulnerability') ?? degenerate(vulnPoint),
        plm: parseStoredTriple(json, 'plm') ?? degenerate(plmPoint),
        slef: parseStoredTriple(json, 'slef') ?? degenerate(initial.secondaryLossEventFrequency),
        slm: parseStoredTriple(json, 'slm') ?? degenerate(initial.secondaryLossMagnitude),
    };
}

export function FairAnalysisPanel({
    riskId,
    initial,
    category = null,
}: {
    riskId: string;
    initial: FairInitial;
    /** RQ2-7 — drives the per-category calibration prior hints. */
    category?: string | null;
}) {
    const tf = useTranslations('riskFair');
    const apiUrl = useTenantApiUrl();
    const money = useMoneyFormatter();
    const [triples, setTriples] = useState<Triples>(() => seedTriples(initial));
    const [conf, setConf] = useState<Conf | null>(initial.fairConfidence);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const set = (k: FairFactorKey, b: Bound) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setTriples((cur) => ({ ...cur, [k]: { ...cur[k], [b]: N(e.target.value) } }));

    // Live derived values — PERT means feed the same pure formulas the
    // server recomputes on save. "Shown, not asked."
    const derived = useMemo(() => {
        const mean = (t: TripleDraft) => (complete(t) ? pertMean(t) : null);
        const tef = mean(triples.tef);
        const vuln = mean(triples.vulnerability);
        const plm = mean(triples.plm);
        const slef = mean(triples.slef);
        const slm = mean(triples.slm);
        const lef = tef != null && vuln != null ? computeLEF(tef, clamp01(vuln)) : null;
        const ale =
            tef != null && vuln != null && plm != null
                ? computeFairALE({ tef, vulnerability: clamp01(vuln), plm, slef: clamp01(slef ?? 0), slm: slm ?? 0 })
                : null;
        return { means: { tef, vulnerability: vuln, plm, slef, slm }, lef, ale };
    }, [triples]);

    const save = useCallback(async () => {
        setSaving(true);
        setMsg(null);
        try {
            const distributions = Object.fromEntries(
                FAIR_FACTOR_KEYS.map((k) => [k, complete(triples[k]) ? triples[k] : null]),
            );
            const res = await fetch(apiUrl(`/risks/${riskId}/fair`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ distributions, fairConfidence: conf }),
            });
            setMsg(res.ok ? tf('rangesSaved') : tf('saveFailed'));
        } catch {
            setMsg(tf('saveFailedNetwork'));
        } finally {
            setSaving(false);
        }
    }, [apiUrl, riskId, triples, conf, tf]);

    // RQ2-7 → RQ3-2 — warn-only range checks + category anchors.
    const warnings = useMemo(() => validateFairTriples(triples), [triples]);
    const prior = getCategoryPrior(category);

    const FACTOR_META: Record<FairFactorKey, { unit: string; isMoney: boolean; ghost?: string | null }> = {
        tef: { unit: '/yr', isMoney: false, ghost: prior?.tefHint },
        vulnerability: { unit: '0–1', isMoney: false },
        plm: { unit: 'per event', isMoney: true, ghost: prior?.lossHint },
        slef: { unit: '0–1', isMoney: false },
        slm: { unit: 'per event', isMoney: true },
    };

    const bound = (k: FairFactorKey, b: Bound, label: string) => (
        <label className="block flex-1 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-content-subtle">{label}</span>
            <Input
                type="text"
                inputMode="decimal"
                value={triples[k][b] ?? ''}
                onChange={set(k, b)}
                data-testid={`fair-triple-${k}-${b}`}
            />
        </label>
    );

    const factorGroup = (k: FairFactorKey) => {
        const meta = FACTOR_META[k];
        const reflection = reflectTriple(k, triples[k]);
        const mean = derived.means[k];
        return (
            <div key={k} className="space-y-tight rounded-md border border-border-subtle p-3">
                <div className="flex items-baseline justify-between gap-default">
                    <p className="text-xs font-medium text-content-emphasis">
                        {FAIR_FACTOR_LABELS[k]} <span className="font-normal text-content-subtle">({meta.unit})</span>
                    </p>
                    {/* RQ3-2 — the point estimate is derived (PERT
                        mean), shown, never asked. */}
                    {mean != null && (
                        <span className="text-[10px] tabular-nums text-content-subtle" data-testid={`fair-derived-${k}`}>
                            {tf('derived', { value: meta.isMoney ? money(mean) : Math.round(mean * 1000) / 1000 })}
                        </span>
                    )}
                </div>
                {meta.ghost && (
                    <p className="text-[10px] italic text-content-subtle" data-testid="fair-prior-hint">
                        {meta.ghost}
                    </p>
                )}
                <div className="flex gap-tight">
                    {bound(k, 'min', tf('min'))}
                    {bound(k, 'mode', tf('likely'))}
                    {bound(k, 'max', tf('max'))}
                </div>
                {reflection && (
                    <span className="block text-[10px] text-content-subtle" data-testid={`fair-reflection-${k}`}>
                        {reflection}
                    </span>
                )}
            </div>
        );
    };

    return (
        <Card className="space-y-default p-6">
            <Heading level={3}>{tf('title')}</Heading>
            <p className="text-sm text-content-muted">
                {tf('intro')}
            </p>

            <div className="grid grid-cols-1 gap-default md:grid-cols-2">
                {FAIR_FACTOR_KEYS.map((k) => factorGroup(k))}
            </div>

            <div className="flex flex-wrap items-center gap-default">
                <span className="text-xs text-content-muted">{tf('confidence')}</span>
                {(['LOW', 'MEDIUM', 'HIGH'] as Conf[]).map((c) => (
                    <Button key={c} size="sm" variant={conf === c ? 'secondary' : 'ghost'} onClick={() => setConf(c)}>
                        {c}
                    </Button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-default rounded-md border border-border-default bg-bg-subtle p-3 text-sm">
                <span>{tf('lef')} <span className="font-semibold tabular-nums">{derived.lef != null ? `${derived.lef.toFixed(2)}/yr` : '—'}</span></span>
                <span className="ml-auto">{tf('fairAle')} <span className="font-semibold tabular-nums text-content-emphasis">{derived.ale != null ? `${money(derived.ale)}/yr` : '—'}</span></span>
            </div>

            {/* RQ2-7 — reasonableness warnings. Advisory by contract:
                they never disable the save button. */}
            {warnings.length > 0 && (
                <InlineNotice variant="warning" data-testid="fair-calibration-warnings">
                    <ul className="list-disc pl-4">
                        {warnings.map((w) => (
                            <li key={`${w.field}-${w.message}`}>{w.message}</li>
                        ))}
                    </ul>
                </InlineNotice>
            )}

            {msg && <InlineNotice variant={msg === tf('rangesSaved') ? 'success' : 'error'}>{msg}</InlineNotice>}
            <div className="flex justify-end">
                <Button variant="primary" onClick={save} disabled={saving}>{saving ? tf('saving') : tf('saveRanges')}</Button>
            </div>
        </Card>
    );
}
