'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers/derived arrays recreated each render). The proper structural fix is wrapping parent-level callbacks in useCallback. Tracked as follow-up; existing per-line eslint-disable-next-line markers preserved. */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
// NOTE: NewRiskModal was previously lazy-loaded via next/dynamic, but
// the JIT race in `next dev` made the modal occasionally fail to mount
// in serial-mode E2E runs (Playwright clicked the button before the
// chunk finished compiling, leaving #risk-title undetected). Static
// import — modal is small, the page bundle cost is negligible, and the
// E2E suite becomes deterministic.
import { NewRiskModal } from './NewRiskModal';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
    ColumnsDropdown,
    DataTable,
    createColumns,
    getDefaultVisibility,
} from '@/components/ui/table';
import { useColumnVisibility } from '@/components/ui/hooks';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
    type FilterType,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import {
    buildRiskFilters,
    RISK_API_TRANSFORMS,
    RISK_FILTER_KEYS,
} from './filter-defs';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { RiskMatrix } from '@/components/ui/RiskMatrix';
import { resolveBandForScore } from '@/lib/risk-matrix/scoring';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface RiskListItem {
    id: string;
    title: string;
    threat: string;
    likelihood: number;
    impact: number;
    inherentScore: number;
    score?: number;
    category?: string | null;
    treatment: string | null;
    status?: string;
    nextReviewAt?: string | null;
    treatmentOwner?: string | null;
    ownerUserId?: string | null;
    owner?: { id: string; name: string | null; email: string | null } | null;
    asset: { name: string } | null;
    controls: unknown[];
}

interface RisksClientProps {
    initialRisks: RiskListItem[];
    initialFilters?: Record<string, string>;
    /**
     * Effective `RiskMatrixConfigShape` for this tenant (Epic 44.1).
     * Drives the heatmap view's `<RiskMatrix>` engine + the score-
     * column chip colour. Resolved server-side; the client never
     * has to handle "no config".
     */
    matrixConfig: RiskMatrixConfigShape;
    tenantSlug: string;
    permissions: {
        canRead: boolean;
        canWrite: boolean;
        canAdmin: boolean;
        canAudit: boolean;
        canExport: boolean;
    };
    translations: {
        title: string;
        risksIdentified: string;
        heatmap: string;
        register: string;
        addRisk: string;
        riskTitle: string;
        asset: string;
        threat: string;
        score: string;
        level: string;
        treatment: string;
        controlsCol: string;
        noRisks: string;
        low: string;
        medium: string;
        high: string;
        critical: string;
        untreated: string;
        heatmapTitle: string;
        totalRisks: string;
        avgScore: string;
        openRisks: string;
        overdueReviews: string;
    };
}

/**
 * Client island for risks — handles filters, heatmap toggle, and interactive list.
 * Data arrives pre-fetched from the server component, hydrated into React Query.
 *
 * Filter architecture (Epic 53):
 *   - `useFilterContext` manages q, status, category, ownerUserId, score.
 *   - The UI carries a single `score=min|max` token; `RISK_API_TRANSFORMS`
 *     splits it into `scoreMin` + `scoreMax` at the API boundary.
 */
export function RisksClient(props: RisksClientProps) {
    const filterCtx = useFilterContext([], RISK_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <RisksPageInner {...props} />
        </FilterProvider>
    );
}

