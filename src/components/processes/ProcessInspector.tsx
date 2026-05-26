"use client";

/**
 * R26-PR-E / R28 — ProcessInspector.
 *
 * Right-side property panel for the selected canvas element.
 * Originally NODE-only (R26-PR-E); R28 extends to EDGES — selecting
 * a connection now opens the same panel with edge-specific fields
 * (label override + the variant cycle: flow / conditional / reference).
 *
 * Why a panel and not an inline popover:
 *   • Inline popovers compete with the canvas surface for focus;
 *     the user's eye has to alternate between "where the node
 *     lives" and "where the popover is". A persistent right
 *     panel anchors the edit affordance in one stable place.
 *   • Multiple edits (e.g. label THEN subtitle) need a
 *     persistent affordance, not a popover that closes on every
 *     blur.
 *
 * Why it's COLLAPSIBLE:
 *   • Authors who already know what they're building shouldn't
 *     have to look at a panel of empty fields. The panel mounts
 *     only when something is selected; selecting nothing
 *     hides it.
 *
 * Empty-state messaging:
 *   • When something IS selected but the kind doesn't carry
 *     editable fields (decision: just a label; annotation: just
 *     text), the panel still mounts so the user sees a
 *     consistent affordance — never a partial-mount that reads
 *     as "is anything happening?"
 */

import { useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { AsidePanel } from "@/components/ui/aside-panel";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
    formatControlLabel,
    useTenantControls,
} from "@/lib/processes/use-tenant-controls";
import { useTenantRisks } from "@/lib/processes/use-tenant-risks";
import {
    formatAssetLabel,
    useTenantAssets,
} from "@/lib/processes/use-tenant-assets";
import { NODE_TAXONOMY, isProcessNodeKind } from "./node-taxonomy";
import {
    DEFAULT_NODE_SIZE,
    isProcessNodeSize,
    type ProcessNodeSize,
} from "./ProcessTypedNode";
import {
    EDGE_VARIANT_META,
    EDGE_VARIANT_ORDER,
    isProcessEdgeVariant,
    type ProcessEdgeVariant,
} from "./ProcessEdge";

/**
 * Epic P2-PR-A — shape of an edge-attached control reference.
 * One per edge today (the inspector picks ONE); the underlying
 * `ProcessEdgeControl` table supports multiple per edge for future
 * "two controls gate this edge" use cases.
 */
export interface EdgeControlRef {
    /** Stable per-edge identifier — survives saves + reloads. */
    controlKey: string;
    /** Human label rendered on the in-canvas pill. */
    label: string;
    /** Optional FK to a tenant Control. Null = unbound label. */
    controlId: string | null;
}

export interface ProcessInspectorProps {
    /** Selected node, or null when nothing is selected. */
    node: Node | null;
    /**
     * R28 — selected edge, or null when nothing is selected. Mutually
     * exclusive with `node` in practice (xyflow lets you multi-select
     * a node + an edge but the canvas only mirrors one slot at a
     * time — node wins if both are set).
     */
    edge?: Edge | null;
    /**
     * Tenant slug — Epic P2-PR-A — used by the edge inspector to
     * fetch the tenant's Controls list for the picker. Optional:
     * the node-mode panel doesn't need it, and absence in edge mode
     * gracefully hides the picker (rendered tests + storybook
     * stages without the canvas surrounding context keep working).
     */
    tenantSlug?: string;
    /**
     * Called when the user commits a label / subtitle / size /
     * entity-link change. The canvas writes the change back into
     * its nodes state.
     *
     * Epic P2-PR-B — `linkedEntityId` carries the FK to whichever
     * entity matches the node's kind (control / risk / asset). The
     * picker is conditional on `data.kind`, so a single shared field
     * suffices — kind disambiguates on read.
     */
    onUpdate: (
        nodeId: string,
        patch: {
            label?: string;
            subtitle?: string | null;
            size?: ProcessNodeSize;
            linkedEntityId?: string | null;
        },
    ) => void;
    /**
     * R28 + Epic P2-PR-A — commit an edge edit. The canvas applies
     * the patch to the edge's `label` (top-level on xyflow) +
     * `data.variant` + `data.controls` (P2-PR-A — linked tenant
     * Control).
     */
    onEdgeUpdate?: (
        edgeId: string,
        patch: {
            label?: string | null;
            variant?: ProcessEdgeVariant;
            controls?: EdgeControlRef[];
        },
    ) => void;
}

