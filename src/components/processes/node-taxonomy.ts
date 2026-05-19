/**
 * Roadmap-26 PR-B — Process Canvas node taxonomy.
 *
 * R25 shipped exactly one node type — `processStep`. That's
 * adequate for a proof-of-concept canvas but not for a real
 * business/IT process-mapping surface: you can't tell decision
 * points apart from steps, can't anchor governance context on
 * the map, can't drop annotations.
 *
 * This file is the single source of truth for the seven canonical
 * node kinds, the rationale for each, and the visual + interaction
 * metadata that the palette + the typed-node renderer consume.
 *
 * The seven kinds + their justifications:
 *
 *   1. `processStep` — an operational activity in the flow.
 *      The atom. Every other kind exists to give a step
 *      context.
 *   2. `decision` — a branch point. Diamond shape is the
 *      universal symbol for "the flow forks here"; without
 *      this, branches collapse into ambiguous step-to-step
 *      lines and the reader has to infer where the choice
 *      lives.
 *   3. `control` — a governance/control element ATTACHED to
 *      a step. PR-D makes controls primarily edge-mounted
 *      (control sits on the connection between two steps),
 *      but a control NODE remains useful for controls that
 *      gate a step in place (e.g. dual-approval at a single
 *      action) or for documenting orphan controls during
 *      authoring before the edge is drawn.
 *   4. `risk` — a risk associated with a step. Warning-tone
 *      border + triangle icon read as "watch out here"
 *      without competing with the flow itself for visual
 *      weight.
 *   5. `asset` — the system / datastore / document a step
 *      acts upon. One node type covers all three because
 *      IC's data model already groups them under a single
 *      Asset entity with a typed `assetType` field; the
 *      canvas inherits that grouping.
 *   6. `external` — an external party (vendor, customer,
 *      regulator) involved in the flow. Dashed border is the
 *      universal "outside the org" signal. Distinguishes
 *      "step we do" from "step they do" without forcing the
 *      reader to read every label.
 *   7. `annotation` — a free-text note. No flow semantics
 *      (no handles), borderless, italic. Lets authors leave
 *      reviewer prompts / open questions on the canvas
 *      without polluting the actual graph.
 *
 * Kinds DELIBERATELY omitted (and why):
 *
 *   • `system` / `datastore` / `document` as separate kinds
 *     — these are subtypes of Asset. The Asset domain model
 *     already encodes them via `assetType`; reintroducing
 *     them at the canvas layer would create two taxonomies
 *     that drift. Future per-asset-type visual variants can
 *     ride on the node's `dataJson.assetType` slot without
 *     a new top-level kind.
 *
 *   • `start` / `end` markers — adds two more nodes for a
 *     concept (graph endpoints) the reader infers naturally
 *     from "the leftmost node" / "the rightmost node". The
 *     industry consensus (BPMN excluded) has moved away from
 *     dedicated start/end shapes for lightweight authoring
 *     surfaces.
 *
 *   • `event` / `signal` / `timer` — BPMN-style event
 *     primitives. Adds twelve concepts for one or two
 *     genuine use cases; out of scope for the IC product.
 */

import type { LucideIcon } from 'lucide-react';
import {
    Box,
    FileText,
    GitBranch,
    Globe,
    ShieldCheck,
    AlertTriangle,
    StickyNote,
} from 'lucide-react';

export type ProcessNodeKind =
    | 'processStep'
    | 'decision'
    | 'control'
    | 'risk'
    | 'asset'
    | 'external'
    | 'annotation';

/**
 * Visual-language accents. Each maps to an IC semantic colour
 * token at render time so a future theme swap (Roadmap-19/24-style
 * carbon → glass) flips every node kind in lockstep without per-
 * node edits.
 */
export type NodeAccent =
    | 'brand'           // process step (default — quiet, primary surface)
    | 'brand-secondary' // control (navy/blue family)
    | 'warning'         // risk (amber — caution without alarm)
    | 'success'         // asset (calm green — "here is data")
    | 'neutral'         // decision (graphite — structural)
    | 'subtle';         // external + annotation (lowest visual weight)

/**
 * Shape vocabulary — three SHAPES, mapping to seven KINDS. Limiting
 * to three shapes keeps the canvas from looking like a sticker
 * sheet. The accent + icon do the per-kind work.
 */
export type NodeShape = 'rect' | 'diamond' | 'note';

