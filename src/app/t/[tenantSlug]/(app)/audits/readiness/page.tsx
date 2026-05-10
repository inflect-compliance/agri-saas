/**
 * Audit Readiness Overview — Server Component.
 *
 * Renders one card per audit cycle with the cycle's readiness score.
 *
 * Why this page is a Server Component:
 *
 *   • The previous client-side implementation fetched the cycles
 *     list, then fan-out fetched per-cycle readiness scores. With N
 *     cycles, that was 1 + N HTTP round-trips on the WAN — bound by
 *     network latency × N, not by DB latency.
 *
 *   • There's no real interactivity on the page beyond Links to
 *     other pages. Score rings are static SVGs derived from the data.
 *     So there's no reason for the data fetch to live in `'use client'`.
 *
 *   • The orchestrator `getReadinessOverview()` runs the per-cycle
 *     fan-out server-side via Promise.allSettled, where it's bound
 *     by LAN-fast DB latency. One client→server round-trip total.
 *
 * Failure-mode notes (see overview.ts docblock):
 *   • A cycle whose readiness computation fails is rendered without
 *     a score (the cycle id won't appear in `scoresByCycleId`). The
 *     UI matches the previous client-side behaviour.
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import {
    ShieldCheck,
    Flag,
    ClipboardList,
    BarChart3,
    type LucideIcon,
} from 'lucide-react';
import { getTenantCtx } from '@/app-layer/context';
import { getReadinessOverview } from '@/app-layer/usecases/audit-readiness';
import type { ReadinessResult } from '@/app-layer/usecases/audit-readiness-scoring';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

export const dynamic = 'force-dynamic';

const FW_META: Record<string, { icon: LucideIcon; label: string; color: string }> = {
    ISO27001: { icon: ShieldCheck, label: 'ISO/IEC 27001:2022', color: 'from-indigo-500 to-purple-600' },
    NIS2: { icon: Flag, label: 'NIS2 Directive', color: 'from-blue-500 to-cyan-600' },
};
const FW_DEFAULT: { icon: LucideIcon; label: string; color: string } = {
    icon: ClipboardList,
    label: '',
    color: 'from-gray-500 to-gray-600',
};

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
    const r = (size - 8) / 2;
    const c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
    return (
        <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth="6"
                strokeDasharray={c}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-1000"
            />
            <text
                x={size / 2}
                y={size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="transform rotate-90 origin-center"
                fill="white"
                fontSize={size / 3.5}
                fontWeight="bold"
            >
                {score}
            </text>
        </svg>
    );
}

interface CycleListItem {
    id: string;
    name: string;
    frameworkKey: string;
}

export default async function ReadinessOverviewPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const { cycles, scoresByCycleId } = await getReadinessOverview(ctx);

    return (
        <div className="space-y-section animate-fadeIn">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-compact">
                <div>
                    <PageBreadcrumbs
                        items={[
                            { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                            { label: 'Audits', href: `/t/${tenantSlug}/audits` },
                            { label: 'Readiness' },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1} id="readiness-heading">
                        Audit Readiness
                    </Heading>
                    <p className="text-content-muted text-sm">
                        Framework readiness scores across all audit cycles
                    </p>
                </div>
                <Link href={`/t/${tenantSlug}/audits/cycles`} className={buttonVariants({ variant: 'secondary' })}>
                    View Cycles →
                </Link>
            </div>

            {cycles.length === 0 ? (
                // Inline empty state — this is a server component, and
                // <EmptyState>'s `icon` prop takes a Component
                // reference (`React.ElementType`). Passing a function
                // (Component) from a server component to a client
                // component is a Next.js 15 violation
                // ("Functions cannot be passed directly to Client
                // Components"). EmptyState is the right primitive
                // for client-page empty states; this server-rendered
                // page renders the icon JSX inline so the SSR
                // boundary only sees serialised React nodes.
                <div className="glass-card p-12 text-center">
                    <div className="mb-4">
                        <BarChart3 className="size-10 text-content-muted mx-auto" aria-hidden="true" />
                    </div>
                    <Heading level={2} className="mb-2">
                        No audit cycles yet
                    </Heading>
                    <p className="text-content-muted text-sm mb-4">
                        Create an audit cycle to see readiness scores.
                    </p>
                    <Link
                        href={`/t/${tenantSlug}/audits/cycles`}
                        className={buttonVariants({ variant: 'primary' })}
                    >
                        + Audit Cycle
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-section">
                    {(cycles as CycleListItem[]).map((c) => {
                        const meta = FW_META[c.frameworkKey] || { ...FW_DEFAULT, label: c.frameworkKey };
                        const FwIcon = meta.icon;
                        const sc: ReadinessResult | undefined = scoresByCycleId[c.id];
                        return (
                            <Link
                                key={c.id}
                                href={`/t/${tenantSlug}/audits/cycles/${c.id}/readiness`}
                                className="glass-card p-6 hover:bg-bg-muted/50 transition group"
                                id={`readiness-card-${c.id}`}
                            >
                                <div className="flex items-start gap-section">
                                    <div className="flex-shrink-0">
                                        {sc ? (
                                            <ScoreRing score={sc.score} />
                                        ) : (
                                            <div className="w-24 h-24 rounded-full bg-bg-elevated/50 flex items-center justify-center text-content-subtle">
                                                –
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-tight mb-1">
                                            <span
                                                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.color} flex items-center justify-center text-sm`}
                                            >
                                                <FwIcon className="w-4 h-4 text-content-emphasis" aria-hidden="true" />
                                            </span>
                                            <Heading level={3} className="truncate">{c.name}</Heading>
                                        </div>
                                        <p className="text-xs text-content-muted">{meta.label}</p>
                                        {sc && (
                                            <div className="mt-3 space-y-1">
                                                {sc.recommendations?.slice(0, 2).map((r: string, i: number) => (
                                                    <p key={i} className="text-xs text-content-subtle truncate">
                                                        → {r}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
