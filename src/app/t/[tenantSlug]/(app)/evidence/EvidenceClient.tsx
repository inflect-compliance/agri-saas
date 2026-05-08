'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantMutation } from '@/lib/hooks/use-tenant-mutation';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { useUrlFilters } from '@/lib/hooks/useUrlFilters';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
// Both evidence modals were previously lazy-loaded via next/dynamic,
// but the JIT race in `next dev` made the modals occasionally fail to
// mount in serial-mode E2E runs (Playwright clicked the trigger before
// the chunk finished compiling). Static imports — the bundle cost is
// acceptable and the E2E suite becomes deterministic.
import { UploadEvidenceModal } from './UploadEvidenceModal';
import { NewEvidenceTextModal } from './NewEvidenceTextModal';
import { EvidenceBulkImportModal } from './EvidenceBulkImportModal';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import {
    ColumnsDropdown,
    DataTable,
    createColumns,
    getDefaultVisibility,
} from '@/components/ui/table';
import { useColumnVisibility } from '@/components/ui/hooks';
import { Tooltip } from '@/components/ui/tooltip';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
    type FilterType,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import {
    FileTypeIcon,
    resolveFileTypeIcon,
} from '@/components/ui/file-type-icon';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { EvidenceGallery } from '@/components/ui/EvidenceGallery';
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useCelebration } from '@/components/ui/hooks';
import { MILESTONES } from '@/lib/celebrations';
import { isAllEvidenceCurrent } from '@/lib/evidence-freshness';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import {
    buildEvidenceFilters,
    EVIDENCE_FILTER_KEYS,
} from './filter-defs';

interface Permissions {
    canRead: boolean;
    canWrite: boolean;
    canAdmin: boolean;
    canAudit: boolean;
    canExport: boolean;
}

const STATUS_BADGE: Record<string, string> = {
    DRAFT: 'badge-neutral', SUBMITTED: 'badge-info', APPROVED: 'badge-success', REJECTED: 'badge-danger',
    PENDING_UPLOAD: 'badge-info',
};

type RetentionFilter = 'active' | 'expiring' | 'archived';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRetentionStatus(ev: any, now: Date | null): { label: string; badge: string; icon: string } {
    if (ev.isArchived) return { label: 'Archived', badge: 'badge-neutral', icon: '' };
    if (ev.expiredAt) return { label: 'Expired', badge: 'badge-danger', icon: '' };
    if (ev.retentionUntil) {
        if (!now) return { label: 'Active', badge: 'badge-success', icon: '' };
        const until = new Date(ev.retentionUntil);
        const daysLeft = Math.ceil((until.getTime() - now.getTime()) / 86_400_000);
        if (daysLeft <= 0) return { label: 'Expired', badge: 'badge-danger', icon: '' };
        if (daysLeft <= 30) return { label: `Expiring (${daysLeft}d)`, badge: 'badge-warning', icon: '' };
        return { label: 'Active', badge: 'badge-success', icon: '' };
    }
    return { label: 'No policy', badge: 'badge-neutral', icon: '—' };
}

interface EvidenceClientProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialEvidence: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialControls: any[];
    tenantSlug: string;
    permissions: Permissions;
    translations: Record<string, string>;
}

/**
 * Client island for evidence — handles all interactive features.
 * Data arrives pre-fetched from the server component, hydrated into React Query.
 *
 * Filter architecture (Epic 53):
 *   - `q`, `type`, `status`, `controlId` flow through `useFilterContext`
 *     (URL-synced via the shared context).
 *   - `tab` (retention view: active | expiring | archived) stays on
 *     `useUrlFilters` since it's a view selector, not a filter.
 */
export function EvidenceClient(props: EvidenceClientProps) {
    const filterCtx = useFilterContext([], EVIDENCE_FILTER_KEYS, {});
    return (
        <FilterProvider value={filterCtx}>
            <EvidencePageInner {...props} />
        </FilterProvider>
    );
}