export interface NodeTypeMeta {
    /** Canonical kind id (persisted in `ProcessNode.nodeType`). */
    id: ProcessNodeKind;
    /** Palette label. */
    label: string;
    /** Palette tooltip / inspector description. */
    description: string;
    /** Decorative icon. Pure visual signal; not the accessible name. */
    icon: LucideIcon;
    accent: NodeAccent;
    shape: NodeShape;
    /**
     * Whether the kind participates in the graph as a source /
     * target of edges. Annotation is the only kind without
     * handles — it floats free of the flow.
     */
    hasHandles: boolean;
    /**
     * Default placeholder label rendered when the user drops a
     * new node without typing one. Per-kind so a fresh control
     * doesn't say "Untitled step".
     */
    defaultLabel: string;
}

export const NODE_TAXONOMY: Record<ProcessNodeKind, NodeTypeMeta> = {
    processStep: {
        id: 'processStep',
        label: 'Process step',
        description: 'An operational activity in the flow.',
        icon: Box,
        accent: 'brand',
        shape: 'rect',
        hasHandles: true,
        defaultLabel: 'Untitled step',
    },
    decision: {
        id: 'decision',
        label: 'Decision',
        description: 'A branch point where the flow forks.',
        icon: GitBranch,
        accent: 'neutral',
        shape: 'diamond',
        hasHandles: true,
        defaultLabel: 'Decision?',
    },
    control: {
        id: 'control',
        label: 'Control',
        description: 'A governance / control element attached to a step.',
        icon: ShieldCheck,
        accent: 'brand-secondary',
        shape: 'rect',
        hasHandles: true,
        defaultLabel: 'Control',
    },
    risk: {
        id: 'risk',
        label: 'Risk',
        description: 'A risk associated with this step.',
        icon: AlertTriangle,
        accent: 'warning',
        shape: 'rect',
        hasHandles: true,
        defaultLabel: 'Risk',
    },
    asset: {
        id: 'asset',
        label: 'Asset',
        description: 'A system, datastore, or document the step acts upon.',
        icon: FileText,
        accent: 'success',
        shape: 'rect',
        hasHandles: true,
        defaultLabel: 'Asset',
    },
    external: {
        id: 'external',
        label: 'External party',
        description: 'A vendor, customer, or regulator involved in the flow.',
        icon: Globe,
        accent: 'subtle',
        shape: 'rect',
        hasHandles: true,
        defaultLabel: 'External party',
    },
    annotation: {
        id: 'annotation',
        label: 'Annotation',
        description: 'A free-text note. No flow semantics.',
        icon: StickyNote,
        accent: 'subtle',
        shape: 'note',
        hasHandles: false,
        defaultLabel: 'Note',
    },
};

/**
 * Ordered taxonomy — drives the palette's left-to-right layout.
 * Order matters: flow primitives (step + decision) first; then
 * the three governance/context kinds; then the two annotation-
 * tone kinds last. Reading from left to right, the palette
 * communicates "build the flow → layer the context → leave a
 * note".
 */
export const NODE_TAXONOMY_ORDER: ProcessNodeKind[] = [
    'processStep',
    'decision',
    'control',
    'risk',
    'asset',
    'external',
    'annotation',
];

/**
 * Type-guard for runtime payloads. `nodeType` on persisted rows
 * is `String` (not the enum) because the column is forward-
 * compatible with kinds we haven't designed yet. This guard
 * catches unknown kinds at the render boundary so we can fall
 * back to `processStep` instead of crashing the canvas.
 */
export function isProcessNodeKind(value: unknown): value is ProcessNodeKind {
    return (
        typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(NODE_TAXONOMY, value)
    );
}

/**
 * Accent → Tailwind class fragments. One small lookup so the
 * typed-node renderer doesn't carry a per-accent switch.
 *
 * Each value is composed at render time with the chassis classes;
 * keep it as fragments (not full strings) so future PRs can swap
 * the chassis without rewriting the accent table.
 */
export const NODE_ACCENT_BORDER: Record<NodeAccent, string> = {
    brand: 'border-border-subtle',
    'brand-secondary':
        'border-[color:var(--brand-secondary-muted,var(--brand-secondary-default))]',
    warning: 'border-[color:var(--content-warning)]',
    success: 'border-[color:var(--content-success)]',
    neutral: 'border-border-default',
    subtle: 'border-border-subtle border-dashed',
};

export const NODE_ACCENT_ICON_TONE: Record<NodeAccent, string> = {
    brand: 'text-content-emphasis',
    'brand-secondary': 'text-[color:var(--brand-secondary-default)]',
    warning: 'text-[color:var(--content-warning)]',
    success: 'text-[color:var(--content-success)]',
    neutral: 'text-content-muted',
    subtle: 'text-content-subtle',
};
