"use client";

/**
 * Epic P5-PR-A — Canvas version-history sidebar.
 *
 * Lists every committed snapshot of the active process map,
 * descending by version. Each row carries the version number, a
 * relative timestamp, and the author's display name. P5-PR-B will
 * extend the row affordance with "View this version" + "Diff
 * against current" actions.
 *
 * Mount: inside the page tree, opt-in via the canonical
 * `<AsidePanel>` primitive so it inherits the same collapse +
 * resize + deep-link affordances Risks/Controls/Inspector use.
 *
 * Fetch shape: a small SWR-style fetch with re-load on activeId
 * change. The list is bounded (cap 200 in the repo) and refresh-
 * able by closing+reopening the panel; P5-PR-B will wire it to
 * the canvas's save event so the latest snapshot appears
 * automatically.
 */

import { useEffect, useState } from "react";
import { AsidePanel } from "@/components/ui/aside-panel";
import { LoadingSpinner } from "@/components/ui/icons/loading-spinner";
import { formatDateTime } from "@/lib/format-date";

interface SnapshotRow {
    id: string;
    version: number;
    createdAt: string;
    createdByName: string | null;
}

export function CanvasHistorySidebar({
    tenantSlug,
    mapId,
    currentVersion,
}: {
    tenantSlug: string;
    /** Active process map id; null when nothing is loaded. */
    mapId: string | null;
    /** Server's current version — flags the "current" snapshot. */
    currentVersion?: number | null;
}) {
    const [rows, setRows] = useState<SnapshotRow[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!mapId) {
            setRows(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const res = await fetch(
                    `/api/t/${tenantSlug}/processes/${mapId}/snapshots`,
                );
                if (!res.ok) {
                    throw new Error(`History load failed (${res.status})`);
                }
                const body = (await res.json()) as {
                    snapshots?: SnapshotRow[];
                };
                if (cancelled) return;
                setRows(body.snapshots ?? []);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Could not load history",
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // currentVersion changes on every save — refetch then so
        // the new snapshot lands at the top without a manual
        // refresh.
    }, [tenantSlug, mapId, currentVersion]);

    return (
        <AsidePanel
            title="Version history"
            surfaceKey="processes-history"
        >
            <div
                data-testid="canvas-history-sidebar"
                className="flex flex-col gap-default"
            >
                {loading && (
                    <div className="flex items-center gap-tight text-sm text-content-muted">
                        <LoadingSpinner /> Loading…
                    </div>
                )}
                {!loading && error && (
                    <div
                        data-testid="canvas-history-error"
                        className="text-sm text-danger-default"
                    >
                        {error}
                    </div>
                )}
                {!loading && !error && rows !== null && rows.length === 0 && (
                    <p
                        data-testid="canvas-history-empty"
                        className="text-sm text-content-subtle"
                    >
                        No versions yet. Save the canvas to capture the
                        first snapshot.
                    </p>
                )}
                {!loading && !error && rows !== null && rows.length > 0 && (
                    <ul className="flex flex-col gap-tight">
                        {rows.map((r) => {
                            const isCurrent = r.version === currentVersion;
                            return (
                                <li
                                    key={r.id}
                                    data-testid="canvas-history-row"
                                    data-version={r.version}
                                    className="flex flex-col rounded-[8px] border border-border-subtle px-default py-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-content-emphasis">
                                            v{r.version}
                                        </span>
                                        {isCurrent && (
                                            <span
                                                className="text-[10px] uppercase tracking-wide text-brand-default"
                                                data-testid="canvas-history-current"
                                            >
                                                Current
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[11px] text-content-subtle">
                                        {formatDateTime(r.createdAt)}
                                        {r.createdByName
                                            ? ` · ${r.createdByName}`
                                            : ""}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </AsidePanel>
    );
}
