'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic G-3 — internal reviewer page.
 *
 * Side-by-side view of every question + submitted answer + auto
 * computed points + reviewer override + per-answer reviewer note.
 * Surfaces the live engine output (mode, sums, suggested rating)
 * so the reviewer sees "what would the score be" before saving.
 *
 * Status-aware:
 *   • SUBMITTED                    — full edit UI, Save Review action
 *   • REVIEWED                     — read-only with final rating + Close action
 *   • CLOSED                       — read-only terminal
 *   • DRAFT / SENT / IN_PROGRESS   — "not yet submitted" placeholder
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    useTenantApiUrl,
    useTenantHref,
    useTenantContext,
} from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { SkeletonDetailPage } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format-date';

interface Question {
    id: string;
    sectionId: string;
    sortOrder: number;
    prompt: string;
    answerType:
        | 'YES_NO'
        | 'SINGLE_SELECT'
        | 'MULTI_SELECT'
        | 'TEXT'
        | 'NUMBER'
        | 'SCALE'
        | 'FILE_UPLOAD';
    required: boolean;
    weight: number;
    optionsJson: unknown;
    scaleConfigJson: unknown;
}
interface Section {
    id: string;
    title: string;
    description: string | null;
    questions: Question[];
}
interface Answer {
    questionId: string;
    answerJson: unknown;
    computedPoints: number;
    reviewerOverridePoints: number | null;
    reviewerNotes: string | null;
}
interface ReviewView {
    assessmentId: string;
    status: string;
    vendor: { id: string; name: string };
    template: {
        id: string;
        key: string;
        version: number;
        name: string;
        description: string | null;
    };
    sections: Section[];
    answers: Answer[];
    scoring: {
        mode: string;
        score: number;
        autoSum: number;
        effectiveSum: number;
        totalWeight: number;
        verdict?: 'PASS' | 'FAIL';
        suggestedRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
    };
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewerNotes: string | null;
    riskRating: string | null;
    closedAt: string | null;
}

const RATING_OPTIONS: ComboboxOption[] = [
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
    { value: 'HIGH', label: 'HIGH' },
    { value: 'CRITICAL', label: 'CRITICAL' },
];

const STATUS_BADGE: Record<string, string> = {
    DRAFT: 'badge-neutral',
    SENT: 'badge-info',
    IN_PROGRESS: 'badge-info',
    SUBMITTED: 'badge-warning',
    REVIEWED: 'badge-success',
    CLOSED: 'badge-neutral',
};

