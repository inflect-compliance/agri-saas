'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Epic 66 — frameworks page client island.
 *
 * Owns the table/cards view toggle and the rendering for both
 * variants. The server page (`page.tsx`) does the data fetch and
 * passes the resolved `frameworks` + `coverages` as props so this
 * component stays presentational.
 *
 * Cards view uses the shared `<CardList>` compound primitives.
 * Table view uses the shared `<DataTable>`. The toggle is the
 * shared `<ViewToggle>` + `useViewMode` hook so the preference
 * persists per-page in `localStorage` under
 * `inflect:view-mode:frameworks`.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import {
    BadgeCheck,
    Car,
    ClipboardList,
    Flag,
    Package,
    ShieldCheck,
    type LucideIcon,
} from 'lucide-react';

import { CardList } from '@/components/ui/card-list';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable, createColumns } from '@/components/ui/table';
import { ViewToggle } from '@/components/ui/view-toggle';
import { useViewMode } from '@/components/ui/hooks';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

const FW_META: Record<string, { icon: LucideIcon; color: string }> = {
    ISO27001: { icon: ShieldCheck, color: 'from-indigo-500 to-purple-600' },
    NIS2: { icon: Flag, color: 'from-blue-500 to-cyan-600' },
    ISO9001: { icon: BadgeCheck, color: 'from-emerald-500 to-green-600' },
    ISO28000: { icon: Package, color: 'from-orange-500 to-amber-600' },
    ISO39001: { icon: Car, color: 'from-rose-500 to-pink-600' },
};
const FW_DEFAULT: { icon: LucideIcon; color: string } = {
    icon: ClipboardList,
    color: 'from-slate-500 to-slate-600',
};

export interface FrameworksClientProps {
    frameworks: any[];
    coverages: Record<string, any>;
    tenantSlug: string;
}

interface FwRow {
    id: string;
    key: string;
    name: string;
    description?: string;
    version?: string | null;
    kind?: string | null;
    requirementCount: number;
    packCount: number;
    coveragePercent: number;
    mapped: number;
    total: number;
    isInstalled: boolean;
    href: string;
    installHref: string;
}

export function FrameworksClient({
    frameworks,
    coverages,
    tenantSlug,
}: FrameworksClientProps) {
    const [view, setView] = useViewMode('frameworks', 'cards');
    const href = (path: string) => `/t/${tenantSlug}${path}`;

    const rows: FwRow[] = useMemo(
        () =>
            frameworks.map((fw: any): FwRow => {
                const cov = coverages[fw.key];
                const coveragePercent = cov?.coveragePercent ?? 0;
                return {
                    id: fw.id,
                    key: fw.key,
                    name: fw.name,
                    description: fw.description,
                    version: fw.version,
                    kind: fw.kind,
                    requirementCount: fw._count?.requirements ?? 0,
                    packCount: fw._count?.packs ?? 0,
                    coveragePercent,
                    mapped: cov?.mapped ?? 0,
                    total: cov?.total ?? 0,
                    isInstalled: !!(cov && cov.mapped > 0),
                    href: href(`/frameworks/${fw.key}`),
                    installHref: href(`/frameworks/${fw.key}/install`),
                };
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [frameworks, coverages],
    );

    return (
        <div className="space-y-section">
            <div className="flex items-end justify-between gap-default flex-wrap">
                <div>
                    <Breadcrumbs
                        items={[
                            { label: 'Dashboard', href: href('/dashboard') },
                            { label: 'Frameworks' },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1} id="frameworks-heading">
                        Compliance Frameworks
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        Browse standards, install control packs, and track requirement coverage
                    </p>
                </div>
                <ViewToggle
                    view={view}
                    onChange={setView}
                    data-testid="frameworks-view-toggle"
                />
            </div>

            {view === 'cards' && (
                <CardList aria-label="Frameworks" data-testid="frameworks-card-list">
                    {rows.map((row) => {
                        const meta = FW_META[row.key] || FW_DEFAULT;
                        const FwIcon = meta.icon;
                        return (
                            <CardList.Card
                                key={row.id}
                                data-testid={`fw-card-${row.key}`}
                                onClick={() => {
                                    if (typeof window !== 'undefined') {
                                        window.location.href = row.href;
                                    }
                                }}
                            >
                                <CardList.CardHeader
                                    title={
                                        <span className="inline-flex items-center gap-tight">
                                            <FwIcon
                                                className="w-5 h-5"
                                                aria-hidden="true"
                                            />
                                            <Link
                                                href={row.href}
                                                className="text-content-emphasis hover:underline"
                                            >
                                                {row.name}
                                            </Link>
                                        </span>
                                    }
                                    subtitle={
                                        row.kind
                                            ? row.kind.replace('_', ' ')
                                            : undefined
                                    }
                                    badge={
                                        row.isInstalled ? (
                                            <StatusBadge variant="success">Installed</StatusBadge>
                                        ) : (
                                            <StatusBadge variant="warning">Available</StatusBadge>
                                        )
                                    }
                                />
                                <CardList.CardContent
                                    kv={[
                                        {
                                            label: 'Requirements',
                                            value: row.requirementCount,
                                        },
                                        {
                                            label: 'Packs',
                                            value: row.packCount,
                                        },
                                        {
                                            label: 'Coverage',
                                            value: `${row.coveragePercent}%`,
                                        },
                                    ]}
                                >
                                    {row.description && (
                                        <p className="text-xs text-content-muted line-clamp-2">
                                            {row.description}
                                        </p>
                                    )}
                                    <ProgressBar
                                        value={row.coveragePercent}
                                        size="sm"
                                        variant={
                                            row.coveragePercent === 100
                                                ? 'success'
                                                : row.coveragePercent > 0
                                                ? 'brand'
                                                : 'neutral'
                                        }
                                        aria-label={`${row.name} coverage`}
                                    />
                                </CardList.CardContent>
                            </CardList.Card>
                        );
                    })}
                </CardList>
            )}

            {view === 'table' && (
                <DataTable<FwRow>
                    data={rows}
                    columns={createColumns<FwRow>([
                        {
                            id: 'name',
                            header: 'Framework',
                            cell: ({ row }) => (
                                <Link
                                    href={row.original.href}
                                    className="font-medium text-content-emphasis hover:underline"
                                >
                                    {row.original.name}
                                </Link>
                            ),
                        },
                        {
                            id: 'kind',
                            header: 'Domain',
                            cell: ({ row }) =>
                                row.original.kind ? (
                                    <span className="text-xs text-content-muted">
                                        {row.original.kind.replace('_', ' ')}
                                    </span>
                                ) : (
                                    <span className="text-content-subtle">—</span>
                                ),
                        },
                        {
                            id: 'requirementCount',
                            header: 'Requirements',
                            cell: ({ row }) => (
                                <span className="tabular-nums text-xs text-content-default">
                                    {row.original.requirementCount}
                                </span>
                            ),
                        },
                        {
                            id: 'coverage',
                            header: 'Coverage',
                            cell: ({ row }) => (
                                <span className="tabular-nums text-xs text-content-default">
                                    {row.original.coveragePercent}%
                                </span>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            cell: ({ row }) =>
                                row.original.isInstalled ? (
                                    <StatusBadge variant="success">Installed</StatusBadge>
                                ) : (
                                    <StatusBadge variant="warning">Available</StatusBadge>
                                ),
                        },
                    ])}
                />
            )}

            {rows.length === 0 && (
                <div className="glass-card text-center py-12">
                    <p className="text-content-subtle">
                        No frameworks available. Run the seed to populate.
                    </p>
                </div>
            )}
        </div>
    );
}

export default FrameworksClient;
