"use client";

/**
 * Roadmap-26 PR-B — ProcessTypedNode.
 *
 * One xyflow custom node component covering all seven taxonomy
 * kinds (see `node-taxonomy.ts`). Per-kind chrome (icon, accent
 * border, shape) is driven by `data.kind` so the canvas only
 * registers ONE component in `nodeTypes` — no per-kind switch
 * scattered across consumers.
 *
 * Why a single component (vs. seven node files):
 *   • The chassis is identical across kinds: chrome shape,
 *     handle positions, selected-state ring, label slot. Six
 *     near-duplicates would amplify the cost of any future
 *     chassis change.
 *   • xyflow registers components by string id (the `type`
 *     field on each Node). The id is what gets persisted in
 *     `ProcessNode.nodeType`. Keeping each id pointed at the
 *     SAME renderer lets us register seven entries with one
 *     function reference — module-stable, no `NODE_TYPES`
 *     reference drift.
 *
 * The legacy `ProcessStepNode` is preserved as a thin re-export
 * wrapper at the bottom of this file so the R25 ratchet (which
 * checks `<ProcessStepNode>` exists) keeps passing without
 * touching the structural assertion.
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

export interface ProcessTypedNodeData {
    /** Visible label (the first line; the bold/emphasis line). */
    label: string;
    /** Optional secondary line — category, owner, severity, etc. */
    subtitle?: string;
    /**
     * The kind drives chrome (icon, accent, shape). When the kind
     * is missing or unknown (forward-compat with a kind we
     * haven't designed yet), we fall back to `processStep` so the
     * canvas never crashes on render.
     */
    kind?: ProcessNodeKind | string;
    [key: string]: unknown;
}

function ProcessTypedNodeImpl({ data, selected }: NodeProps) {
    const nodeData = data as ProcessTypedNodeData;
    const kind: ProcessNodeKind = isProcessNodeKind(nodeData.kind)
        ? nodeData.kind
        : "processStep";
    const meta = NODE_TAXONOMY[kind];
    const Icon = meta.icon;

    // Geometry per shape. Three shapes (rect / diamond / note)
    // → one selector. The chassis classes stay identical.
    const shapeClasses =
        meta.shape === "diamond"
            ? "min-w-[120px] min-h-[80px] rounded-md"
            : meta.shape === "note"
              ? "min-w-[160px] max-w-[280px] rounded-[6px]"
              : "min-w-[160px] max-w-[260px] rounded-[8px]";

    // The "note" annotation kind drops the surface tint to read
    // as a flat sticker, not a button. Rect + diamond keep the
    // brand-default surface.
    const surfaceClasses =
        meta.shape === "note"
            ? "bg-bg-subtle/60"
            : "bg-bg-default/80 backdrop-blur-sm";

    const accentBorder = NODE_ACCENT_BORDER[meta.accent];
    const iconTone = NODE_ACCENT_ICON_TONE[meta.accent];

    return (
        <div
            className={cn(
                "border px-3 py-2 transition-colors",
                shapeClasses,
                surfaceClasses,
                // Selected state — brand ring + slight surface lift.
                // Matches R25's ProcessStepNode active treatment so
                // the visual language stays one piece.
                selected
                    ? "border-[color:var(--brand-default)] ring-2 ring-[color:var(--brand-default)]/40 bg-bg-elevated"
                    : `${accentBorder} hover:border-border-emphasis`,
            )}
            data-process-node="true"
            data-process-node-kind={kind}
            data-selected={selected ? "true" : "false"}
        >
            {meta.hasHandles && (
                <Handle
                    type="target"
                    position={Position.Left}
                    className="!h-2 !w-2 !border-2 !border-[color:var(--brand-default)] !bg-bg-default"
                />
            )}
            <div className="flex items-center gap-tight">
                <Icon
                    className={cn("h-3.5 w-3.5 flex-shrink-0", iconTone)}
                    aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                        className={cn(
                            "truncate text-xs tabular-nums",
                            meta.shape === "note"
                                ? "italic text-content-muted"
                                : "font-semibold text-content-emphasis",
                        )}
                    >
                        {nodeData.label || meta.defaultLabel}
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
                    className="!h-2 !w-2 !border-2 !border-[color:var(--brand-default)] !bg-bg-default"
                />
            )}
        </div>
    );
}

export const ProcessTypedNode = memo(ProcessTypedNodeImpl);

/**
 * Backwards-compat alias — the R25 ratchet at
 * `tests/guards/r25-prb-canvas-integration.test.ts` asserts the
 * existence of `<ProcessStepNode>`. PR-B keeps the export so the
 * structural contract holds; the implementation now flows through
 * the typed renderer.
 */
export const ProcessStepNode = ProcessTypedNode;

/** Canonical xyflow node-type key for the default kind. */
export const PROCESS_STEP_NODE_TYPE = "processStep";
