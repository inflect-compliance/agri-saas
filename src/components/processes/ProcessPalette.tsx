"use client";

/**
 * Roadmap-26 PR-B — ProcessPalette.
 *
 * Slim top toolbar carrying seven draggable "stamps", one per
 * canonical node kind (see `node-taxonomy.ts`). Each stamp is
 * HTML5-draggable; dragging onto the canvas drops a new node of
 * that kind at the cursor position.
 *
 * The drag payload is a JSON-encoded
 *
 *     { kind: ProcessNodeKind, label: string }
 *
 * carried on the canonical `PALETTE_DRAG_MIME` mime type. This
 * replaces the R25-era "label-only" payload (which only ever
 * shipped a single kind). The canvas-side drop handler parses the
 * JSON and falls back to `processStep` if the payload is missing
 * or malformed — backwards-compatible with any drag source still
 * sending raw labels.
 *
 * Design discipline (per the R26-PR-B brief): the palette is
 * RESTRAINED. The seven stamps fit on one slim row; no expanding
 * sub-trees, no sidebar palette, no category headers cluttering
 * the chrome. If the canonical taxonomy ever grows past nine
 * kinds, that's the moment to split the palette into a
 * disclosure-style picker — not the moment to "just add another
 * row".
 */

import type { DragEvent } from "react";
import { NODE_TAXONOMY, NODE_TAXONOMY_ORDER } from "./node-taxonomy";
import type { ProcessNodeKind } from "./node-taxonomy";

/**
 * Canonical drag-data mime type for palette → canvas transfers.
 * The canvas reads this on `onDrop` to identify palette payloads
 * (vs unrelated drag sources like file uploads).
 */
export const PALETTE_DRAG_MIME = "application/x-inflect-process-step";

/**
 * Payload contract — the canvas's drop handler parses this shape.
 * Kept as an exported type so the canvas + tests stay in lockstep
 * with the palette's emission.
 */
export interface PaletteDropPayload {
    kind: ProcessNodeKind;
    label: string;
}

export function ProcessPalette() {
    const onDragStart = (
        event: DragEvent<HTMLDivElement>,
        kind: ProcessNodeKind,
        label: string,
    ) => {
        const payload: PaletteDropPayload = { kind, label };
        event.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = "move";
    };

    return (
        <div
            className="flex flex-wrap items-center gap-tight border-b border-border-subtle bg-bg-default/40 px-3 py-2"
            data-process-palette="true"
        >
            <span className="text-xs uppercase tracking-wide text-content-muted mr-2">
                Palette
            </span>
            {NODE_TAXONOMY_ORDER.map((kind) => {
                const meta = NODE_TAXONOMY[kind];
                const Icon = meta.icon;
                return (
                    <div
                        key={kind}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => onDragStart(e, kind, meta.label)}
                        data-palette-item={kind}
                        title={meta.description}
                        aria-label={`Drag to add a ${meta.label.toLowerCase()} node`}
                        className="inline-flex h-8 items-center gap-tight rounded-[8px] border border-border-subtle bg-bg-default/30 px-2.5 text-xs font-medium text-content-emphasis cursor-grab active:cursor-grabbing hover:border-border-emphasis hover:bg-bg-muted transition-colors"
                    >
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {meta.label}
                    </div>
                );
            })}
        </div>
    );
}