export function ProcessInspector({
    node,
    edge = null,
    tenantSlug,
    onUpdate,
    onEdgeUpdate,
}: ProcessInspectorProps) {
    // Local state mirrors the node's data so the user can type
    // without every keystroke flushing to the canvas state. The
    // mirror commits on blur (or Enter), which is when the canvas
    // actually receives the patch.
    const data = node?.data as
        | {
              label?: string;
              subtitle?: string;
              kind?: unknown;
              size?: unknown;
              linkedEntityId?: unknown;
          }
        | undefined;
    const [label, setLabel] = useState(data?.label ?? "");
    const [subtitle, setSubtitle] = useState(data?.subtitle ?? "");

    // Sync local mirror when the selected node changes.
    useEffect(() => {
        setLabel(data?.label ?? "");
        setSubtitle(data?.subtitle ?? "");
    }, [node?.id, data?.label, data?.subtitle]);

    // R28 — edge-selection mode. Node wins if both are set; the
    // canvas only mirrors one slot at a time but the guard here
    // keeps the rendering deterministic regardless of order.
    if (!node && edge) {
        return (
            <EdgeInspectorBody
                edge={edge}
                tenantSlug={tenantSlug}
                onEdgeUpdate={onEdgeUpdate}
            />
        );
    }

    if (!node) {
        return null;
    }

    const kindMeta = isProcessNodeKind(data?.kind)
        ? NODE_TAXONOMY[data.kind]
        : null;

    const size: ProcessNodeSize = isProcessNodeSize(data?.size)
        ? data.size
        : DEFAULT_NODE_SIZE;

    const commit = () => {
        const trimmedLabel = label.trim();
        const trimmedSubtitle = subtitle.trim();
        onUpdate(node.id, {
            label: trimmedLabel,
            subtitle: trimmedSubtitle === "" ? null : trimmedSubtitle,
        });
    };

    // R31 Bundle 5 (PR 6) — Inspector chrome now flows through the
    // canonical `<AsidePanel>` primitive (Risks + Controls parity).
    // The pre-R31 bespoke 260px `<aside>` is gone; the new shell
    // gives the inspector collapse-to-spine, resize, deep-link
    // (`?aside=processes-inspector`), and a `<Sheet>` fallback
    // below xl for free. The inner body retains every existing
    // testid the R28 ratchet pins; only the chrome moved.
    return (
        <AsidePanel
            title="Inspector"
            surfaceKey="processes-inspector"
        >
            <div
                className="flex flex-col gap-default"
                data-process-inspector="true"
                aria-label="Selected node properties"
            >
                {kindMeta && (
                    <span className="text-[10px] uppercase tracking-wide text-content-subtle">
                        {kindMeta.label}
                    </span>
                )}
                <label className="flex flex-col gap-tight">
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Label
                </span>
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.currentTarget.blur();
                        }
                    }}
                    className="rounded-[6px] border border-canvas-border bg-canvas-surface px-2 py-1 text-xs text-content-emphasis focus:border-border-emphasis focus:outline-none"
                    data-testid="inspector-label-input"
                />
            </label>
            <label className="flex flex-col gap-tight">
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Subtitle
                </span>
                <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.currentTarget.blur();
                        }
                    }}
                    placeholder="optional"
                    className="rounded-[6px] border border-canvas-border bg-canvas-surface px-2 py-1 text-xs text-content-emphasis focus:border-border-emphasis focus:outline-none"
                    data-testid="inspector-subtitle-input"
                />
            </label>
            <div className="flex flex-col gap-tight">
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Size
                </span>
                <ToggleGroup
                    size="sm"
                    ariaLabel="Node size"
                    selected={size}
                    options={[
                        { value: "sm", label: "S" },
                        { value: "md", label: "M" },
                        { value: "lg", label: "L" },
                    ]}
                    selectAction={(v) =>
                        onUpdate(node.id, { size: v as ProcessNodeSize })
                    }
                />
            </div>
            {/* Epic P2-PR-B — Linked-entity picker. Mounts only on
                nodes whose kind matches a compliance entity (control
                / risk / asset). The selection writes the FK into
                `data.linkedEntityId`; the canvas's `nodeDataJson`
                serialiser persists it via the existing `dataJson`
                column — no schema change needed. */}
            <NodeLinkedEntityPicker
                nodeKind={data?.kind}
                tenantSlug={tenantSlug}
                selectedId={
                    typeof data?.linkedEntityId === "string"
                        ? data.linkedEntityId
                        : null
                }
                onCommit={(linkedEntityId) =>
                    onUpdate(node.id, { linkedEntityId })
                }
            />
                <p className="text-[10px] text-content-subtle">
                    Click off the field or press Enter to save the edit.
                </p>
            </div>
        </AsidePanel>
    );
}

