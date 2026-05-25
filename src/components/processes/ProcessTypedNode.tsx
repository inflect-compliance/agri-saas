"use client";

/**
 * Roadmap-26 PR-B / Roadmap-27 PR-B — ProcessTypedNode.
 *
 * One xyflow custom node component covering all seven taxonomy
 * kinds (see `node-taxonomy.ts`). Per-kind chrome (icon, accent
 * border, shape) is driven by `data.kind`; per-instance footprint
 * is driven by `data.size`.
 *
 * R27-PR-B — the shape vocabulary:
 *   • rect    — process step, control, risk, external. The
 *               workhorse: a rounded card.
 *   • diamond — decision. A REAL diamond (R25 shipped a fake one —
 *               a small rounded rect). Rendered as a 45°-rotated
 *               square so the border, selected ring and elevation
 *               shadow all rotate WITH it and stay diamond-shaped;
 *               the label sits in a separate upright layer.
 *   • note    — annotation. A flat sticker.
 *
 * Three shapes, seven kinds — the accent + icon do the remaining
 * per-kind work. Three shapes is the curated ceiling: more would
 * make the canvas read like a sticker sheet (see
 * docs/processes-canvas-semantics.md).
 *
 * Size variants (`data.size`: sm | md | lg, default md) scale the
 * footprint so an author can weight a node by importance without a
 * free-form resize handle (which invites ragged, mis-aligned maps).
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { cn } from "@dub/utils";
import {
    NODE_TAXONOMY,
    NODE_ACCENT_BORDER,
    NODE_ACCENT_ICON_TONE,
    isProcessNodeKind,
    type ProcessNodeKind,
} from "./node-taxonomy";

/** Per-instance footprint. Three discrete steps — not free resize. */
export type ProcessNodeSize = "sm" | "md" | "lg";
export const PROCESS_NODE_SIZES: ProcessNodeSize[] = ["sm", "md", "lg"];
export const DEFAULT_NODE_SIZE: ProcessNodeSize = "md";

export function isProcessNodeSize(value: unknown): value is ProcessNodeSize {
    return value === "sm" || value === "md" || value === "lg";
}

// ─── Per-size geometry ───────────────────────────────────────────────

const RECT_SIZE: Record<ProcessNodeSize, string> = {
    sm: "min-w-[148px] max-w-[230px] px-3 py-1.5",
    md: "min-w-[180px] max-w-[300px] px-3.5 py-2.5",
    lg: "min-w-[224px] max-w-[360px] px-4 py-3.5",
};

const NOTE_SIZE: Record<ProcessNodeSize, string> = {
    sm: "min-w-[140px] max-w-[220px] px-3 py-1.5",
    md: "min-w-[176px] max-w-[300px] px-3.5 py-2.5",
    lg: "min-w-[220px] max-w-[360px] px-4 py-3.5",
};

// R31 — the diamond-size table was retired alongside the
// diamond shape branch. The decision kind now uses the rect
// chassis + a corner sticker.

const ICON_SIZE: Record<ProcessNodeSize, string> = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
};

const LABEL_TEXT: Record<ProcessNodeSize, string> = {
    sm: "text-[11px]",
    md: "text-xs",
    lg: "text-sm",
};

export interface ProcessTypedNodeData {
    /** Visible label (the first line; the bold/emphasis line). */
    label: string;
    /** Optional secondary line — category, owner, severity, etc. */
    subtitle?: string;
    /**
     * The kind drives chrome (icon, accent, shape). Missing /
     * unknown kinds fall back to `processStep`.
     */
    kind?: ProcessNodeKind | string;
    /** Per-instance footprint. Missing / unknown falls back to `md`. */
    size?: ProcessNodeSize | string;
    [key: string]: unknown;
}

const HANDLE_CLASS =
    "!h-2 !w-2 !border-2 !border-[color:var(--brand-default)] !bg-bg-default";

const SELECTED_CHROME =
    "border-[color:var(--brand-default)] ring-2 ring-[color:var(--brand-default)]/40 bg-bg-elevated";