export function VendorAssessmentReviewClient({
    assessmentId,
}: {
    assessmentId: string;
}) {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();

    const [view, setView] = useState<ReviewView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Local edit state, keyed off the answers from the server.
    const [overrides, setOverrides] = useState<
        Record<string, { points: number | null; notes: string | null }>
    >({});
    const [finalRating, setFinalRating] = useState<string | null>(null);
    const [reviewerNotes, setReviewerNotes] = useState('');

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(
                apiUrl(`/vendor-assessment-reviews/${assessmentId}`),
            );
            if (!res.ok) {
                setError(`Failed to load (${res.status})`);
                return;
            }
            const data = (await res.json()) as ReviewView;
            setView(data);
            // Seed local state.
            const seedOverrides: Record<
                string,
                { points: number | null; notes: string | null }
            > = {};
            for (const a of data.answers) {
                seedOverrides[a.questionId] = {
                    points: a.reviewerOverridePoints,
                    notes: a.reviewerNotes,
                };
            }
            setOverrides(seedOverrides);
            setFinalRating(data.riskRating);
            setReviewerNotes(data.reviewerNotes ?? '');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, assessmentId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh();
    }, [refresh]);

    const editable = useMemo(
        () => permissions.canAdmin && view?.status === 'SUBMITTED',
        [permissions.canAdmin, view?.status],
    );

    const closable = useMemo(
        () => permissions.canAdmin && view?.status === 'REVIEWED',
        [permissions.canAdmin, view?.status],
    );

    async function saveReview() {
        if (!view || !editable) return;
        setSaving(true);
        setError(null);
        try {
            // Build the overrides[] payload — only include rows the
            // reviewer actually touched relative to the loaded state.
            const initialMap = new Map(
                view.answers.map((a) => [
                    a.questionId,
                    {
                        points: a.reviewerOverridePoints,
                        notes: a.reviewerNotes,
                    },
                ]),
            );
            const dirtyOverrides: Array<{
                questionId: string;
                overridePoints?: number | null;
                reviewerNotes?: string | null;
            }> = [];
            for (const [qid, cur] of Object.entries(overrides)) {
                const orig = initialMap.get(qid) ?? {
                    points: null,
                    notes: null,
                };
                const pointsChanged = cur.points !== orig.points;
                const notesChanged = (cur.notes ?? null) !== (orig.notes ?? null);
                if (pointsChanged || notesChanged) {
                    dirtyOverrides.push({
                        questionId: qid,
                        ...(pointsChanged
                            ? { overridePoints: cur.points }
                            : {}),
                        ...(notesChanged
                            ? { reviewerNotes: cur.notes }
                            : {}),
                    });
                }
            }

            const res = await fetch(
                apiUrl(
                    `/vendor-assessment-reviews/${assessmentId}/review`,
                ),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        overrides: dirtyOverrides,
                        finalRiskRating:
                            finalRating === view.riskRating
                                ? undefined
                                : finalRating,
                        reviewerNotes: reviewerNotes,
                    }),
                },
            );
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                setError(b.error ?? `Save failed (${res.status})`);
                return;
            }
            await refresh();
        } finally {
            setSaving(false);
        }
    }

    async function closeOut() {
        if (!view || !closable) return;
        setSaving(true);
        try {
            const res = await fetch(
                apiUrl(`/vendor-assessment-reviews/${assessmentId}/close`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                },
            );
            if (!res.ok) {
                const b = await res.json().catch(() => ({}));
                setError(b.error ?? `Close failed (${res.status})`);
                return;
            }
            await refresh();
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <SkeletonDetailPage />;
    if (!view)
        return (
            <div className="p-12 text-center text-content-error">
                {error ?? 'Assessment not found'}
            </div>
        );

    const answerByQ = new Map(view.answers.map((a) => [a.questionId, a]));

    return (
        <div className="space-y-6 animate-fadeIn" data-testid="vendor-review-page">
            {/* Header */}
            <div>
                <Link
                    href={tenantHref(`/vendors/${view.vendor.id}`)}
                    className="text-content-muted text-xs hover:text-content-emphasis transition"
                >
                    ← Back to vendor
                </Link>
                <div className="flex items-start justify-between mt-1">
                    <div>
                        <p className="text-xs text-content-subtle">
                            {view.vendor.name}
                        </p>
                        <h1 className="text-2xl font-bold mt-0.5">
                            {view.template.name}
                        </h1>
                        <div className="flex items-center gap-2 mt-1 text-xs text-content-subtle">
                            <span>{view.template.key}</span>
                            <span>·</span>
                            <span>v{view.template.version}</span>
                            <span>·</span>
                            <span
                                className={`badge badge-xs ${STATUS_BADGE[view.status] ?? 'badge-neutral'}`}
                                data-testid="review-status-badge"
                            >
                                {view.status}
                            </span>
                            {view.submittedAt && (
                                <>
                                    <span>·</span>
                                    <span>
                                        Submitted {formatDate(view.submittedAt)}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <p
                    className="text-xs text-content-error"
                    role="alert"
                    data-testid="review-error"
                >
                    {error}
                </p>
            )}

            {/* Pre-submit placeholder */}
            {(view.status === 'DRAFT' ||
                view.status === 'SENT' ||
                view.status === 'IN_PROGRESS') && (
                <div
                    className="glass-card p-6"
                    data-testid="not-yet-submitted-state"
                >
                    <p className="text-sm text-content-emphasis">
                        Awaiting external respondent.
                    </p>
                    <p className="text-xs text-content-muted mt-1">
                        The vendor hasn&apos;t submitted yet. Review controls
                        unlock once the assessment moves to SUBMITTED.
                    </p>
                </div>
            )}

            {/* Scoring panel */}
            {(view.status === 'SUBMITTED' ||
                view.status === 'REVIEWED' ||
                view.status === 'CLOSED') && (
                <div
                    className="glass-card p-4 grid grid-cols-2 md:grid-cols-5 gap-4"
                    data-testid="scoring-panel"
                >
                    <Stat
                        label="Mode"
                        value={view.scoring.mode.replace(/_/g, ' ')}
                    />
                    <Stat label="Score" value={fmtNum(view.scoring.score)} />
                    <Stat
                        label="Auto sum"
                        value={fmtNum(view.scoring.autoSum)}
                    />
                    <Stat
                        label="Effective sum"
                        value={fmtNum(view.scoring.effectiveSum)}
                    />
                    {view.scoring.verdict ? (
                        <Stat
                            label="Verdict"
                            value={view.scoring.verdict}
                            tone={
                                view.scoring.verdict === 'PASS'
                                    ? 'success'
                                    : 'danger'
                            }
                        />
                    ) : (
                        <Stat
                            label="Suggested rating"
                            value={view.scoring.suggestedRating ?? '—'}
                        />
                    )}
                </div>
            )}

            {/* Side-by-side question rows */}
            {(view.status === 'SUBMITTED' ||
                view.status === 'REVIEWED' ||
                view.status === 'CLOSED') &&
                view.sections.map((s) => (
                    <div
                        key={s.id}
                        className="glass-card p-4"
                        data-testid={`section-${s.id}`}
                    >
                        <h2 className="text-base font-semibold mb-3">
                            {s.title}
                        </h2>
                        <div className="space-y-3">
                            {s.questions.map((q) => {
                                const a = answerByQ.get(q.id);
                                const ov = overrides[q.id] ?? {
                                    points: null,
                                    notes: null,
                                };
                                return (
                                    <div
                                        key={q.id}
                                        className="border-t border-border-default/30 pt-3 grid grid-cols-1 md:grid-cols-12 gap-3"
                                        data-testid={`review-row-${q.id}`}
                                    >
                                        <div className="md:col-span-5">
                                            <p className="text-sm text-content-emphasis">
                                                {q.prompt}
                                            </p>
                                            <p className="text-xs text-content-subtle mt-1">
                                                <span className="badge badge-xs badge-info">
                                                    {q.answerType}
                                                </span>{' '}
                                                {q.required && (
                                                    <span className="badge badge-xs badge-warning">
                                                        required
                                                    </span>
                                                )}{' '}
                                                <span>w={q.weight}</span>
                                            </p>
                                        </div>
                                        <div
                                            className="md:col-span-3 text-sm"
                                            data-testid={`review-answer-${q.id}`}
                                        >
                                            <p className="text-xs text-content-muted mb-1">
                                                Submitted answer
                                            </p>
                                            <RenderAnswer
                                                answerJson={a?.answerJson}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <p className="text-xs text-content-muted">
                                                Auto
                                            </p>
                                            <p className="text-sm text-content-emphasis">
                                                {fmtNum(
                                                    a?.computedPoints ?? 0,
                                                )}
                                            </p>
                                            {editable ? (
                                                <input
                                                    className="input w-full mt-1"
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="Override"
                                                    value={
                                                        ov.points === null
                                                            ? ''
                                                            : String(ov.points)
                                                    }
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        const n =
                                                            v === ''
                                                                ? null
                                                                : Number(v);
                                                        setOverrides((prev) => ({
                                                            ...prev,
                                                            [q.id]: {
                                                                ...ov,
                                                                points:
                                                                    n === null ||
                                                                    Number.isFinite(
                                                                        n,
                                                                    )
                                                                        ? n
                                                                        : ov.points,
                                                            },
                                                        }));
                                                    }}
                                                    data-testid={`override-points-${q.id}`}
                                                />
                                            ) : (
                                                ov.points !== null && (
                                                    <p className="text-xs text-content-warning mt-1">
                                                        Override:{' '}
                                                        {fmtNum(ov.points)}
                                                    </p>
                                                )
                                            )}
                                        </div>
                                        <div className="md:col-span-2">
                                            <p className="text-xs text-content-muted">
                                                Notes
                                            </p>
                                            {editable ? (
                                                <textarea
                                                    className="input w-full"
                                                    rows={2}
                                                    value={ov.notes ?? ''}
                                                    onChange={(e) =>
                                                        setOverrides(
                                                            (prev) => ({
                                                                ...prev,
                                                                [q.id]: {
                                                                    ...ov,
                                                                    notes:
                                                                        e.target
                                                                            .value ||
                                                                        null,
                                                                },
                                                            }),
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <p className="text-xs text-content-muted">
                                                    {ov.notes ?? '—'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

            {/* Final rating + reviewer notes + actions */}
            {(view.status === 'SUBMITTED' || view.status === 'REVIEWED') && (
                <div
                    className="glass-card p-4 space-y-3"
                    data-testid="final-rating-panel"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-content-muted block mb-1">
                                Final risk rating
                            </label>
                            {editable ? (
                                <Combobox
                                    hideSearch
                                    selected={
                                        RATING_OPTIONS.find(
                                            (o) => o.value === finalRating,
                                        ) ?? null
                                    }
                                    setSelected={(opt) => {
                                        setFinalRating(opt?.value ?? null);
                                    }}
                                    options={RATING_OPTIONS}
                                    matchTriggerWidth
                                    placeholder={
                                        view.scoring.suggestedRating
                                            ? `Suggested: ${view.scoring.suggestedRating}`
                                            : 'Choose rating'
                                    }
                                />
                            ) : (
                                <p
                                    className="text-sm text-content-emphasis"
                                    data-testid="final-rating-readonly"
                                >
                                    {finalRating ?? '—'}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="text-xs text-content-muted block mb-1">
                                Reviewer notes (assessment-level)
                            </label>
                            {editable ? (
                                <textarea
                                    className="input w-full"
                                    rows={3}
                                    value={reviewerNotes}
                                    onChange={(e) =>
                                        setReviewerNotes(e.target.value)
                                    }
                                />
                            ) : (
                                <p className="text-sm text-content-muted whitespace-pre-wrap">
                                    {reviewerNotes || '—'}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-border-default/30">
                        {editable && (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={saveReview}
                                disabled={saving}
                                loading={saving}
                                id="save-review-btn"
                            >
                                {saving ? 'Saving…' : 'Save review'}
                            </Button>
                        )}
                        {closable && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={closeOut}
                                disabled={saving}
                                loading={saving}
                                id="close-assessment-btn"
                            >
                                {saving ? 'Closing…' : 'Close assessment'}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {view.status === 'CLOSED' && (
                <div
                    className="glass-card p-4 text-sm text-content-muted"
                    data-testid="closed-banner"
                >
                    Closed{view.closedAt ? ` ${formatDate(view.closedAt)}` : ''}.
                    Final rating:{' '}
                    <strong className="text-content-emphasis">
                        {view.riskRating ?? '—'}
                    </strong>
                </div>
            )}
        </div>
    );
}

// ─── Subcomponents ─────────────────────────────────────────────────

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'success' | 'danger';
}) {
    return (
        <div>
            <p className="text-xs text-content-muted">{label}</p>
            <p
                className={`text-sm font-semibold ${
                    tone === 'success'
                        ? 'text-content-success'
                        : tone === 'danger'
                            ? 'text-content-error'
                            : 'text-content-emphasis'
                }`}
            >
                {value}
            </p>
        </div>
    );
}

function RenderAnswer({ answerJson }: { answerJson: unknown }) {
    if (answerJson === null || answerJson === undefined) {
        return <span className="text-content-subtle italic">no answer</span>;
    }
    if (
        typeof answerJson === 'object' &&
        !Array.isArray(answerJson) &&
        'value' in (answerJson as object)
    ) {
        const v = (answerJson as { value: unknown }).value;
        return <RenderValue v={v} />;
    }
    return <RenderValue v={answerJson} />;
}

function RenderValue({ v }: { v: unknown }) {
    if (Array.isArray(v)) {
        return <span>{v.join(', ')}</span>;
    }
    if (v === null || v === undefined) {
        return <span className="text-content-subtle italic">no answer</span>;
    }
    return <span>{String(v)}</span>;
}

function fmtNum(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
}
