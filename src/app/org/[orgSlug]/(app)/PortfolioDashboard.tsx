"use client";

/**
 * Epic 41 page rewire — main interactive dashboard component.
 *
 * The org overview page now reads `OrgDashboardWidget` rows from
 * the DB (via the API at `/api/org/<slug>/dashboard/widgets`) and
 * renders them through the typed widget dispatcher + grid + picker
 * primitives this PR shipped.
 *
 * Two modes:
 *
 *   - **View mode** (default, ORG_READER + ORG_ADMIN) — widgets
 *     render in their persisted positions; drag/resize disabled.
 *     Clicks pass through to widget contents (drill-down links,
 *     tenant rows, etc.).
 *
 *   - **Edit mode** (ORG_ADMIN only, via "Edit" button) — drag /
 *     resize / per-widget delete enabled; "Add widget" button
 *     opens the picker. Layout changes PATCH the API per row;
 *     adds POST; deletes DELETE.
 *
 * Persistence is API-driven — no local-only state. A failed PATCH
 * (e.g. 403, 500) snaps the tile back via the next render
 * because the source of truth is the parent's `widgets` state,
 * which is only updated on a successful response.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2, X } from 'lucide-react';

import {
    DashboardGrid,
    WidgetPicker,
    type WidgetLayoutChange,
} from '@/components/ui/dashboard-widgets';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Button } from '@/components/ui/button';
import type {
    CreateOrgDashboardWidgetInput,
    OrgDashboardWidgetDto,
} from '@/app-layer/schemas/org-dashboard-widget.schemas';

import { DispatchedWidget, type PortfolioData } from './widget-dispatcher';
// PR-3 — org dashboard now uses the same `<DashboardLayout>` shell
// the tenant dashboard sits inside. The shell carries the
// canonical PageHeader (title + description + meta + actions
// trio) + the animate-dashboard-rise-in entry motion + the
// space-y-section vertical rhythm that every other dashboard
// surface uses. Pre-PR-3 the org dashboard hand-rolled its own
// `<header>` block; the tenant + org dashboards drifted on
// chrome polish even though both were built by the same team.
import { DashboardLayout } from '@/components/layout/DashboardLayout';

// ─── Props ──────────────────────────────────────────────────────────

export interface PortfolioDashboardProps {
    initialWidgets: OrgDashboardWidgetDto[];
    data: PortfolioData;
    /** True when the caller is allowed to edit the dashboard. */
    canEdit: boolean;
}

// ─── API client (small, focused on this page only) ─────────────────

async function patchWidget(
    orgSlug: string,
    id: string,
    body: { position?: { x: number; y: number }; size?: { w: number; h: number } },
): Promise<OrgDashboardWidgetDto> {
    const res = await fetch(
        `/api/org/${orgSlug}/dashboard/widgets/${id}`,
        {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        },
    );
    if (!res.ok) throw new Error(`patch_failed_${res.status}`);
    const json = (await res.json()) as { widget: OrgDashboardWidgetDto };
    return json.widget;
}

