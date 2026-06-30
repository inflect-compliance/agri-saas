'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers/derived arrays recreated each render). The proper structural fix is wrapping parent-level callbacks in useCallback. Tracked as follow-up; existing per-line eslint-disable-next-line markers preserved. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { ownerDisplayName } from '@/lib/owner-display';
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
import { Tooltip } from '@/components/ui/tooltip';
import { AppIcon, type AppIconName } from '@/components/icons/AppIcon';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { buttonVariants } from '@/components/ui/button-variants';
import { EmptyState } from '@/components/ui/empty-state';
import {
    DataTable,
    createColumns,
    useColumnsDropdown,
    useBulkDelete,
} from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
    useFilterCardVisibility,
    type CardDefinition,
    type FilterType,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { TableLoadMoreFooter } from '@/components/ui/table-load-more-footer';
import { useThresholdLoadMore } from '@/components/ui/hooks';
import { AsidePanel } from '@/components/ui/aside-panel';
import { AiAssistRail } from '@/components/ui/ai-assist-rail';
import { Sparkle3 } from '@/components/ui/icons/nucleo/sparkle3';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import {
    buildRiskFilters,
    RISK_API_TRANSFORMS,
    RISK_FILTER_KEYS,
} from './filter-defs';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { resolveBandForScore } from '@/lib/risk-matrix/scoring';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { Plus } from '@/components/ui/icons/nucleo';
import { RiskScoreExplainer } from '@/components/RiskScoreExplainer';
import { resolveALE } from '@/app-layer/usecases/fair-calculator';
import { formatCompactCurrency } from '@/lib/risk-coherence';
import { formatTailAwareAle } from '@/lib/tail-language';
import { detectCellCollisions } from '@/lib/risk-collisions';
import { AleHistogram, type AleHistogramDatum } from '@/components/ui/charts';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useLocalStorage } from '@/components/ui/hooks';

/** RQ2-5 — resolved ALE for a list row (null = not quantified). */
function riskAle(r: RiskListItem): number | null {
    return resolveALE({
        fairAle: r.fairAle ?? null,
        sleAmount: r.sleAmount ?? null,
        aroAmount: r.aroAmount ?? null,
    });
}

interface RiskListItem {
    id: string;
    /** PR-B — RSK-N short identifier. Nullable for historic rows. */
    key?: string | null;
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
    /** B7 — unified linked-task counts (TaskLink RISK), supplied by listRisks. */
    taskTotal?: number;
    taskDone?: number;
    /** RQ2-5 — quant inputs for the ALE chip + matrix heat overlay. */
    sleAmount?: number | null;
    aroAmount?: number | null;
    fairAle?: number | null;
    /** RQ2-9 — decomposed residual dims for the movement view. */
    residualLikelihood?: number | null;
    residualImpact?: number | null;
    residualScore?: number | null;
}

interface RisksClientProps {
    initialRisks: RiskListItem[];
    initialFilters?: Record<string, string>;
    /**
     * Effective `RiskMatrixConfigShape` for this tenant (Epic 44.1).
     * Drives the score-column chip colour + the histogram band stacking.
     * Resolved server-side; the client never has to handle "no config".
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
        listDescription: string;
        risksIdentified: string;
        heatmap: string;
        histogram: string;
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

/**
 * Risk-quantification analytical views (RQ-3…RQ-10) surfaced as icon-only
 * links in the risks header, to the left of the matrix toggle. Each routes to
 * its standalone page; read-only so they show for every role.
 */
const RISK_VIEW_LINKS: ReadonlyArray<{ href: string; label: string; icon: AppIconName }> = [
    { href: '/risks/dashboard', label: 'Risk dashboard', icon: 'activity' },
    { href: '/risks/scenarios', label: 'Scenarios', icon: 'preview' },
    { href: '/risks/hierarchy', label: 'Hierarchy', icon: 'share' },
    { href: '/risks/kri', label: 'Key risk indicators', icon: 'alertCircle' },
    { href: '/risks/correlations', label: 'Correlations', icon: 'mappings' },
    // RQ3-6 — the loss-event register: forecasts meet reality.
    { href: '/risks/loss-events', label: 'Loss events', icon: 'fileWarning' },
    { href: '/risks/reports', label: 'Reports', icon: 'fileSpreadsheet' },
];

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
    // RQ3-4 — per-risk tail percentiles (RQ3-1 cache); failure-soft:
    // without a run the chips render the mean register.
    const [tailByRisk, setTailByRisk] = useState<Record<string, { aleMean: number; aleP90: number }> | null>(null);
    // RQ3-5 — the per-risk appetite cap draws on the histogram
    // (honest there: its x-axis IS per-risk ALE). Failure-soft.
    const [appetiteCap, setAppetiteCap] = useState<number | null>(null);
    useEffect(() => {
        fetch(`/api/t/${tenantSlug}/risk-appetite`)
            .then((r) => (r.ok ? r.json() : null))
             
            .then((d) => setAppetiteCap(d?.config?.singleRiskAleMax ?? null))
            .catch(() => setAppetiteCap(null));
    }, [tenantSlug]);

