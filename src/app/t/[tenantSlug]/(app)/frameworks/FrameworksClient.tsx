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
import { useMemo, useState } from 'react';
import type { SVGProps, ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import {
    BadgeCheck,
    Directions,
    BulletList,
    Flag,
    Cube,
    Plus,
    ShieldCheck,
} from '@/components/ui/icons/nucleo';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

import { Button } from '@/components/ui/button';
import { CardList } from '@/components/ui/card-list';
import { Modal } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable, createColumns, useColumnsDropdown } from '@/components/ui/table';
import { ViewToggle } from '@/components/ui/view-toggle';
import { useViewMode } from '@/components/ui/hooks';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

type FwIconType = ComponentType<SVGProps<SVGSVGElement>>;

const FW_META: Record<string, { icon: FwIconType; color: string }> = {
    ISO27001: { icon: ShieldCheck, color: 'from-indigo-500 to-purple-600' },
    NIS2: { icon: Flag, color: 'from-blue-500 to-cyan-600' },
    ISO9001: { icon: BadgeCheck, color: 'from-emerald-500 to-green-600' },
    ISO28000: { icon: Cube, color: 'from-orange-500 to-amber-600' },
    ISO39001: { icon: Directions, color: 'from-rose-500 to-pink-600' },
};
const FW_DEFAULT: { icon: FwIconType; color: string } = {
    icon: BulletList,
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
    const t = useTranslations('frameworks');
    const [view, setView] = useViewMode('frameworks', 'cards');
    // B8 — explanatory modal for custom-framework creation. Custom
    // frameworks require a tenantId column on the (currently global)
    // Framework model + matching RLS policies — a substantial change
    // queued for a follow-up. The modal surfaces the path and links
    // to the existing import flow as the today-answer.
    const [customFwModalOpen, setCustomFwModalOpen] = useState(false);
    const href = (path: string) => `/t/${tenantSlug}${path}`;

    // R10-PR7 — column-visibility gear, table-mode only.
    const frameworkColumnList = useMemo(
        () => [
            { id: 'name', label: t('colFramework') },
            { id: 'kind', label: t('colDomain') },
            { id: 'requirementCount', label: t('colRequirements') },
            { id: 'coverage', label: t('colCoverage') },
            { id: 'status', label: t('colStatus') },
        ],
        [t],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:frameworks',
        columns: frameworkColumnList,
    });

    // B8 — pick the first uninstalled framework as the "Import"
    // CTA target. Falls back to the first framework when everything
    // is already installed; if there are none at all the CTA hides.
    const importHref = useMemo(() => {
        const uninstalled = frameworks.find((fw: any) => {
            const cov = coverages[fw.key];
            return !cov || cov.mapped === 0;
        });
        const target = uninstalled ?? frameworks[0];
        return target ? href(`/frameworks/${target.key}/install`) : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameworks, coverages]);

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
        <div className="space-y-section animate-fadeIn">
            <div className="flex items-end justify-between gap-default flex-wrap">
                <div>
                    <PageBreadcrumbs
                        items={[
                            { label: t('breadcrumbDashboard'), href: href('/dashboard') },
                            { label: t('breadcrumbFrameworks') },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1} id="frameworks-heading">
                        {t('title')}
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        {t('description')}
                    </p>
                </div>
                <div className="flex items-center gap-tight">
                    {view === 'table' && columnsDropdown}
                    <ViewToggle
                        view={view}
                        onChange={setView}
                        data-testid="frameworks-view-toggle"
                    />
                    {/* B8 — Custom-framework explainer CTA. Opens
                        the modal that documents the design + links
                        out to the import path. */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCustomFwModalOpen(true)}
                        id="create-framework-btn"
                        data-testid="create-framework-btn"
                    >
                        {t('createFramework')}
                    </Button>
                    {/* B8 — primary action: jump to the import flow
                        for the first uninstalled framework. Hides
                        when there's literally nothing in the
                        catalogue (seed not run). */}
                    {importHref && (
                        <Link href={importHref}>
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<Plus className="-ml-0.5 -mr-2.5" />}
                                id="import-framework-btn"
                                data-testid="import-framework-btn"
                            >
                                {t('importFramework')}
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {view === 'cards' && (
                <CardList aria-label={t('cardListAria')} data-testid="frameworks-card-list">
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
                                            <StatusBadge variant="success">{t('installed')}</StatusBadge>
                                        ) : (
                                            <StatusBadge variant="warning">{t('available')}</StatusBadge>
                                        )
                                    }
                                />
                                <CardList.CardContent
                                    kv={[
                                        {
                                            label: t('kvRequirements'),
                                            value: row.requirementCount,
                                        },
                                        {
                                            label: t('kvPacks'),
                                            value: row.packCount,
                                        },
                                        {
                                            label: t('kvCoverage'),
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
                                        aria-label={t('coverageAria', { name: row.name })}
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
                    columnVisibility={columnVisibility}
                    onColumnVisibilityChange={setColumnVisibility}
                    columns={createColumns<FwRow>([
                        {
                            id: 'name',
                            header: t('colFramework'),
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
                            header: t('colDomain'),
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
                            header: t('colRequirements'),
                            cell: ({ row }) => (
                                <span className="tabular-nums text-xs text-content-default">
                                    {row.original.requirementCount}
                                </span>
                            ),
                        },
                        {
                            id: 'coverage',
                            header: t('colCoverage'),
                            cell: ({ row }) => (
                                <span className="tabular-nums text-xs text-content-default">
                                    {row.original.coveragePercent}%
                                </span>
                            ),
                        },
                        {
                            id: 'status',
                            header: t('colStatus'),
                            cell: ({ row }) =>
                                row.original.isInstalled ? (
                                    <StatusBadge variant="success">{t('installed')}</StatusBadge>
                                ) : (
                                    <StatusBadge variant="warning">{t('available')}</StatusBadge>
                                ),
                        },
                    ])}
                />
            )}

            {rows.length === 0 && (
                <div className={cn(cardVariants({ density: 'none' }), 'text-center py-12')}>
                    <p className="text-content-subtle">
                        {t('emptyMessage')}
                    </p>
                </div>
            )}

            {/* B8 — Custom-framework explainer modal. Documents the
                today-answer (import from catalogue + customise per-
                requirement after install) and the planned future
                (full tenant-scoped frameworks). Pure UX surface — no
                schema change behind it yet. */}
            <Modal
                showModal={customFwModalOpen}
                setShowModal={setCustomFwModalOpen}
                size="md"
                title={t('customModal.title')}
                description={t('customModal.subtitle')}
            >
                <Modal.Header
                    title={t('customModal.title')}
                    description={t('customModal.subtitle')}
                />
                <Modal.Body>
                    <div className="space-y-default text-sm text-content-default">
                        <p>
                            <strong>{t('customModal.todayLabel')}</strong>
                            {t.rich('customModal.todayBody', {
                                em: (chunks) => <em>{chunks}</em>,
                            })}
                        </p>
                        <p>
                            <strong>{t('customModal.comingSoonLabel')}</strong>
                            {t('customModal.comingSoonBody')}
                        </p>
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCustomFwModalOpen(false)}
                    >
                        {t('customModal.close')}
                    </Button>
                    {importHref && (
                        <Link href={importHref}>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setCustomFwModalOpen(false)}
                            >
                                {t('importFramework')}
                            </Button>
                        </Link>
                    )}
                </Modal.Actions>
            </Modal>
        </div>
    );
}

export default FrameworksClient;