// ─── Epic P2-PR-B — Linked-entity picker (control / risk / asset) ──

function NodeLinkedEntityPicker({
    nodeKind,
    tenantSlug,
    selectedId,
    onCommit,
}: {
    nodeKind: unknown;
    tenantSlug?: string;
    selectedId: string | null;
    onCommit: (id: string | null) => void;
}) {
    // Three hooks unconditionally — React rules of hooks. Each
    // short-circuits to a no-op when the slug is the empty string,
    // and we discard the unused responses below.
    const slug = tenantSlug ?? "";
    const controls = useTenantControls(slug);
    const risks = useTenantRisks(slug);
    const assets = useTenantAssets(slug);

    if (nodeKind !== "control" && nodeKind !== "risk" && nodeKind !== "asset") {
        return null;
    }

    const active =
        nodeKind === "control"
            ? {
                  label: "Linked control",
                  options: controls.options.map((c) => ({
                      value: c.id,
                      label: formatControlLabel(c),
                  })),
                  loading: controls.loading,
                  emptyHint: "No controls yet",
              }
            : nodeKind === "risk"
              ? {
                    label: "Linked risk",
                    options: risks.options.map((r) => ({
                        value: r.id,
                        label: r.title,
                    })),
                    loading: risks.loading,
                    emptyHint: "No risks yet",
                }
              : {
                    label: "Linked asset",
                    options: assets.options.map((a) => ({
                        value: a.id,
                        label: formatAssetLabel(a),
                    })),
                    loading: assets.loading,
                    emptyHint: "No assets yet",
                };

    const selectedOption = selectedId
        ? active.options.find((o) => o.value === selectedId) ?? null
        : null;

    return (
        <div
            className="flex flex-col gap-tight"
            data-testid="inspector-node-entity-picker"
            data-entity-kind={nodeKind}
        >
            <span className="text-[10px] uppercase tracking-wide text-content-muted">
                {active.label}
            </span>
            <Combobox
                selected={selectedOption}
                setSelected={(option) =>
                    onCommit(option?.value ?? null)
                }
                options={active.options}
                disabled={active.loading || active.options.length === 0}
                aria-label={active.label}
                placeholder={
                    active.loading
                        ? "Loading…"
                        : active.options.length === 0
                          ? active.emptyHint
                          : "Pick one…"
                }
            />
        </div>
    );
}

// ─── R28 + Epic P2-PR-A — Edge inspector body ──────────────────────