function EvidencePageInner({ initialEvidence, initialControls, tenantSlug, permissions, translations: t }: EvidenceClientProps) {
    // Stabilise across renders so dependent useCallbacks don't get a
    // fresh identity every cycle (was a real exhaustive-deps warning).
    const apiUrl = useCallback(
        (path: string) => `/api/t/${tenantSlug}${path}`,
        [tenantSlug],
    );
    const { mutate: swrMutate } = useSWRConfig();

    // Retention-tab + view-mode selectors — deliberately kept separate from filter state.
    // `tab`: active | expiring | archived. `view`: list | gallery.
    // Both URL-synced so a refresh / back-button preserves the page
    // shape, and toggling the view doesn't clobber the active filters
    // (filter state lives in `filterCtx`, not in `useUrlFilters`).
    const { filters, setFilter } = useUrlFilters(['tab', 'view']);
    const filterCtx = useFilters();
    const { state, search, hasActive } = filterCtx;

    // ─── Build the API query string from filter state + retention tab ───
    const fetchParams = useMemo(() => {
        const params = toApiSearchParams(state, { search });
        if (filters.tab === 'archived') params.set('archived', 'true');
        else if (filters.tab === 'expiring') params.set('expiring', 'true');
        return params;
    }, [state, search, filters.tab]);

    // ─── Epic 69 — SWR-first read for the evidence list ───
    //
    // Each filter combo gets its own cache entry via the
    // query-string suffix on the SWR key. The unfiltered baseline
    // is the registry's `list()`. Server-rendered initialEvidence
    // lands as `fallbackData` only when no filters / retention tab
    // is active — otherwise the hook fires a fresh request, mirroring
    // the prior "skip initialData when filters diverge" semantics.
    const anyFilterActive = hasActive || !!filters.tab;
    const evidenceKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs
            ? `${CACHE_KEYS.evidence.list()}?${qs}`
            : CACHE_KEYS.evidence.list();
    }, [fetchParams]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // PR-5 — API returns `{ rows, truncated }`; the Client pulls
    // `rows` for the table and `truncated` for the banner. SSR
    // initial wraps with `truncated: false` (cap is 5000, SSR cap is
    // 100, so the SSR slice never trips truncation by itself).
    const evidenceQuery = useTenantSWR<CappedList<any>>(evidenceKey, {
        fallbackData: anyFilterActive
            ? undefined
            : { rows: initialEvidence, truncated: false },
    });
    const truncated = evidenceQuery.data?.truncated ?? false;

    // Stabilise the array identity across renders so dependent hooks
    // (`useEffect` at line ~330 reads `evidence`) don't re-fire on
    // every render. Without the `useMemo` the `?? []` produces a new
    // empty array instance every cycle. eslint-disable for the inner
    // `any[]`; tightening the type is a separate cleanup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evidence: any[] = useMemo(
        () => evidenceQuery.data?.rows ?? [],
        [evidenceQuery.data],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [controls] = useState<any[]>(initialControls);
    const retentionFilter = (filters.tab || 'active') as RetentionFilter;
    const { celebrate } = useCelebration();
    const viewMode: 'list' | 'gallery' =
        filters.view === 'gallery' ? 'gallery' : 'list';
    const [showUpload, setShowUpload] = useState(false);
    const [showTextForm, setShowTextForm] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(false);

    // Retention edit state
    const [editingRetention, setEditingRetention] = useState<string | null>(null);
    const [editRetentionDate, setEditRetentionDate] = useState('');

    // Invalidate every cached evidence-list filter variant. SWR's
    // function-form `mutate()` matches by absolute URL prefix —
    // every key under `/api/t/{slug}/evidence` (with or without
    // query string) gets a background refetch.
    const invalidateEvidence = useCallback(() => {
        const evidenceUrlPrefix = apiUrl(CACHE_KEYS.evidence.list());
        return swrMutate(
            (key) =>
                typeof key === 'string' &&
                (key === evidenceUrlPrefix ||
                    key.startsWith(`${evidenceUrlPrefix}?`)),
            undefined,
            { revalidate: true },
        );
    }, [apiUrl, swrMutate]);

    // ─── Mutation: review workflow (Epic 69 — useTenantMutation) ───
    //
    // Migrated from React Query's `useMutation` + `onMutate` /
    // `onError` rollback hooks. The optimistic update flips the
    // matching row's status synchronously; SWR's `rollbackOnError`
    // default restores the prior list on failure. After success
    // SWR revalidates the current key, and `invalidateEvidence()`
    // fans out to sibling filter variants.
    // PR-5 — cache value is `CappedList<any>` (the API returns
    // `{ rows, truncated }`); preserve `truncated` and only rewrite `rows`.
    const reviewMutation = useTenantMutation<CappedList<any>, { id: string; action: string; comment: string }, unknown>({
        key: evidenceKey,
        mutationFn: async ({ id, action, comment }) => {
            const res = await fetch(apiUrl(`/evidence/${id}/review`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, comment }),
            });
            if (!res.ok) throw new Error('Review action failed');
            return res.json().catch(() => null);
        },
        optimisticUpdate: (current, { id, action }) => {
            const newStatus =
                action === 'SUBMITTED'
                    ? 'SUBMITTED'
                    : action === 'APPROVED'
                        ? 'APPROVED'
                        : 'REJECTED';
            const rows = (current?.rows ?? []).map((ev: any) =>
                ev.id === id ? { ...ev, status: newStatus } : ev,
            );
            return { rows, truncated: current?.truncated ?? false };
        },
    });

    const submitReview = (id: string, action: string, comment = '') => {
        reviewMutation.trigger({ id, action, comment }).catch(() => {
            /* rollback already applied by the hook */
        }).finally(() => {
            // Fan out to sibling filter variants for completeness —
            // status flips affect the "approved-only" / "rejected-
            // only" filter views which the primary key revalidation
            // doesn't cover.
            invalidateEvidence();
        });
    };

    // ─── Retention actions ─────────────────────────────────────────

    const archiveEvidence = async (id: string) => {
        const res = await fetch(apiUrl(`/evidence/${id}/archive`), { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            alert(err?.error?.message || 'Failed to archive evidence');
            return;
        }
        invalidateEvidence();
    };

    const unarchiveEvidence = async (id: string) => {
        const res = await fetch(apiUrl(`/evidence/${id}/unarchive`), { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            alert(err?.error?.message || 'Failed to unarchive evidence');
            return;
        }
        invalidateEvidence();
    };

    const saveRetention = async (id: string) => {
        await fetch(apiUrl(`/evidence/${id}/retention`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                retentionUntil: editRetentionDate ? new Date(editRetentionDate).toISOString() : null,
                retentionPolicy: editRetentionDate ? 'FIXED_DATE' : 'NONE',
            }),
        });
        setEditingRetention(null);
        setEditRetentionDate('');
        invalidateEvidence();
    };

    const statusLabel = (status: string) => {
        const map: Record<string, string> = { DRAFT: t.draft, SUBMITTED: t.submitted, APPROVED: t.approved, REJECTED: t.rejected, PENDING_UPLOAD: 'Uploading...' };
        return map[status] || status;
    };

    // ─── Retention filter counts ───
    // Null on SSR + first client render so the "Expiring" count matches
    // exactly across hydration (avoids React #418/#422).
    const hydratedNow = useHydratedNow();

    const activeEvidence = evidence.filter(ev => !ev.isArchived && !ev.expiredAt && !ev.deletedAt);
    const expiringEvidence = hydratedNow ? evidence.filter(ev => {
        if (ev.isArchived || ev.deletedAt) return false;
        if (!ev.retentionUntil) return false;
        const until = new Date(ev.retentionUntil);
        const in30Days = new Date(hydratedNow.getTime() + 30 * 86_400_000);
        return until <= in30Days && until > hydratedNow;
    }) : [];
    const archivedEvidence = evidence.filter(ev => ev.isArchived || ev.expiredAt);

    // ─── Filtered evidence list (respects the active retention tab) ───
    const displayEvidence = retentionFilter === 'archived'
        ? archivedEvidence
        : retentionFilter === 'expiring'
            ? expiringEvidence
            : activeEvidence;

    // Epic 62 — celebrate when every active evidence row is fresh.
    // Gates that suppress false positives:
    //   - hydratedNow set (skips SSR / first-render race)
    //   - default 'active' retention tab + no other filters
    //   - query has actually loaded data at least once
    // Session dedupe in `useCelebration` prevents repeat fires across
    // refreshes / re-renders.
    useEffect(() => {
        if (!hydratedNow) return;
        if (retentionFilter !== 'active') return;
        if (anyFilterActive) return;
        if (evidenceQuery.isLoading) return;
        if (!isAllEvidenceCurrent(evidence, { now: hydratedNow })) return;
        const def = MILESTONES['evidence-all-current'];
        celebrate({
            preset: def.preset,
            key: def.key,
            message: def.message,
            description: def.description,
        });
    }, [
        evidence,
        hydratedNow,
        retentionFilter,
        anyFilterActive,
        evidenceQuery.isLoading,
        celebrate,
    ]);

    // ─── Column visibility (Epic 52) ───
    // Pagination removed — internal scroll inside the table card
    // (ListPageShell.Body + DataTable fillBody) shows all rows.
    const evidenceColumnConfig = useMemo(
        () => ({
            all: ['title', 'type', 'control', 'retention', 'freshness', 'status', 'owner', 'actions'],
            defaultVisible: ['title', 'type', 'control', 'retention', 'freshness', 'status', 'owner', 'actions'],
            fixed: ['actions'],
        }),
        [],
    );
    const { columnVisibility, setColumnVisibility } = useColumnVisibility(
        'inflect:col-vis:evidence',
        evidenceColumnConfig,
    );
    const defaultEvidenceVisibility = useMemo(
        () => getDefaultVisibility(evidenceColumnConfig),
        [evidenceColumnConfig],
    );
    const evidenceColumnDropdown = useMemo(
        () => [
            { id: 'title', label: 'Title' },
            { id: 'type', label: 'Type' },
            { id: 'control', label: 'Control' },
            { id: 'retention', label: 'Retention' },
            { id: 'freshness', label: 'Freshness' },
            { id: 'status', label: 'Status' },
            { id: 'owner', label: 'Owner' },
            { id: 'actions', label: 'Actions', alwaysVisible: true },
        ],
        [],
    );

    // ── Evidence Column Definitions ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evidenceColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: t.evidenceTitle,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                return (
                    <div className="flex items-center gap-2 min-w-0">
                        <FileTypeIcon
                            fileName={ev.fileName ?? null}
                            mime={ev.fileRecord?.mimeType ?? null}
                            domainKind={ev.type ?? null}
                            size={16}
                            data-testid={`evidence-row-icon-${ev.id}`}
                        />
                        <div className="min-w-0">
                            <div className="font-medium text-content-emphasis text-sm truncate">{ev.title}</div>
                            {ev.fileName && ev.fileName !== ev.title && (
                                <div className="text-xs text-content-subtle truncate">{ev.fileName}</div>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: 'type',
            header: t.type,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                // Mixed-file aware: pick the actual file kind by
                // extension/MIME when this row is a file; fall back to
                // the domain kind (LINK / TEXT) for non-file rows.
                const match = resolveFileTypeIcon(
                    ev.fileName ?? null,
                    ev.fileRecord?.mimeType ?? null,
                    ev.type ?? null,
                );
                return (
                    <span
                        className="inline-flex items-center gap-1.5 text-xs text-content-muted"
                        data-file-kind={match.label.toLowerCase()}
                    >
                        <match.Icon
                            size={14}
                            className={match.colorClass}
                            aria-hidden
                        />
                        <span>{match.label}</span>
                    </span>
                );
            },
        },
        {
            id: 'control',
            header: t.control,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accessorFn: (ev: any) => ev.control ? `${ev.control.annexId || ''} ${ev.control.name}` : '\u2014',
            cell: ({ getValue }: { getValue: () => string }) => (
                <span className="text-xs text-content-muted">{getValue()}</span>
            ),
        },
        {
            id: 'retention',
            header: 'Retention',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                const rs = getRetentionStatus(ev, hydratedNow);
                return (
                    <div className="text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className={`badge ${rs.badge}`} id={`retention-status-${ev.id}`}>
                                {rs.icon} {rs.label}
                            </span>
                        </div>
                        {ev.retentionUntil && !ev.isArchived && (
                            <TimestampTooltip
                                date={ev.retentionUntil}
                                className="text-content-subtle mt-0.5 block"
                                data-testid={`evidence-row-retention-date-${ev.id}`}
                            />
                        )}
                        {editingRetention === ev.id && (
                            <div className="mt-2 flex gap-1 items-center">
                                {/*
                                  Epic 58 — inline retention edit now
                                  uses the shared DatePicker. The
                                  surrounding YMD-string state stays
                                  unchanged so `saveRetention()` keeps
                                  the existing retention API contract.
                                */}
                                <DatePicker
                                    id={`retention-edit-${ev.id}`}
                                    className="w-36 text-xs"
                                    placeholder="Pick date"
                                    clearable
                                    align="start"
                                    value={parseYMD(editRetentionDate)}
                                    onChange={(next) => {
                                        setEditRetentionDate(
                                            toYMD(next) ?? '',
                                        );
                                    }}
                                    disabledDays={{
                                        before: startOfUtcDay(new Date()),
                                    }}
                                    aria-label="Retention date"
                                />
                                <Button variant="primary" size="sm" className="text-xs py-0.5 px-1.5" onClick={() => saveRetention(ev.id)}>Save</Button>
                                <Tooltip content="Cancel edit" shortcut="Esc">
                                    <Button variant="secondary" size="sm" className="text-xs py-0.5 px-1.5" onClick={() => setEditingRetention(null)} aria-label="Cancel">×</Button>
                                </Tooltip>
                            </div>
                        )}
                    </div>
                );
            },
            meta: { disableTruncate: true },
        },
        {
            id: 'freshness',
            header: 'Freshness',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                // `lastRefreshedAt` is not yet a discrete column on
                // Evidence — `updatedAt` is the closest existing
                // signal (any review action / metadata edit / archive
                // toggle bumps it). Wrapping it in the FreshnessBadge
                // here keeps the page semantic in sync with the
                // Epic 43 spec without forcing a schema migration.
                return (
                    <FreshnessBadge
                        lastRefreshedAt={ev.updatedAt ?? ev.dateCollected ?? null}
                        now={hydratedNow}
                        compact
                        data-testid={`evidence-row-freshness-${ev.id}`}
                    />
                );
            },
            meta: { disableTruncate: true },
        },
        {
            accessorKey: 'status',
            header: t.status,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                return <span className={`badge ${STATUS_BADGE[ev.status]}`}>{statusLabel(ev.status)}</span>;
            },
        },
        {
            id: 'owner',
            header: t.ownerLabel,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accessorFn: (ev: any) => ev.owner || '\u2014',
            cell: ({ getValue }: { getValue: () => string }) => (
                <span className="text-xs">{getValue()}</span>
            ),
        },
        {
            id: 'actions',
            header: t.actions,
            enableHiding: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ row }: { row: any }) => {
                const ev = row.original;
                const isPending = ev.id?.startsWith('temp:');
                if (isPending) return <span className="text-xs text-content-subtle">Uploading...</span>;
                return (
                    <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                        {ev.type === 'FILE' && ev.fileRecordId && (
                            <a href={apiUrl(`/evidence/files/${ev.fileRecordId}/download`)} download className={buttonVariants({ variant: 'secondary', size: 'sm' })} id={`download-${ev.id}`}>⬇</a>
                        )}
                        {permissions.canWrite && !ev.isArchived && (
                            <Tooltip content="Edit retention date">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => { setEditingRetention(ev.id); setEditRetentionDate(ev.retentionUntil ? ev.retentionUntil.split('T')[0] : ''); }}
                                    id={`edit-retention-${ev.id}`}
                                >
                                    Edit
                                </Button>
                            </Tooltip>
                        )}
                        {permissions.canWrite && !ev.isArchived && (
                            <Button variant="secondary" size="sm" onClick={() => archiveEvidence(ev.id)} id={`archive-${ev.id}`}>Archive</Button>
                        )}
                        {permissions.canWrite && ev.isArchived && (
                            <Button variant="primary" size="sm" onClick={() => unarchiveEvidence(ev.id)} id={`unarchive-${ev.id}`}>Unarchive</Button>
                        )}
                        {permissions.canWrite && ev.status === 'DRAFT' && (
                            <Button variant="secondary" size="sm" onClick={() => submitReview(ev.id, 'SUBMITTED')}>{t.submitForReview}</Button>
                        )}
                        {permissions.canWrite && ev.status === 'SUBMITTED' && (
                            <>
                                <Button variant="success" size="sm" onClick={() => submitReview(ev.id, 'APPROVED')}>{t.approveEvidence}</Button>
                                <Button variant="danger" size="sm" onClick={() => submitReview(ev.id, 'REJECTED', 'Needs improvement')}>{t.rejectEvidence}</Button>
                            </>
                        )}
                        {permissions.canWrite && ev.status === 'REJECTED' && (
                            <Button variant="secondary" size="sm" onClick={() => submitReview(ev.id, 'SUBMITTED')}>{t.submitForReview}</Button>
                        )}
                    </div>
                );
            },
            meta: { disableTruncate: true },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ]), [t, permissions, editingRetention, editRetentionDate, apiUrl]);

    return (
        <ListPageShell className="animate-fadeIn gap-6">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">{t.title}</h1>
                        <p className="text-content-muted text-sm">{evidence.length} evidence items</p>
                    </div>
                    {permissions.canWrite && (
                        <div className="flex gap-2">
                            <Button
                                variant="primary"
                                onClick={() => setShowUpload(true)}
                                id="upload-evidence-btn"
                            >
                                Upload File
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => setShowBulkImport(true)}
                                id="bulk-import-evidence-btn"
                            >
                                Import ZIP
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => setShowTextForm(true)}
                                id="add-text-evidence-btn"
                            >
                                {t.addEvidence}
                            </Button>
                        </div>
                    )}
                </div>
            </ListPageShell.Header>

            {permissions.canWrite && (
                <>
                    <UploadEvidenceModal
                        open={showUpload}
                        setOpen={setShowUpload}
                        tenantSlug={tenantSlug}
                        apiUrl={apiUrl}
                        controls={controls}
                    />
                    <NewEvidenceTextModal
                        open={showTextForm}
                        setOpen={setShowTextForm}
                        tenantSlug={tenantSlug}
                        apiUrl={apiUrl}
                        controls={controls}
                    />
                    <EvidenceBulkImportModal
                        open={showBulkImport}
                        setOpen={setShowBulkImport}
                        tenantSlug={tenantSlug}
                        apiUrl={apiUrl}
                    />
                </>
            )}

            <ListPageShell.Filters className="space-y-3">
                {/* Retention filter tabs + Control filter */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-1" id="retention-tabs">
                        <Button
                            variant={retentionFilter === 'active' ? 'primary' : 'ghost'}
                            onClick={() => setFilter('tab', 'active')}
                            id="tab-active"
                        >
                            Active ({activeEvidence.length})
                        </Button>
                        <Button
                            variant={retentionFilter === 'expiring' ? 'danger' : 'ghost'}
                            onClick={() => setFilter('tab', 'expiring')}
                            id="tab-expiring"
                        >
                            Expiring ({expiringEvidence.length})
                        </Button>
                        <Button
                            variant={retentionFilter === 'archived' ? 'secondary' : 'ghost'}
                            onClick={() => setFilter('tab', 'archived')}
                            id="tab-archived"
                        >
                            Archived ({archivedEvidence.length})
                        </Button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/*
                          Epic 43.2 view toggle. Filter state lives in
                          `filterCtx`, NOT in `useUrlFilters`, so
                          flipping the renderer doesn't disturb search,
                          search-q, or any active filter pill — both
                          the table and the gallery read from the same
                          `displayEvidence` array.
                        */}
                        <ToggleGroup
                            size="sm"
                            ariaLabel="Evidence view"
                            options={[
                                { value: 'list', label: 'List', id: 'evidence-view-list' },
                                { value: 'gallery', label: 'Gallery', id: 'evidence-view-gallery' },
                            ]}
                            selected={viewMode}
                            selectAction={(v) => setFilter('view', v === 'list' ? '' : v)}
                            className="shrink-0"
                        />
                        <EvidenceFilterToolbar
                            controls={controls}
                            columnsDropdown={
                                viewMode === 'list' ? (
                                    <ColumnsDropdown
                                        columns={evidenceColumnDropdown}
                                        visibility={columnVisibility}
                                        onChange={(v) => setColumnVisibility(v)}
                                        defaultVisibility={defaultEvidenceVisibility}
                                    />
                                ) : null
                            }
                        />
                    </div>
                </div>

                {/* Archived warning */}
                {retentionFilter === 'archived' && archivedEvidence.length > 0 && (
                    <div className="bg-bg-warning border border-border-warning rounded-lg px-4 py-3 text-sm text-content-warning flex items-start gap-2">
                        <span className="text-lg">!</span>
                        <div>
                            <strong>Archived evidence</strong> should not be used in active audit packs or compliance assessments.
                            Unarchive if you need to reuse this evidence.
                        </div>
                    </div>
                )}
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                {viewMode === 'gallery' ? (
                    <EvidenceGallery
                        rows={displayEvidence}
                        loading={evidenceQuery.isLoading && !evidenceQuery.data}
                        emptyState={
                            retentionFilter === 'archived'
                                ? 'No archived evidence'
                                : retentionFilter === 'expiring'
                                    ? 'No evidence expiring soon'
                                    : t.noEvidence
                        }
                        fileUrl={(ev: any) =>
                            ev.fileRecordId
                                ? apiUrl(`/evidence/files/${ev.fileRecordId}/download`)
                                : null
                        }
                        statusBadgeClass={(s) => STATUS_BADGE[s] ?? 'badge-neutral'}
                        retentionStatus={(ev: any) => {
                            const rs = getRetentionStatus(ev, hydratedNow);
                            return { label: rs.label, badge: rs.badge };
                        }}
                        data-testid="evidence-gallery"
                    />
                ) : (
                    <DataTable
                        fillBody
                        data={displayEvidence}
                        columns={evidenceColumns}
                        getRowId={(ev: any) => ev.id}
                        emptyState={
                            retentionFilter === 'archived'
                                ? 'No archived evidence'
                                : retentionFilter === 'expiring'
                                    ? 'No evidence expiring soon'
                                    : t.noEvidence
                        }
                        resourceName={(p) => p ? 'evidence items' : 'evidence item'}
                        columnVisibility={columnVisibility}
                        onColumnVisibilityChange={setColumnVisibility}
                        data-testid="evidence-table"
                        className="hover:bg-bg-muted"
                    />
                )}
            </ListPageShell.Body>
        </ListPageShell>
    );
}

// ─── Evidence filter toolbar ─────────────────────────────────────────

function EvidenceFilterToolbar({
    controls,
    columnsDropdown,
}: {
    controls: unknown[];
    columnsDropdown?: React.ReactNode;
}) {
    const filters: FilterType[] = useMemo(
        () => buildEvidenceFilters(controls as Parameters<typeof buildEvidenceFilters>[0]),
        [controls],
    );
    return (
        <FilterToolbar
            filters={filters}
            searchId="evidence-search"
            searchPlaceholder="Search evidence… (Enter)"
            actions={columnsDropdown}
        />
    );
}
