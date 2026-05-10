import { Card } from '@/components/ui/card';
import { cardVariants } from '@/components/ui/card-variants';
import { cn } from '@dub/utils';
/**
 * Reusable skeleton loading primitives for the dark-themed UI.
 *
 * ─── Design Tokens ───
 * Background:    bg-bg-subtle       (dark glass-card theme)
 * Animation:     animate-pulse         (CSS pulse, no custom keyframes)
 * Border radius: rounded (4px)         for blocks/inputs
 *                rounded-full (9999px) for pills/avatars
 * Spacing:       px-3 py-3             for table cells
 *                p-4 / p-6             for cards
 *                space-y-compact             for stacked lines
 * Heights:       h-3  (12px)  table headers
 *                h-4  (16px)  body text / lines
 *                h-5  (20px)  pills
 *                h-7  (28px)  headings
 *                h-8  (32px)  avatars
 *                h-9  (36px)  inputs / buttons
 */

// ─── Base Skeleton ───

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
    return (
        <div
            className={`animate-pulse rounded bg-bg-subtle ${className}`}
            aria-hidden="true"
        />
    );
}

// ─── Primitives ───

export function SkeletonLine({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-4 ${className}`} />;
}

export function SkeletonHeading({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-7 w-48 ${className}`} />;
}

export function SkeletonPill({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-5 w-20 rounded-full ${className}`} />;
}

export function SkeletonAvatar({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-8 w-8 rounded-full ${className}`} />;
}

export function SkeletonInput({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-9 rounded ${className}`} />;
}

export function SkeletonButton({ className = '' }: SkeletonProps) {
    return <Skeleton className={`h-9 w-28 rounded ${className}`} />;
}

// ─── Detail page skeleton ───

export function SkeletonDetailPage() {
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true">
            <div className="space-y-tight">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-7 w-64" />
                <div className="flex gap-tight">
                    <SkeletonPill />
                    <SkeletonPill />
                    <SkeletonPill />
                </div>
            </div>
            <SkeletonCard lines={4} />
        </div>
    );
}

// ─── Composites ───

/**
 * @deprecated Use `<DataTable loading />` instead.
 * This component is only retained for backward compatibility with detail-page
 * sub-tables that have not yet been migrated. Do NOT use in new code.
 * See: src/components/ui/table/GUIDE.md
 */
/**
 * v2-PR-15 — full-table skeleton with header row + N body rows.
 *
 * Use when a list page wants structural-fidelity loading state
 * instead of a single `<SkeletonCard>`. Renders a `<table>` whose
 * column widths approximate the real DataTable so the loading
 * state doesn't reflow when data lands.
 *
 * Default 8 cols × 6 rows — typical list-page shape. Pages with
 * dense tables can pass `rows={10} cols={6}` etc. The default for
 * cols matches `SkeletonTableRow`.
 */
export function SkeletonTable({
    rows = 6,
    cols = 8,
    className = "",
}: {
    rows?: number;
    cols?: number;
    className?: string;
}) {
    return (
        <div
            className={cn(cardVariants({ density: 'none' }), 'overflow-hidden', className)}
            aria-hidden="true"
            data-skeleton-table
        >
            <table className="w-full">
                <thead className="border-b border-border-default/50">
                    <tr>
                        {Array.from({ length: cols }).map((_, i) => (
                            <th key={i} className="px-3 py-3 text-left">
                                <Skeleton className="h-3 w-20" />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <SkeletonTableRow key={i} cols={cols} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function SkeletonTableRow({ cols = 8 }: { cols?: number }) {
    return (
        <tr>
            {Array.from({ length: cols }).map((_, i) => (
                <td key={i} className="px-3 py-3">
                    <Skeleton className={`h-4 ${i === 1 ? 'w-48' : i === 0 ? 'w-16' : 'w-20'}`} />
                </td>
            ))}
        </tr>
    );
}

export function SkeletonCard({ className = '', lines = 3 }: { className?: string; lines?: number }) {
    return (
        <div className={cn(cardVariants(), 'space-y-compact', className)} aria-hidden="true">
            {Array.from({ length: lines }).map((_, i) => (
                <SkeletonLine key={i} className={i === 0 ? 'w-1/3' : i === lines - 1 ? 'w-2/3' : 'w-full'} />
            ))}
        </div>
    );
}

// ─── Page-level composites ───

export function SkeletonPageHeader() {
    return (
        <div className="flex items-center justify-between">
            <div className="space-y-1.5">
                <SkeletonHeading />
                <SkeletonLine className="w-32" />
            </div>
            <div className="flex gap-tight">
                <SkeletonButton />
                <SkeletonButton />
                <SkeletonButton />
                <SkeletonButton className="w-32" />
            </div>
        </div>
    );
}

export function SkeletonFilterBar() {
    return (
        <div className={cardVariants({ density: 'compact' })}>
            <div className="flex flex-wrap gap-compact items-center">
                <div className="flex-1 min-w-[200px]">
                    <SkeletonInput className="w-full" />
                </div>
                <SkeletonInput className="w-40" />
                <SkeletonInput className="w-48" />
            </div>
        </div>
    );
}

/**
 * @deprecated Use `<DataTable loading />` instead.
 * This component is only retained for backward compatibility with detail-page
 * sub-tables that have not yet been migrated. Do NOT use in new code.
 * See: src/components/ui/table/GUIDE.md
 */
export function SkeletonDataTable({ rows = 8, cols = 8 }: { rows?: number; cols?: number }) {
    return (
        <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
            <table className="data-table">
                <thead>
                    <tr>
                        {Array.from({ length: cols }).map((_, i) => (
                            <th key={i}>
                                <Skeleton className={`h-3 ${i === 1 ? 'w-16' : 'w-12'}`} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <SkeletonTableRow key={i} cols={cols} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Filter toolbar skeleton (Epic 53) ───
//
// Mirrors the shape of `<FilterToolbar>`: search input on the left,
// one filter trigger pill + one active-filter pill on the right. The
// name mirrors the live toolbar component so call sites read
// straightforwardly.

export function SkeletonFilterToolbar() {
    return (
        <div className="flex flex-wrap items-center gap-tight">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Skeleton className="h-[34px] w-full rounded-lg" />
            </div>
            <Skeleton className="h-[30px] w-24 rounded-full" />
            <Skeleton className="h-[30px] w-20 rounded-full" />
        </div>
    );
}

// ─── KPI card grids ───

export function SkeletonKpiCard() {
    return (
        <Card className="text-center" aria-hidden="true">
            <Skeleton className="h-3 w-20 mx-auto" />
            <Skeleton className="h-8 w-12 mx-auto mt-3" />
        </Card>
    );
}

export function SkeletonKpiGrid({ count = 4 }: { count?: number }) {
    return (
        <div className={`grid grid-cols-2 ${count === 6 ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'} gap-default`}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonKpiCard key={i} />
            ))}
        </div>
    );
}