function EdgeInspectorBody({
    edge,
    tenantSlug,
    onEdgeUpdate,
}: {
    edge: Edge;
    tenantSlug?: string;
    onEdgeUpdate?: ProcessInspectorProps["onEdgeUpdate"];
}) {
    const variantRaw = (edge.data as { variant?: unknown } | undefined)
        ?.variant;
    const variant: ProcessEdgeVariant = isProcessEdgeVariant(variantRaw)
        ? variantRaw
        : "flow";
    const initialLabel =
        typeof edge.label === "string" ? edge.label : "";
    const [label, setLabel] = useState(initialLabel);

    useEffect(() => {
        setLabel(typeof edge.label === "string" ? edge.label : "");
    }, [edge.id, edge.label]);

    // Epic P2-PR-A — controls attached to this edge. PR-A allows
    // ONE per edge in the inspector; the underlying ProcessEdgeControl
    // table supports many for future "two controls gate this edge"
    // shapes.
    const existingControls = readEdgeControls(edge);
    const selectedControl = existingControls[0] ?? null;
    // Passing the empty string short-circuits the hook to a no-op
    // ({ options: [], loading: false }); the picker block below
    // also gates on `tenantSlug` so absence cleanly hides the
    // affordance.
    const { options: tenantControls, loading: controlsLoading } =
        useTenantControls(tenantSlug ?? "");

    const controlOptions = useMemo<ComboboxOption[]>(
        () =>
            tenantControls.map((c) => ({
                value: c.id,
                label: formatControlLabel(c),
            })),
        [tenantControls],
    );
    const selectedControlOption = useMemo<ComboboxOption | null>(() => {
        if (!selectedControl?.controlId) return null;
        return (
            controlOptions.find((o) => o.value === selectedControl.controlId) ??
            null
        );
    }, [controlOptions, selectedControl]);

    const commitLinkedControl = (option: ComboboxOption | null) => {
        if (!onEdgeUpdate) return;
        if (option === null) {
            // Clear: drop every control attached to this edge.
            onEdgeUpdate(edge.id, { controls: [] });
            return;
        }
        const ref = tenantControls.find((c) => c.id === option.value);
        if (!ref) return;
        const next: EdgeControlRef = {
            controlKey:
                selectedControl?.controlKey ??
                `ctrl-${edge.id}-${Date.now().toString(36)}`,
            controlId: ref.id,
            label: formatControlLabel(ref),
        };
        onEdgeUpdate(edge.id, { controls: [next] });
    };

    const commit = () => {
        if (!onEdgeUpdate) return;
        const trimmed = label.trim();
        onEdgeUpdate(edge.id, { label: trimmed === "" ? null : trimmed });
    };

    // R31 Bundle 5 (PR 6) — edge inspector chrome moves to AsidePanel
    // parity, same as the node inspector above. Same surfaceKey so
    // a user toggling between node + edge selection sees a single
    // inspector panel persist its collapse state across both modes.
    return (
        <AsidePanel
            title="Inspector"
            surfaceKey="processes-inspector"
        >
            <div
                className="flex flex-col gap-default"
                data-process-inspector="true"
                data-inspector-mode="edge"
                aria-label="Selected edge properties"
            >
                <span className="text-[10px] uppercase tracking-wide text-content-subtle">
                    Connection
                </span>
                <label className="flex flex-col gap-tight">
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Label
                </span>
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.currentTarget.blur();
                        }
                    }}
                    placeholder="optional"
                    className="rounded-[6px] border border-canvas-border bg-canvas-surface px-2 py-1 text-xs text-content-emphasis focus:border-border-emphasis focus:outline-none"
                    data-testid="inspector-edge-label-input"
                />
            </label>
            <div className="flex flex-col gap-tight">
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Variant
                </span>
                <ToggleGroup
                    size="sm"
                    ariaLabel="Edge variant"
                    selected={variant}
                    options={EDGE_VARIANT_ORDER.map((v) => ({
                        value: v,
                        label: EDGE_VARIANT_META[v].label,
                    }))}
                    selectAction={(v) =>
                        onEdgeUpdate?.(edge.id, {
                            variant: v as ProcessEdgeVariant,
                        })
                    }
                />
                <span className="text-[10px] text-content-subtle">
                    {EDGE_VARIANT_META[variant].description}
                </span>
            </div>
            {/* Epic P2-PR-A — Linked control picker. Mounts a tenant-
                wide Controls combobox so the user can attach a real
                compliance control to this edge. The selection writes
                ProcessEdgeControl rows on the next save; the canvas
                already round-trips the controls on load. */}
            <div
                className="flex flex-col gap-tight"
                data-testid="inspector-edge-control-picker"
            >
                <span className="text-[10px] uppercase tracking-wide text-content-muted">
                    Linked control
                </span>
                <Combobox
                    selected={selectedControlOption}
                    setSelected={commitLinkedControl}
                    options={controlOptions}
                    disabled={controlsLoading || tenantControls.length === 0}
                    aria-label="Linked control"
                    placeholder={
                        controlsLoading
                            ? "Loading controls…"
                            : tenantControls.length === 0
                              ? "No controls yet"
                              : "Pick a control…"
                    }
                />
                <span className="text-[10px] text-content-subtle">
                    Auditors see the chosen control as a shield pill on
                    the connection.
                </span>
            </div>
                <p className="text-[10px] text-content-subtle">
                    Click off the field or press Enter to save the edit.
                </p>
            </div>
        </AsidePanel>
    );
}

/**
 * Epic P2-PR-A — read the typed control list off an edge's `data`.
 * Tolerant of pre-P2 edges whose data omits the controls array.
 */
function readEdgeControls(edge: Edge): EdgeControlRef[] {
    const raw = (edge.data as { controls?: unknown } | undefined)?.controls;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((r) => {
            const row = r as {
                controlKey?: unknown;
                label?: unknown;
                controlId?: unknown;
            };
            if (typeof row.controlKey !== "string") return null;
            return {
                controlKey: row.controlKey,
                label:
                    typeof row.label === "string" ? row.label : row.controlKey,
                controlId:
                    typeof row.controlId === "string"
                        ? row.controlId
                        : null,
            } satisfies EdgeControlRef;
        })
        .filter((r): r is EdgeControlRef => r !== null);
}