function RisksPageInner({
    initialRisks,
    initialFilters,
    matrixConfig,
    tenantSlug,
    permissions,
    translations: t,
}: RisksClientProps) {
    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    const [view, setView] = useState<'register' | 'heatmap'>('register');

    // Epic 54 — create-risk modal. Also auto-opens on `?create=1`, which
    // the `/risks/new` redirect shim lands on; keeps legacy deep-links
    // and `page.goto('/risks/new')` E2E scripts working against the
    // modal flow. The flag is stripped after open so back/forward
    // doesn't reopen the modal unexpectedly.
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const searchParams = useSearchParams();
    useEffect(() => {
        if (searchParams?.get('create') === '1') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsCreateOpen(true);
            const next = new URLSearchParams(searchParams.toString());
            next.delete('create');
            const qs = next.toString();
            router.replace(
                `/t/${tenantSlug}/risks${qs ? `?${qs}` : ''}`,
                { scroll: false },
            );
        }
        // First-mount only; filter state owns subsequent URL edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filterCtx = useFilters();
    const { state, search, hasActive } = filterCtx;

    // ─── API query: UI state → API params (range split via transform) ───
    const fetchParams = useMemo(
        () => toApiSearchParams(state, { search, transforms: RISK_API_TRANSFORMS }),
        [state, search],
    );
    const queryKeyFilters = useMemo(() => {
        const obj: Record<string, string> = {};
        for (const [k, v] of fetchParams) obj[k] = v;
        return obj;
    }, [fetchParams]);

    const serverHadFilters = initialFilters && Object.keys(initialFilters).length > 0;
    const filtersMatchInitial = useMemo(() => {
        if (!serverHadFilters) return !hasActive;
        const current = queryKeyFilters;
        const keys = new Set([...Object.keys(current), ...Object.keys(initialFilters!)]);
        for (const k of keys) {
            if ((current[k] ?? '') !== (initialFilters![k] ?? '')) return false;
        }
        return true;
    }, [queryKeyFilters, initialFilters, serverHadFilters, hasActive]);

    // Epic 69 — read source is `useTenantSWR` against a filter-aware
    // cache key. Each unique filter combination becomes its own
    // entry, so toggling filters doesn't fight over the same cache
    // slot. The unfiltered baseline is the registry's `list()`.
    // Server-rendered initial data lands as `fallbackData` only when
    // the active filters match what the server fetched — otherwise
    // the hook fires a fresh request immediately, matching the prior
    // React Query semantics of "skip initialData when filters
    // diverged from the server's view".
    const risksKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs
            ? `${CACHE_KEYS.risks.list()}?${qs}`
            : CACHE_KEYS.risks.list();
    }, [fetchParams]);

    // PR-5 — API returns `{ rows, truncated }` so the Client knows
    // when the backfill cap fired and can render the truncation
    // banner. SSR initial is wrapped at the page layer with
    // `truncated: false` because the SSR cap (100) is well below the
    // backfill cap (5000) — the banner only fires when SWR brings
    // back the cap+1 sentinel.
    const risksQuery = useTenantSWR<CappedList<RiskListItem>>(risksKey, {
        fallbackData: filtersMatchInitial
            ? { rows: initialRisks, truncated: false }
            : undefined,
    });

    const risks = risksQuery.data?.rows ?? [];
    const truncated = risksQuery.data?.truncated ?? false;
    const loading = risksQuery.isLoading && !risksQuery.data;

    // ─── Column visibility (Epic 52) ───
    // Pagination removed in favour of internal scroll inside the
    // table card (see ListPageShell.Body + DataTable fillBody).
    // All filtered rows render at once; the card scrolls.
    const riskColumnConfig = useMemo(
        () => ({
            // Epic 44.4 — added `status` and `owner` to the column
            // set; default-visible KEEPS the pre-Epic-44 columns
            // (asset / threat / lxi) so existing operators don't
            // see a quietly-pruned first view. The new columns sit
            // alongside, toggleable via the ColumnsDropdown.
            all: ['title', 'asset', 'threat', 'lxi', 'inherentScore', 'level', 'status', 'owner', 'treatment', 'controls'],
            defaultVisible: ['title', 'asset', 'threat', 'lxi', 'inherentScore', 'level', 'status', 'owner', 'treatment', 'controls'],
        }),
        [],
    );
    const { columnVisibility, setColumnVisibility } = useColumnVisibility(
        'inflect:col-vis:risks',
        riskColumnConfig,
    );
    const defaultRiskVisibility = useMemo(
        () => getDefaultVisibility(riskColumnConfig),
        [riskColumnConfig],
    );
    const riskColumnDropdown = useMemo(
        () => [
            { id: 'title', label: 'Title' },
            { id: 'asset', label: 'Asset' },
            { id: 'threat', label: 'Threat' },
            { id: 'lxi', label: 'L × I' },
            { id: 'inherentScore', label: 'Score' },
            { id: 'level', label: 'Level' },
            { id: 'status', label: 'Status' },
            { id: 'owner', label: 'Owner' },
            { id: 'treatment', label: 'Treatment' },
            { id: 'controls', label: 'Controls' },
        ],
        [],
    );

    // ── KPI Computations ──
    // Local aggregations over the already-fetched page of risks — these
    // power the KPI cards and the 5×5 heatmap, not a re-filter of the
    // server-side data set. The `// guardrail-ignore` directives tell
    // `tests/guardrails/no-client-side-filtering.test.ts` to skip them.
    const total = risks.length;
    const avgScore = total ? (risks.reduce((s, r) => s + r.inherentScore, 0) / total).toFixed(1) : '0.0';
    // guardrail-ignore: KPI count across the loaded page, not a refilter.
    const openCount = risks.filter(r => r.status === 'OPEN' || r.status === 'MITIGATING').length;
    // `now` is null during SSR and first client render so the overdue
    // count matches exactly across hydration (avoids React #418/#422).
    const now = useHydratedNow();
    // guardrail-ignore: KPI count across the loaded page, not a refilter.
    const overdueRisks = now ? risks.filter(r => r.nextReviewAt && new Date(r.nextReviewAt) < now) : [];

    // Epic 44.3 — collapse the loaded page into the sparse `(L, I)`
    // shape the new `<RiskMatrix>` engine consumes. Each cell carries
    // count + risk titles for the bubble overlay; the engine handles
    // truncation + tooltip so the page stays presentation-free.
    const matrixCells = useMemo(() => {
        const lookup = new Map<
            string,
            { likelihood: number; impact: number; count: number; risks: { id: string; title: string }[] }
        >();
        for (const r of risks) {
            const key = `${r.likelihood}-${r.impact}`;
            // guardrail-ignore: bucketing the loaded page into the matrix cells.
            const cell = lookup.get(key) ?? {
                likelihood: r.likelihood,
                impact: r.impact,
                count: 0,
                risks: [],
            };
            cell.count += 1;
            cell.risks.push({ id: r.id, title: r.title });
            lookup.set(key, cell);
        }
        return Array.from(lookup.values());
    }, [risks]);

    const getRiskLevel = (score: number): { label: string; class: StatusBadgeVariant } => {
        if (score <= 5) return { label: t.low, class: 'success' };
        if (score <= 12) return { label: t.medium, class: 'warning' };
        if (score <= 18) return { label: t.high, class: 'error' };
        return { label: t.critical, class: 'error' };
    };

    // Workflow-status variants (Epic 44.4). The label set mirrors
    // `RiskStatus` in the schema (OPEN / MITIGATING / ACCEPTED / CLOSED).
    const STATUS_CLASS: Record<string, StatusBadgeVariant> = {
        OPEN: 'warning',
        MITIGATING: 'info',
        ACCEPTED: 'neutral',
        CLOSED: 'success',
    };

    // ── Column Definitions ──
    const riskColumns = useMemo(() => createColumns<RiskListItem>([
        {
            accessorKey: 'title',
            header: t.riskTitle,
            cell: ({ getValue }) => (
                <span className="font-medium text-content-emphasis text-sm">{getValue<string>()}</span>
            ),
        },
        {
            accessorFn: (r) => r.asset?.name || '—',
            id: 'asset',
            header: t.asset,
            cell: ({ getValue }) => (
                <span className="text-xs">{getValue<string>()}</span>
            ),
        },
        {
            accessorKey: 'threat',
            header: t.threat,
            cell: ({ getValue }) => (
                <span className="text-xs text-content-muted">{getValue<string>()}</span>
            ),
        },
        {
            id: 'lxi',
            header: 'L×I',
            accessorFn: (r) => `${r.likelihood}×${r.impact}`,
            cell: ({ getValue }) => (
                <span className="text-xs">{getValue<string>()}</span>
            ),
        },
        {
            accessorKey: 'inherentScore',
            header: t.score,
            // Epic 44.4 — score chip uses the band colour from the
            // tenant's RiskMatrixConfig, so the colour, threshold,
            // and label set all stay configurable. Falls back to a
            // neutral chip if a band can't be resolved (mid-edit
            // config preview).
            cell: ({ getValue, row }) => {
                const score = getValue<number>();
                const band = resolveBandForScore(score, matrixConfig.bands);
                // axe AA — `color-contrast`: the previous chip used
                // `band.color` for both the tinted background AND the
                // text, so the contrast ratio collapsed to ~2:1 (well
                // below WCAG AA's 4.5:1 for small text). Splitting the
                // visual roles fixes it without losing the band cue:
                //   - background: tinted `band.color` (kept as the
                //     band-recognition cue),
                //   - dot: solid `band.color` (a second, higher-
                //     saturation cue that reads even when the tint is
                //     subtle),
                //   - text: `text-content-emphasis` (the app's
                //     designed-for-contrast neutral, ~16:1 against
                //     either palette).
                return (
                    <span
                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-bold tabular-nums text-content-emphasis"
                        style={{
                            backgroundColor: `${band.color}33`, // 20% alpha
                        }}
                        title={`${band.name} (${score})`}
                        data-band={band.name}
                        data-testid={`risk-score-${row.original.id}`}
                    >
                        <span
                            aria-hidden="true"
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: band.color }}
                        />
                        {score}
                    </span>
                );
            },
        },
        {
            id: 'level',
            header: t.level,
            accessorFn: (r) => r.inherentScore,
            cell: ({ getValue }) => {
                const level = getRiskLevel(getValue<number>());
                return <StatusBadge variant={level.class}>{level.label}</StatusBadge>;
            },
        },
        {
            id: 'status',
            header: 'Status',
            accessorFn: (r) => r.status ?? 'OPEN',
            cell: ({ row }) => {
                const status = row.original.status ?? 'OPEN';
                return (
                    <StatusBadge variant={STATUS_CLASS[status] ?? 'neutral'} data-testid={`risk-status-${row.original.id}`}>
                        {status}
                    </StatusBadge>
                );
            },
        },
        {
            id: 'owner',
            header: 'Owner',
            // Owner display preference: real user (name → email) →
            // legacy free-text `treatmentOwner` → em-dash. Keeping
            // both signals visible avoids the empty-cell footgun
            // when only one of the two is populated.
            accessorFn: (r) =>
                r.owner?.name ??
                r.owner?.email ??
                r.treatmentOwner ??
                '—',
            cell: ({ row }) => {
                const r = row.original;
                const display =
                    r.owner?.name ?? r.owner?.email ?? r.treatmentOwner ?? null;
                return (
                    <span
                        className="text-xs text-content-muted"
                        data-testid={`risk-owner-${r.id}`}
                    >
                        {display ?? <span className="text-content-subtle">—</span>}
                    </span>
                );
            },
        },
        {
            id: 'treatment',
            header: t.treatment,
            accessorFn: (r) => r.treatment || t.untreated,
            cell: ({ getValue }) => (
                <span className="text-xs">{getValue<string>()}</span>
            ),
        },
        {
            id: 'controls',
            header: t.controlsCol,
            accessorFn: (r) => r.controls?.length || 0,
            cell: ({ getValue }) => (
                <span className="text-xs">{getValue<number>()}</span>
            ),
        },
    ]), [t, getRiskLevel, matrixConfig]);

    return (
        <ListPageShell className="animate-fadeIn gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t.title}</Heading>
                        <p className="text-content-muted text-sm">{t.risksIdentified}</p>
                    </div>
                    <div className="flex gap-tight">
                        <Button variant="secondary" onClick={() => setView(view === 'register' ? 'heatmap' : 'register')}>
                            {view === 'register' ? t.heatmap : t.register}
                        </Button>
                        {permissions.canWrite && (
                            <>
                                <Link href={tenantHref('/risks/ai')} className={buttonVariants({ variant: 'secondary' })} id="ai-risk-btn">
                                    AI Assessment
                                </Link>
                                <Link href={tenantHref('/risks/import')} className={buttonVariants({ variant: 'secondary' })} id="risk-import-btn">
                                    Import
                                </Link>
                                <Button
                                    variant="primary"
                                    onClick={() => setIsCreateOpen(true)}
                                    id="new-risk-btn"
                                >
                                    {t.addRisk}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <Card className="text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => filterCtx.clearAll()}
                    >
                        <p className="text-xs text-content-muted uppercase tracking-wider">{t.totalRisks}</p>
                        <p className="text-3xl font-bold mt-2">{total}</p>
                    </Card>
                    <Card className="text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wider">{t.avgScore}</p>
                        <p className="text-3xl font-bold mt-2 text-content-warning">{avgScore}</p>
                    </Card>
                    <Card className="text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => filterCtx.set('status', 'OPEN')}
                    >
                        <p className="text-xs text-content-muted uppercase tracking-wider">{t.openRisks}</p>
                        <p className="text-3xl font-bold mt-2 text-content-success">{openCount}</p>
                    </Card>
                    <Card className="text-center">
                        <p className="text-xs text-content-muted uppercase tracking-wider">{t.overdueReviews}</p>
                        <p className="text-3xl font-bold mt-2 text-content-error">{overdueRisks.length}</p>
                    </Card>
                </div>

                <RisksFilterToolbar
                    risks={risks}
                    columnsDropdown={
                        <ColumnsDropdown
                            columns={riskColumnDropdown}
                            visibility={columnVisibility}
                            onChange={(v) => setColumnVisibility(v)}
                            defaultVisibility={defaultRiskVisibility}
                        />
                    }
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                {view === 'heatmap' ? (
                    <RiskMatrix
                        config={matrixConfig}
                        cells={matrixCells}
                        title={t.heatmapTitle}
                        mode="bubble"
                        onCellClick={(cell) => {
                            // Drill into the risks that share this
                            // (likelihood, impact) cell by setting the
                            // score range filter on the cell's score —
                            // single-score range collapses to the
                            // matching cell.
                            const score = cell.likelihood * cell.impact;
                            filterCtx.set('score', `${score}|${score}`);
                            setView('register');
                        }}
                    />
                ) : (
                    <DataTable<RiskListItem>
                        fillBody
                        data={risks}
                        columns={riskColumns}
                        loading={loading}
                        getRowId={(r) => r.id}
                        onRowClick={(row) => router.push(tenantHref(`/risks/${row.original.id}`))}
                        emptyState={
                            hasActive
                                ? 'No risks match your filters'
                                : t.noRisks
                        }
                        resourceName={(p) => p ? 'risks' : 'risk'}
                        columnVisibility={columnVisibility}
                        onColumnVisibilityChange={setColumnVisibility}
                        data-testid="risks-table"
                        className="hover:bg-bg-muted"
                    />
                )}
            </ListPageShell.Body>

            {permissions.canWrite && (
                <NewRiskModal
                    open={isCreateOpen}
                    setOpen={setIsCreateOpen}
                    tenantSlug={tenantSlug}
                    apiUrl={apiUrl}
                />
            )}
        </ListPageShell>
    );
}

// ─── Risks filter toolbar ────────────────────────────────────────────

function RisksFilterToolbar({
    risks,
    columnsDropdown,
}: {
    risks: RiskListItem[];
    columnsDropdown?: React.ReactNode;
}) {
    const filters: FilterType[] = useMemo(() => buildRiskFilters(risks), [risks]);
    return (
        <FilterToolbar
            filters={filters}
            searchId="risk-search"
            searchPlaceholder="Search risks…"
            actions={columnsDropdown}
        />
    );
}