// ─── Dashboard skeleton ───

export function SkeletonDashboard() {
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label="Loading dashboard">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-compact">
                <div className="space-y-1.5">
                    <SkeletonHeading className="w-40" />
                    <SkeletonLine className="w-56" />
                </div>
            </div>

            {/* 6-card stat grid */}
            <SkeletonKpiGrid count={6} />

            {/* Clause progress + Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <Card className="space-y-compact">
                    <Skeleton className="h-4 w-32" />
                    <div className="flex items-center gap-compact">
                        <Skeleton className="flex-1 h-3 rounded-full" />
                        <Skeleton className="h-4 w-12" />
                    </div>
                    <Skeleton className="h-3 w-24 mt-1" />
                </Card>
                <Card className="space-y-compact">
                    <Skeleton className="h-4 w-36" />
                    <div className="space-y-tight">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-tight">
                                <Skeleton className="w-2 h-2 rounded-full" />
                                <Skeleton className={`h-3 ${i === 0 ? 'w-40' : i === 1 ? 'w-48' : 'w-36'}`} />
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Quick actions + Recent activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <Card className="space-y-compact">
                    <Skeleton className="h-4 w-28" />
                    <div className="grid grid-cols-2 gap-tight">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-8 rounded" />
                        ))}
                    </div>
                </Card>
                <Card className="space-y-compact">
                    <Skeleton className="h-4 w-32" />
                    <div className="space-y-tight">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex items-start gap-tight">
                                <Skeleton className="h-3 w-28 shrink-0" />
                                <Skeleton className={`h-3 ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`} />
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}

// ─── Detail page with tabs ───

export function SkeletonDetailTabs({ tabCount = 4 }: { tabCount?: number }) {
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label="Loading details">
            {/* Back link + heading */}
            <div className="space-y-tight">
                <Skeleton className="h-4 w-16" />
                <SkeletonHeading className="w-72" />
                <div className="flex gap-tight mt-1">
                    <SkeletonPill />
                    <SkeletonPill className="w-24" />
                    <SkeletonPill className="w-16" />
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-border-subtle pb-0.5">
                {Array.from({ length: tabCount }).map((_, i) => (
                    <Skeleton key={i} className={`h-8 ${i === 0 ? 'w-24' : 'w-20'} rounded-t`} />
                ))}
            </div>

            {/* Tab content placeholder */}
            <SkeletonCard lines={5} />
            <SkeletonCard lines={3} />
        </div>
    );
}

// ─── Admin / settings skeleton ───

export function SkeletonSettings() {
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label="Loading settings">
            <SkeletonHeading className="w-36" />
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={cn(cardVariants(), 'space-y-default')}>
                    <Skeleton className="h-5 w-40" />
                    <div className="space-y-compact">
                        <div className="flex items-center gap-default">
                            <Skeleton className="h-4 w-24" />
                            <SkeletonInput className="flex-1" />
                        </div>
                        <div className="flex items-center gap-default">
                            <Skeleton className="h-4 w-32" />
                            <SkeletonInput className="flex-1" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
