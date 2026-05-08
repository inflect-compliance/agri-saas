'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppIcon, type AppIconName } from '@/components/icons/AppIcon';
import { buttonVariants } from '@/components/ui/button-variants';
import { ProgressBar } from '@/components/ui/progress-bar';

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
    const r = (size - 8) / 2;
    const c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
    return (
        <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8"
                strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
                className="transition-all duration-1000" />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
                className="transform rotate-90 origin-center" fill="white" fontSize={size / 3} fontWeight="bold">
                {score}
            </text>
        </svg>
    );
}

const GAP_ICON: Record<string, AppIconName> = {
    UNMAPPED_REQUIREMENT: 'overview', MISSING_EVIDENCE: 'evidence', OVERDUE_TASK: 'clock',
    OPEN_ISSUE: 'warning', MISSING_POLICY: 'fileWarning',
};
const SEV_BADGE: Record<string, string> = {
    HIGH: 'badge-danger', MEDIUM: 'badge-warning', LOW: 'badge-neutral',
};

export default function CycleReadinessPage() {
    const params = useParams();
    const tenantSlug = params.tenantSlug as string;
    const cycleId = params.cycleId as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    const [result, setResult] = useState<any>(null);
    const [cycle, setCycle] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch(apiUrl(`/audits/cycles/${cycleId}/readiness`)).then(r => r.ok ? r.json() : null),
            fetch(apiUrl(`/audits/cycles/${cycleId}`)).then(r => r.ok ? r.json() : null),
        ]).then(([r, c]) => { setResult(r); setCycle(c); }).finally(() => setLoading(false));
    }, [apiUrl, cycleId]);

    if (loading) return <div className="p-8"><div className="glass-card animate-pulse h-64" /></div>;
    if (!result) return <div className="p-8 text-center text-content-muted">Could not compute readiness.</div>;

    const bd = result.breakdown;

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center gap-3">
                <Link href={`/t/${tenantSlug}/audits/readiness`} className="text-content-muted hover:text-content-emphasis transition">← Readiness</Link>
                <span className="text-content-subtle">·</span>
                <Link href={`/t/${tenantSlug}/audits/cycles/${cycleId}`} className="text-content-muted hover:text-content-emphasis transition">{cycle?.name || 'Cycle'}</Link>
            </div>

            {/* Score + Breakdown */}
            <div className="glass-card p-6">
                <div className="flex items-start gap-8">
                    <div className="flex-shrink-0 text-center">
                        <ScoreRing score={result.score} />
                        <p className="text-xs text-content-muted mt-2">{result.frameworkKey} Readiness</p>
                    </div>
                    <div className="flex-1 space-y-3" id="readiness-breakdown">
                        {bd.coverage && (
                            <BreakdownBar label="Requirement Coverage" score={bd.coverage.score}
                                detail={`${bd.coverage.mapped}/${bd.coverage.total} requirements mapped`} weight={bd.coverage.weight} />
                        )}
                        {bd.implementation && (
                            <BreakdownBar label="Controls Implemented" score={bd.implementation.score}
                                detail={`${bd.implementation.implemented}/${bd.implementation.total} controls IMPLEMENTED`} weight={bd.implementation.weight} />
                        )}
                        {bd.evidence && (
                            <BreakdownBar label="Evidence Completeness" score={bd.evidence.score}
                                detail={`${bd.evidence.withEvidence}/${bd.evidence.total} controls with evidence`} weight={bd.evidence.weight} />
                        )}
                        {bd.policies && (
                            <BreakdownBar label="Key Policies" score={bd.policies.score}
                                detail={`${bd.policies.found?.length || 0}/${bd.policies.expected?.length || 0} key policies found`} weight={bd.policies.weight} />
                        )}
                        {bd.tasks && (
                            <BreakdownBar label="Task Completion" score={bd.tasks.score}
                                detail={`${bd.tasks.overdue} overdue task(s)`} weight={bd.tasks.weight} />
                        )}
                        {bd.issues && (
                            <BreakdownBar label="Open Issues" score={bd.issues.score}
                                detail={`${bd.issues.open} open issue(s)`} weight={bd.issues.weight} />
                        )}
                    </div>
                </div>
            </div>

            {/* Recommendations */}
            {result.recommendations?.length > 0 && (
                <div className="glass-card p-6" id="recommendations">
                    <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><AppIcon name="info" size={16} /> Recommended Next Actions</h3>
                    <div className="space-y-2">
                        {result.recommendations.map((r: string, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-content-warning flex-shrink-0">→</span>
                                <span className="text-content-default">{r}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Gaps */}
            {result.gaps?.length > 0 && (
                <div className="space-y-3" id="gaps-section">
                    <h3 className="text-sm font-semibold">Top Gaps ({result.gaps.length})</h3>
                    <div className="glass-card divide-y divide-border-default/50">
                        {result.gaps.map((g: any, i: number) => (
                            <div key={i} className="p-3 flex items-center justify-between text-sm">
                                <div className="flex items-center gap-3 min-w-0">
                                    <AppIcon name={GAP_ICON[g.type] || 'overview'} size={16} />
                                    <div className="min-w-0">
                                        <span className="font-medium truncate block">{g.title}</span>
                                        <span className="text-xs text-content-subtle">{g.details}</span>
                                    </div>
                                </div>
                                <span className={`badge ${SEV_BADGE[g.severity] || 'badge-neutral'} text-xs ml-2`}>{g.severity}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Exports */}
            <div className="glass-card p-6" id="exports-section">
                <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-2"><AppIcon name="export" size={16} /> Exports</h3>
                <div className="flex flex-wrap gap-2">
                    <a href={apiUrl(`/audits/cycles/${cycleId}/readiness?action=export-json`)}
                        target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Readiness Report (JSON)</a>
                    <a href={apiUrl(`/audits/cycles/${cycleId}/readiness?action=export-unmapped-csv`)}
                        target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Unmapped Requirements (CSV)</a>
                    <a href={apiUrl(`/audits/cycles/${cycleId}/readiness?action=export-control-gaps-csv`)}
                        target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Control Gaps (CSV)</a>
                </div>
            </div>
        </div>
    );
}

function BreakdownBar({ label, score, detail, weight }: { label: string; score: number; detail: string; weight: number }) {
    // Epic 59 ProgressBar primitive. Variant picks the token-backed
    // colour by score band — light-mode compatible (replaces the
    // earlier hardcoded emerald/amber/red Tailwind classes).
    const variant = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error';
    return (
        <div>
            <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-content-default">{label} ({Math.round(weight * 100)}%)</span>
                <span className="text-content-muted">{score}%</span>
            </div>
            <ProgressBar
                value={score}
                size="md"
                variant={variant}
                aria-label={`${label} readiness score`}
            />
            <p className="text-xs text-content-subtle mt-0.5">{detail}</p>
        </div>
    );
}