async function postWidget(
    orgSlug: string,
    body: CreateOrgDashboardWidgetInput,
): Promise<OrgDashboardWidgetDto> {
    const res = await fetch(`/api/org/${orgSlug}/dashboard/widgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`post_failed_${res.status}`);
    const json = (await res.json()) as { widget: OrgDashboardWidgetDto };
    return json.widget;
}

async function deleteWidget(orgSlug: string, id: string): Promise<void> {
    const res = await fetch(
        `/api/org/${orgSlug}/dashboard/widgets/${id}`,
        { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!res.ok) throw new Error(`delete_failed_${res.status}`);
}

// ─── Component ──────────────────────────────────────────────────────

export function PortfolioDashboard({
    initialWidgets,
    data,
    canEdit,
}: PortfolioDashboardProps) {
    const t = useTranslations('org.portfolio');
    const [widgets, setWidgets] = useState<OrgDashboardWidgetDto[]>(
        () => [...initialWidgets],
    );
    const [editMode, setEditMode] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Layout-change handler ──
    //
    // Fires after every drag/resize stop. The grid emits ONLY the
    // diff (rows whose (x,y,w,h) actually moved). For each, fire a
    // PATCH and reflect the response in local state. Errors snap
    // the tile back via re-render.
    const handleLayoutChange = useCallback(
        async (changes: WidgetLayoutChange[]) => {
            if (changes.length === 0) return;
            setError(null);
            try {
                const updates = await Promise.all(
                    changes.map((c) =>
                        patchWidget(data.orgSlug, c.id, {
                            position: c.position,
                            size: c.size,
                        }),
                    ),
                );
                setWidgets((prev) => {
                    const byId = new Map(updates.map((u) => [u.id, u]));
                    return prev.map((w) => byId.get(w.id) ?? w);
                });
            } catch (e) {
                setError(
                    e instanceof Error
                        ? `Failed to save layout (${e.message})`
                        : 'Failed to save layout',
                );
            }
        },
        [data.orgSlug],
    );

    const handleCreate = useCallback(
        async (input: CreateOrgDashboardWidgetInput) => {
            const created = await postWidget(data.orgSlug, input);
            setWidgets((prev) => [...prev, created]);
            return created;
        },
        [data.orgSlug],
    );

    const handleDelete = useCallback(
        async (id: string) => {
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
                await deleteWidget(data.orgSlug, id);
                setWidgets((prev) => prev.filter((w) => w.id !== id));
            } catch (e) {
                setError(
                    e instanceof Error
                        ? `Failed to delete widget (${e.message})`
                        : 'Failed to delete widget',
                );
            } finally {
                setBusy(false);
            }
        },
        [data.orgSlug, busy],
    );

    // PR-3 — DashboardLayout PageHeader description preserves the
    // pre-PR-3 stats line (tenant count + pending snapshot count)
    // but threads it through the shared header trio so an external
    // observer (E2E / a11y) sees the same shape org + tenant
    // dashboards expose.
    const headerDescription = (
        <span data-portfolio-header-stats>
            <AnimatedNumber
                value={data.summary.tenants.total}
                format={{ kind: 'integer' }}
            />
            {' '}
            {data.summary.tenants.total === 1
                ? t('tenantSingular')
                : t('tenantPlural')}
            {data.summary.tenants.pending > 0 && (
                <>
                    {' · '}
                    <AnimatedNumber
                        value={data.summary.tenants.pending}
                        format={{ kind: 'integer' }}
                    />
                    {' '}
                    {t('pendingFirstSnapshot')}
                </>
            )}
        </span>
    );

    const headerActions = (
        <div className="flex items-center gap-tight">
            {canEdit && !editMode && (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditMode(true)}
                    data-testid="dashboard-edit-toggle"
                >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    {t('editDashboard')}
                </Button>
            )}
            {canEdit && editMode && (
                <>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPickerOpen(true)}
                        data-testid="dashboard-add-widget"
                    >
                        <Plus className="size-3.5" aria-hidden="true" />
                        {t('addWidget')}
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setEditMode(false)}
                        data-testid="dashboard-edit-done"
                    >
                        <X className="size-3.5" aria-hidden="true" />
                        {t('done')}
                    </Button>
                </>
            )}
        </div>
    );

    return (
        <DashboardLayout
            data-testid="org-dashboard"
            className="space-y-default"
            header={{
                title: t('title'),
                description: headerDescription,
                actions: headerActions,
            }}
        >

            {error && (
                <div
                    role="alert"
                    data-testid="dashboard-error"
                    className="rounded-md border border-border-error bg-bg-error/10 px-3 py-2 text-sm text-content-error"
                >
                    {error}
                </div>
            )}

            {/* Empty-state for orgs that haven't been backfilled. The
             *  POST /api/org seed lands new orgs with the preset
             *  pre-installed; existing orgs need
             *  `npm run db:backfill-org-widgets -- --execute`. ORG_ADMIN
             *  sees a clear hint; ORG_READER sees a softer one. */}
            {widgets.length === 0 && (
                <div
                    data-testid="dashboard-empty-state"
                    className="rounded-md border border-border-subtle bg-bg-muted/20 px-4 py-6 text-center"
                >
                    <p className="text-sm font-medium text-content-emphasis">
                        {t('emptyTitle')}
                    </p>
                    <p className="text-xs text-content-muted mt-1">
                        {canEdit ? t('emptyDescEdit') : t('emptyDescReader')}
                    </p>
                </div>
            )}

            {/* Grid */}
            {widgets.length > 0 && (
                <DashboardGrid<OrgDashboardWidgetDto>
                    widgets={widgets}
                    editable={editMode}
                    onLayoutChange={handleLayoutChange}
                    renderWidget={(w) => (
                        <DispatchedWidget
                            widget={w}
                            data={data}
                            actionsSlot={
                                editMode ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void handleDelete(w.id);
                                        }}
                                        disabled={busy}
                                        aria-label={t('deleteWidgetAria', {
                                            name: w.title ?? w.chartType,
                                        })}
                                        data-testid={`dashboard-delete-widget-${w.id}`}
                                        className="text-content-subtle hover:text-content-error transition-colors p-1 rounded"
                                    >
                                        <Trash2 className="size-3.5" aria-hidden="true" />
                                    </button>
                                ) : null
                            }
                        />
                    )}
                />
            )}

            {/* Picker modal */}
            <WidgetPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onSubmit={handleCreate}
            />
        </DashboardLayout>
    );
}