function ProcessTypedNodeImpl({ data, selected }: NodeProps) {
    const nodeData = data as ProcessTypedNodeData;
    const kind: ProcessNodeKind = isProcessNodeKind(nodeData.kind)
        ? nodeData.kind
        : "processStep";
    const size: ProcessNodeSize = isProcessNodeSize(nodeData.size)
        ? nodeData.size
        : DEFAULT_NODE_SIZE;
    const meta = NODE_TAXONOMY[kind];
    const Icon = meta.icon;

    const accentBorder = NODE_ACCENT_BORDER[meta.accent];
    const iconTone = NODE_ACCENT_ICON_TONE[meta.accent];
    const label = nodeData.label || meta.defaultLabel;

    // ── Group (R30) — translucent labelled container ─────────────────
    // The group's wrapper takes its full size from xyflow's `style`
    // (set when the group is created). Children whose `parentId`
    // matches the group's id render INSIDE this wrapper via
    // xyflow's nested-positioning. The dashed border + low-opacity
    // fill keep the group readable as "context container", not as
    // a process step competing for the eye.
    if (meta.category === "group") {
        return (
            <div
                className={cn(
                    "relative h-full w-full rounded-[12px] border-2 border-dashed transition-colors",
                    selected
                        ? "border-[color:var(--brand-default)] bg-bg-elevated/40"
                        : "border-border-subtle bg-canvas-node-muted/30 hover:border-border-emphasis",
                )}
                data-process-node="true"
                data-process-node-kind={kind}
                data-process-node-size={size}
                data-selected={selected ? "true" : "false"}
            >
                {/* Title sticker — anchored to the top-left so the
                    label never overlaps a child's content. */}
                <div className="absolute left-2 top-2 inline-flex items-center gap-tight rounded-[6px] border border-canvas-border bg-canvas-frame px-2 py-0.5 text-[11px] font-semibold text-content-emphasis">
                    <Icon
                        className={cn("h-3 w-3", iconTone)}
                        aria-hidden="true"
                    />
                    <span className="truncate max-w-trunc-default">{label}</span>
                </div>
                {nodeData.subtitle && (
                    <div className="absolute right-2 top-2 truncate text-[10px] uppercase tracking-wide text-content-subtle">
                        {nodeData.subtitle}
                    </div>
                )}
            </div>
        );
    }

    // R31 — Diamond shape retired. Decision nodes now render via
    // the rect chassis below; the per-kind signal moves into a
    // corner sticker (computed below as `cornerSticker`) — a
    // quiet, repeatable affordance pattern that scales to any
    // future kind without spawning a new geometry branch.

    // ── Rect + note ──────────────────────────────────────────────────
    const isNote = meta.shape === "note";
    const sizeClasses = isNote ? NOTE_SIZE[size] : RECT_SIZE[size];
    const radiusClass = isNote ? "rounded-[6px]" : "rounded-[10px]";

    // R26-PR-D / R27 — surface tone varies by semantic category so
    // the eye reads flow vs context vs note at a glance. Solid,
    // elevated cards (not translucent tints): opaque nodes with a
    // soft drop shadow read as deliberate objects floating above the
    // recessed canvas plane.
    //
    //   flow    — brightest fill + lift → "this IS the process"
    //   context — quieter fill + lift  → "this ANNOTATES the flow"
    //   note    — flat sticker tint    → "not part of the graph"
    const surfaceClasses =
        meta.category === "note"
            ? "bg-bg-subtle"
            : meta.category === "context"
              ? "bg-canvas-node-muted shadow-canvas-node"
              : "bg-canvas-node shadow-canvas-node";

    // R31 — per-kind corner sticker. A quiet, repeatable
    // affordance pattern for kinds that need a visual signal
    // beyond the icon alone. Decision gets a "?" (branch hint);
    // external gets "EXT" (outside-the-org hint). The sticker
    // sits in the top-right at `relative inset` so a future kind
    // (e.g. error / locked / awaiting-review) can plug into the
    // same slot without spawning new geometry.
    const cornerSticker: string | null =
        kind === "decision" ? "?" : kind === "external" ? "EXT" : null;

    return (
        <div
            className={cn(
                "relative border transition-colors",
                sizeClasses,
                radiusClass,
                surfaceClasses,
                selected
                    ? SELECTED_CHROME
                    : `${accentBorder} hover:border-border-emphasis`,
            )}
            data-process-node="true"
            data-process-node-kind={kind}
            data-process-node-size={size}
            data-selected={selected ? "true" : "false"}
        >
            {cornerSticker && (
                <span
                    className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-canvas-border bg-canvas-frame px-1 text-[9px] font-semibold uppercase tracking-wide text-content-muted"
                    aria-hidden="true"
                    data-process-node-sticker={kind}
                >
                    {cornerSticker}
                </span>
            )}
            {meta.hasHandles && (
                <Handle
                    type="target"
                    position={Position.Left}
                    className={HANDLE_CLASS}
                />
            )}
            <div className="flex items-center gap-tight">
                <Icon
                    className={cn(ICON_SIZE[size], "flex-shrink-0", iconTone)}
                    aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                        className={cn(
                            "truncate tabular-nums",
                            LABEL_TEXT[size],
                            isNote
                                ? "italic text-content-muted"
                                : "font-semibold text-content-emphasis",
                        )}
                    >
                        {label}
                    </span>
                    {nodeData.subtitle && (
                        <span className="truncate text-[10px] uppercase tracking-wide text-content-muted">
                            {nodeData.subtitle}
                        </span>
                    )}
                </div>
            </div>
            {meta.hasHandles && (
                <Handle
                    type="source"
                    position={Position.Right}
                    className={HANDLE_CLASS}
                />
            )}
        </div>
    );
}

export const ProcessTypedNode = memo(ProcessTypedNodeImpl);

/**
 * Backwards-compat alias — the R25 ratchet asserts the existence of
 * `<ProcessStepNode>`. The implementation flows through the typed
 * renderer.
 */
export const ProcessStepNode = ProcessTypedNode;

/** Canonical xyflow node-type key for the default kind. */
export const PROCESS_STEP_NODE_TYPE = "processStep";