    useEffect(() => {
        fetch(`/api/t/${tenantSlug}/risks/tail-percentiles`)
            .then((r) => (r.ok ? r.json() : null))
             
            .then((d) => setTailByRisk(d?.snapshot?.byRisk ?? null))
            .catch(() => setTailByRisk(null));
    }, [tenantSlug]);
    // RQ3-5 — three register views, persisted per tenant (polish #13
    // localStorage pattern) so the histogram preference survives
    // navigation without leaking across tenants.
    const [rawView, setView] = useLocalStorage<'register' | 'histogram'>(
        `inflect:risks-view:${tenantSlug}`,
        'register',
    );
    // Normalise any legacy 'heatmap' value (the risk-matrix view was
    // removed) so the toggle + render always land on a valid view.
    const view: 'register' | 'histogram' =
        rawView === 'histogram' ? 'histogram' : 'register';

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

    const rawRisks = risksQuery.data?.rows ?? [];
    const truncated = risksQuery.data?.truncated ?? false;
    const loading = risksQuery.isLoading && !risksQuery.data;

    // Bulk-delete via the table selection action-row.
    const { batchAction: riskBulkDelete, dialog: riskDeleteDialog } =
        useBulkDelete<RiskListItem>({
            entitySingular: 'risk',
            entityPlural: 'risks',
            onDelete: async (riskIds) => {
                const res = await fetch(`/api/t/${tenantSlug}/risks/bulk/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ riskIds }),
                });
                if (!res.ok) throw new Error('Failed to delete risks');
                await risksQuery.mutate();
            },
        });

    // ─── PR-1: org-parity sortable headers ───
    const [sortBy, setSortBy] = useState<string | undefined>(undefined);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(
        undefined,
    );
    const risks = useMemo(() => {
        if (!sortBy) return rawRisks;
        const accessor = (r: RiskListItem): string | number => {
            switch (sortBy) {
                case 'title':
                    return r.title || '';
                case 'asset':
                    return r.asset?.name || '';
                case 'threat':
                    return r.threat || '';
                case 'inherentScore':
                    return r.inherentScore || 0;
                // RQ3-OB-B — ALE sortability. The risks list already
                // surfaces an ALE chip next to the score; making the
                // column sortable lets an analyst pivot a register
                // of 200 risks into "the ones the money points at".
                // Honest-null: un-quantified rows sort as -Infinity
                // so they cluster at the bottom on desc (where you
                // want them) and at the top on asc.
                case 'ale': {
                    const v = riskAle(r);
                    return v ?? -Infinity;
                }
                case 'treatment':
                    return r.treatment || '';
                case 'status':
                    return r.status || '';
                default:
                    return '';
            }
        };
        const dir = sortOrder === 'asc' ? 1 : -1;
        return [...rawRisks].sort((a, b) => {
            const av = accessor(a);
            const bv = accessor(b);
            if (av === bv) return 0;
            return av > bv ? dir : -dir;
        });
    }, [rawRisks, sortBy, sortOrder]);
    const sortableRiskColumns = useMemo(
        () => ['title', 'asset', 'threat', 'inherentScore', 'ale', 'treatment', 'status'],
        [],
    );

    // ─── PR-1: org-parity progressive disclosure ───
    const {
        visibleRows: visibleRisks,
        totalCount: totalRisksCount,
        hasMore: hasMoreRisks,
        loadMore: loadMoreRisks,
    } = useThresholdLoadMore(risks);

    // ─── Column visibility (Epic 52 / R10-PR6) ───
    // Pagination removed in favour of internal scroll inside the
    // table card (see ListPageShell.Body + DataTable fillBody).
    // All filtered rows render at once; the card scrolls.
    const riskColumns = useMemo(
        () => [
            // Code is off by default (toggle on via the gear). The column def
            // still leads (table-unification first-column rule); only its
            // default visibility is off.
            { id: 'code', label: 'Code', defaultVisible: false },
            { id: 'title', label: 'Title' },
            { id: 'asset', label: 'Asset' },
            { id: 'threat', label: 'Threat' },
            { id: 'inherentScore', label: 'Score' },
            { id: 'level', label: 'Level' },
            { id: 'status', label: 'Status' },
            { id: 'owner', label: 'Owner' },
            { id: 'treatment', label: 'Treatment' },
            { id: 'controls', label: 'Controls' },
            { id: 'tasks', label: 'Tasks' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        orderColumns,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:risks',
        columns: riskColumns,
    });

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

    // R23-PR-B — Typed KPI definitions consumed by useKpiFilter. The
    // hook derives the active card from current filter state, so the
    // "Open" KPI lights up automatically whenever status=OPEN is
    // applied (KPI click OR a status pill set via the dropdown). The
    // "Total" KPI is active when no filters are set — it's the
    // implicit default state.
    type RiskKpiId = 'total' | 'open';
    const kpiDefs: ReadonlyArray<KpiFilterDef<RiskKpiId>> = useMemo(
        () => [
            {
                // "Total" — its target state IS "no filters"; clearing
                // is the deactivation. The optional `clear` is omitted
                // so the hook falls back to ctx.clearAll().
                id: 'total',
                apply: (ctx) => ctx.clearAll(),
                isActive: (state) => Object.keys(state).length === 0,
            },
            {
                // "Open" — owns the `status` key only. PR-C `clear`
                // scopes teardown so toggling off doesn't disturb a
                // search query or sibling category/severity filter
                // the user may have layered on.
                id: 'open',
                apply: (ctx) => ctx.set('status', 'OPEN'),
                isActive: (state) =>
                    (state.status ?? []).includes('OPEN'),
                clear: (ctx) => ctx.removeAll('status'),
            },
        ],
        [],
    );
    const { activeKpiId, toggle: toggleKpi } = useKpiFilter(kpiDefs);

    // R-filter-gear (#3, 2026-06-07) — the gear controls the quantifiable
    // KPI cards (Total / Avg score / Open / Overdue), not filter categories.
    // The hook lives in the PARENT (where the KPI grid is); the gear is
    // threaded DOWN to RisksFilterToolbar's actions slot.
    const kpiCards: CardDefinition[] = useMemo(
        () => [
            { id: 'total', label: t.totalRisks, kind: 'kpi' },
            { id: 'avgScore', label: t.avgScore, kind: 'kpi' },
            { id: 'open', label: t.openRisks, kind: 'kpi' },
            { id: 'overdue', label: t.overdueReviews, kind: 'kpi' },
        ],
        [t],
    );
    const { visibleCards: visibleKpiCards, dropdown: filtersDropdown } =
        useFilterCardVisibility({
            storageKey: 'inflect:filter-vis:risks',
            cards: kpiCards,
        });

    // RQ3-5 — cell collisions (pure detector): same-matrix-cell risks
    // whose ALEs differ >10×. Flagged on the heatmap AND the histogram.
    const collisions = useMemo(
        () =>
            detectCellCollisions(
                risks.map((r) => ({
                    id: r.id,
                    title: r.title,
                    likelihood: r.likelihood,
                    impact: r.impact,
                    ale: riskAle(r),
                })),
            ),
        [risks],
    );

    // RQ3-5 — histogram data: each quantified risk with its tenant
    // band (the histogram stacks by the same colours the heatmap paints).
    const histogramData = useMemo<AleHistogramDatum[]>(() => {
        const out: AleHistogramDatum[] = [];
        for (const r of risks) {
            const ale = riskAle(r);
            if (ale == null || ale <= 0) continue;
            const band = resolveBandForScore(r.inherentScore, matrixConfig.bands);
            out.push({ id: r.id, title: r.title, ale, bandName: band.name, bandColor: band.color });
        }
        return out;
    }, [risks, matrixConfig]);

    // RQ2-10 — the Level column reads the TENANT'S OWN bands (the
    // same resolveBandForScore the score chip, matrix, and explainer
    // use) instead of a second hardcoded threshold set that drifted
    // from the configured matrix.
    const getRiskBand = useCallback(
        (score: number) => resolveBandForScore(score, matrixConfig.bands),
        [matrixConfig.bands],
    );

    // Workflow-status variants (Epic 44.4). The label set mirrors
    // `RiskStatus` in the schema. Audit S1 (2026-05-24) added
    // `MITIGATED` — controls implemented, residual accepted (distinct
    // from CLOSED which means risk eliminated).
    const STATUS_CLASS: Record<string, StatusBadgeVariant> = {
        OPEN: 'warning',
        MITIGATING: 'info',
        MITIGATED: 'success',
        ACCEPTED: 'neutral',
        CLOSED: 'success',
    };

    // ── Column Definitions ──
    const riskTableColumns = useMemo(() => createColumns<RiskListItem>([
        {
            // PR-B — Code column (RSK-N). The Risk list now opens
            // with the scannable per-tenant key, matching the
            // Controls/Tasks convention. Historic rows render an
            // em-dash; new rows mint a key in the create-path.
            id: 'code',
            header: 'Code',
            accessorFn: (r) => r.key || '',
            cell: ({ row }) =>
                row.original.key ? (
                    <span className="font-mono text-xs text-content-muted tabular-nums">
                        {row.original.key}
                    </span>
                ) : (
                    <span className="text-content-subtle">—</span>
                ),
        },
        {
            accessorKey: 'title',
            header: t.riskTitle,
            cell: ({ row, getValue }) => (
                // B2 — match the Controls table standard: the title
                // cell is a `<Link>` so single-click on the title
                // navigates while double-click on the row (handled
                // by DataTable) does the same. Pre-B2 the risks
                // table rendered the title as plain text, leaving
                // navigation only on double-click — inconsistent
                // with the canonical Controls behaviour.
                <TableTitleCell
                    href={tenantHref(`/risks/${row.original.id}`)}
                    id={`risk-link-${row.original.id}`}
                >
                    {getValue<string>()}
                </TableTitleCell>
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
                    // RQ2-3 — every score chip explains itself; the
                    // popover lazy-fetches on open (no per-row cost).
                    <span className="inline-flex items-center gap-tight">
                        <RiskScoreExplainer tenantSlug={tenantSlug} riskId={row.original.id} label={`${score} · ${band.name}`}>
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
                        </RiskScoreExplainer>
                        {/* RQ2-5 / RQ3-4 — qual ↔ quant side by
                            side: quantified rows carry the compact
                            tail register beside the score chip
                            ("€120K · bad yr €1.4M" when the RQ3-1
                            cache has tails; the bare mean otherwise). */}
                        {(() => {
                            const ale = riskAle(row.original);
                            const label = formatTailAwareAle(
                                ale,
                                tailByRisk?.[row.original.id]?.aleP90 ?? null,
                                { money: formatCompactCurrency, compact: true },
                            );
                            return label !== null ? (
                                <span
                                    className="text-[10px] tabular-nums text-content-muted"
                                    title="Annualised loss expectancy"
                                    data-testid={`risk-ale-${row.original.id}`}
                                >
                                    {label}
                                </span>
                            ) : null;
                        })()}
                    </span>
                );
            },
        },
        {
            id: 'level',
            header: t.level,
            accessorFn: (r) => r.inherentScore,
            cell: ({ getValue }) => {
                const band = getRiskBand(getValue<number>());
                // polish #9 — denser dot+name renders faster than the
                // old StatusBadge; the Epic 56 Tooltip carries the
                // score range so the band → range mapping reads on
                // hover/focus without leaving the row.
                return (
                    <Tooltip content={`${band.name} · score ${band.minScore}–${band.maxScore}`}>
                        <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-content-default cursor-help"
                            data-band={band.name}
                        >
                            <span
                                aria-hidden="true"
                                className="inline-block w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: band.color }}
                            />
                            {band.name}
                        </span>
                    </Tooltip>
                );
            },
        },
        {
            // RQ3-OB-B — dedicated ALE column. The inline chip next
            // to the score (above) keeps the qual↔quant side-by-side
            // (RQ2-5 / RQ3-4); THIS column adds sortability — a
            // 200-row register pivots to "the ones the money points
            // at" via the column header.
            id: 'ale',
            header: 'ALE',
            accessorFn: (r) => riskAle(r) ?? null,
            cell: ({ getValue }) => {
                const ale = getValue<number | null>();
                return ale !== null ? (
                    <span className="text-xs tabular-nums text-content-muted">
                        {formatCompactCurrency(ale)}
                    </span>
                ) : (
                    <span className="text-xs text-content-subtle">—</span>
                );
            },
        },
        {
            id: 'status',
            header: 'Status',
            accessorFn: (r) => r.status ?? 'OPEN',
            cell: ({ row }) => {
                const status = row.original.status ?? 'OPEN';
                return (
                    <StatusBadge variant={STATUS_CLASS[status] ?? 'neutral'} size="sm" data-testid={`risk-status-${row.original.id}`}>
                        {status}
                    </StatusBadge>
                );
            },
        },
        {
            id: 'owner',
            header: 'Owner',
            // Owner display: name (or email local-part as a username) →
            // legacy free-text `treatmentOwner` → em-dash. The full email is
            // intentionally NOT shown; it stays on the row for the owner filter.
            accessorFn: (r) =>
                ownerDisplayName(r.owner?.name, r.owner?.email) ??
                r.treatmentOwner ??
                '—',
            cell: ({ row }) => {
                const r = row.original;
                const display =
                    ownerDisplayName(r.owner?.name, r.owner?.email) ?? r.treatmentOwner ?? null;
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
        {
            // B7 — unified linked-task count (done/total), matching Controls.
            id: 'tasks',
            header: 'Tasks',
            accessorFn: (r) => `${r.taskDone ?? 0}/${r.taskTotal ?? 0}`,
            cell: ({ row }) => {
                const total = row.original.taskTotal ?? 0;
                const done = row.original.taskDone ?? 0;
                return (
                    <span
                        className={
                            total > 0 && done === total
                                ? 'text-content-success text-xs'
                                : 'text-content-muted text-xs'
                        }
                    >
                        {done}/{total}
                    </span>
                );
            },
        },
    ]), [t, getRiskBand, matrixConfig, tailByRisk]);

    // Right-rail Phase 3 — the AI assist co-pilot rail. A persistent,
    // co-resident entry point to the AI risk-assessment flow that
    // follows the user across the register. Gated on write permission
    // (the AI flow itself requires `risks.create`); `defaultCollapsed`
    // so it lands as a quiet 44px spine, not a 320px land-grab — the
    // user expands it when they want to engage.
    const aiAssistRail = permissions.canWrite ? (
        <AsidePanel
            title="AI Assist"
            surfaceKey="risks-list"
            defaultCollapsed
            icon={<Sparkle3 className="h-4 w-4" />}
        >
            <AiAssistRail aiHref={tenantHref('/risks/ai')} />
        </AsidePanel>
    ) : undefined;

    return (
        <ListPageShell className="animate-fadeIn gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t.title}</Heading>
                        {t.listDescription && (
                            <p className="text-sm text-content-muted mt-1">{t.listDescription}</p>
                        )}
                    </div>
                    <div className="flex gap-tight">
                        {RISK_VIEW_LINKS.map((v) => (
                            <Tooltip key={v.href} content={v.label}>
                                <Link
                                    href={tenantHref(v.href)}
                                    aria-label={v.label}
                                    className={buttonVariants({ variant: 'secondary', size: 'icon' })}
                                >
                                    <AppIcon name={v.icon} size={16} />
                                </Link>
                            </Tooltip>
                        ))}
                        {/* RQ3-5 — three peer register views. The
                            choice persists (polish #13 pattern). */}
                        <ToggleGroup
                            size="sm"
                            ariaLabel="Risks view"
                            options={[
                                { value: 'register', label: t.register, id: 'risks-view-register' },
                                { value: 'histogram', label: t.histogram, id: 'risks-view-histogram' },
                            ]}
                            selected={view}
                            selectAction={(v) => setView(v as 'register' | 'histogram')}
                        />
                        {permissions.canWrite && (
                            <>
                                <Tooltip content="Import risks">
                                    <Link href={tenantHref('/risks/import')} aria-label="Import risks" className={buttonVariants({ variant: 'secondary', size: 'icon' })} id="risk-import-btn">
                                        <AppIcon name="upload" size={16} />
                                    </Link>
                                </Tooltip>
                                <Button
                                    variant="primary"
                                    icon={<Plus className="-ml-0.5 -mr-2.5" />}
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
                {/* KPI Cards — R23-PR-A: KpiFilterCard primitive. The
                    Risks page is the first consumer of the shared
                    primitive; later R23 PRs roll it out to Assets,
                    Controls, Tasks, Evidence, Policies, Vendors. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    {visibleKpiCards.map((card) => {
                        const cfg: Record<
                            string,
                            {
                                value: React.ReactNode;
                                tone?:
                                    | 'success'
                                    | 'attention'
                                    | 'critical'
                                    | 'default';
                                kpi?: RiskKpiId;
                            }
                        > = {
                            total: { value: total, kpi: 'total' },
                            avgScore: { value: avgScore, tone: 'attention' },
                            open: {
                                value: openCount,
                                tone: 'success',
                                kpi: 'open',
                            },
                            overdue: {
                                value: overdueRisks.length,
                                tone:
                                    overdueRisks.length > 0
                                        ? 'critical'
                                        : 'success',
                            },
                        };
                        const c = cfg[card.id];
                        if (!c) return null;
                        const kpiId = c.kpi;
                        return (
                            <KpiFilterCard
                                key={card.id}
                                label={card.label}
                                value={c.value}
                                tone={c.tone}
                                onClick={
                                    kpiId ? () => toggleKpi(kpiId) : undefined
                                }
                                selected={
                                    kpiId ? activeKpiId === kpiId : undefined
                                }
                            />
                        );
                    })}
                </div>

                <RisksFilterToolbar
                    risks={risks}
                    columnsDropdown={columnsDropdown}
                    filtersDropdown={filtersDropdown}
                />
            </ListPageShell.Filters>

            <ListPageShell.Body aside={aiAssistRail}>
                <TruncationBanner truncated={truncated} />
                {view === 'histogram' ? (
                    <div className="space-y-default" data-testid="risk-histogram-view">
                        <div>
                            <Heading level={3} className="mb-1">ALE histogram</Heading>
                            <p className="mb-tight text-xs text-content-subtle">
                                Each quantified risk lands in a log-scale loss bucket,
                                stacked by its matrix band — the distribution the
                                heatmap structurally compresses.
                            </p>
                            <AleHistogram
                                data={histogramData}
                                referenceLine={
                                    appetiteCap != null
                                        ? { value: appetiteCap, label: 'Per-risk appetite' }
                                        : null
                                }
                                testId="risk-ale-histogram"
                            />
                            {histogramData.length === 0 && (
                                <p className="text-sm text-content-muted">
                                    No quantified risks yet — set FAIR ranges or SLE × ARO
                                    on a risk to populate the histogram.
                                </p>
                            )}
                        </div>
                        {/* RQ3-5 — range-compression callouts: the
                            same collisions the heatmap flags, spelled
                            out. Click drills into the cell's risks. */}
                        {collisions.length > 0 && (
                            <div data-testid="risk-collision-callouts">
                                <Heading level={3} className="mb-1">Cell collisions</Heading>
                                <p className="mb-tight text-xs text-content-subtle">
                                    Risks sharing a matrix cell whose loss estimates differ
                                    more than 10× — the matrix cannot show the difference.
                                </p>
                                <div className="space-y-tight">
                                    {collisions.map((c) => (
                                        <button
                                            key={`${c.likelihood}-${c.impact}`}
                                            type="button"
                                            className="flex w-full items-center justify-between gap-default rounded p-2 text-left text-sm hover:bg-bg-muted/50 transition-colors duration-100 ease-out"
                                            data-testid={`risk-collision-${c.likelihood}-${c.impact}`}
                                            onClick={() => {
                                                const score = c.likelihood * c.impact;
                                                filterCtx.set('score', `${score}|${score}`);
                                                setView('register');
                                            }}
                                        >
                                            <span className="truncate text-content-emphasis">
                                                L{c.likelihood}×I{c.impact}: {c.minRisk.title} vs {c.maxRisk.title}
                                            </span>
                                            <span className="shrink-0 tabular-nums text-content-muted">
                                                {formatCompactCurrency(c.minRisk.ale)} vs {formatCompactCurrency(c.maxRisk.ale)} (~{Math.round(c.ratio)}×)
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <DataTable<RiskListItem>
                        fillBody
                        data={visibleRisks}
                        columns={orderColumns(riskTableColumns)}
                        loading={loading}
                        getRowId={(r) => r.id}
                        batchActions={permissions.canAdmin ? [riskBulkDelete] : undefined}
                        sortableColumns={sortableRiskColumns}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSortChange={({
                            sortBy: nextBy,
                            sortOrder: nextOrder,
                        }) => {
                            setSortBy(nextBy);
                            setSortOrder(nextOrder);
                        }}
                        onRowClick={(row) => router.push(tenantHref(`/risks/${row.original.id}`))}
                        emptyState={
                            hasActive ? (
                                <EmptyState
                                    size="sm"
                                    variant="no-results"
                                    title="No risks match your filters"
                                    description="Try widening your search or clearing one of the active filters."
                                    secondaryAction={{
                                        label: 'Clear filters',
                                        onClick: () => filterCtx.clearAll(),
                                    }}
                                />
                            ) : (
                                <EmptyState
                                    size="sm"
                                    variant="no-records"
                                    title={t.noRisks}
                                    description="Identify a threat, score its likelihood × impact, and link the controls that mitigate it."
                                    primaryAction={{
                                        label: 'Create risk',
                                        onClick: () => setIsCreateOpen(true),
                                    }}
                                />
                            )
                        }
                        resourceName={(p) => p ? 'risks' : 'risk'}
                        columnVisibility={columnVisibility}
                        onColumnVisibilityChange={setColumnVisibility}
                        data-testid="risks-table"
                        className="hover:bg-bg-muted"
                    />
                )}
                {/* PR-1 — org-parity load-more footer. */}
                <TableLoadMoreFooter
                    hasMore={hasMoreRisks}
                    visibleCount={visibleRisks.length}
                    totalCount={totalRisksCount}
                    onLoadMore={loadMoreRisks}
                    resourceName="risks"
                    testId="tenant-risks-load-more"
                />
            </ListPageShell.Body>

            {permissions.canWrite && (
                <NewRiskModal
                    open={isCreateOpen}
                    setOpen={setIsCreateOpen}
                    tenantSlug={tenantSlug}
                    apiUrl={apiUrl}
                />
            )}
            {riskDeleteDialog}
        </ListPageShell>
    );
}

// ─── Risks filter toolbar ────────────────────────────────────────────

function RisksFilterToolbar({
    risks,
    columnsDropdown,
    filtersDropdown,
}: {
    risks: RiskListItem[];
    columnsDropdown?: React.ReactNode;
    filtersDropdown?: React.ReactNode;
}) {
    // R-filter-gear (#3): the KPI-card gear is built in the PARENT (it
    // controls the parent's KPI grid) and threaded in here; this toolbar
    // shows the FULL filter defs.
    const filters: FilterType[] = useMemo(() => buildRiskFilters(risks), [risks]);
    return (
        <FilterToolbar
            filters={filters}
            searchId="risks-search"
            searchPlaceholder="Search risks…"
            actions={<>{columnsDropdown}{filtersDropdown}</>}
        />
    );
}
