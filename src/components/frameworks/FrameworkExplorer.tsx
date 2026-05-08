'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic 46 — Framework Explorer.
 *
 * Replaces the flat "Requirements" tab on the framework detail
 * page. Two-pane layout: the tree on the left (sections →
 * requirements [→ sub-requirements]) and a selected-node detail
 * panel on the right. Reuses the generic `<TreeView>` primitive +
 * the new `/tree` API.
 *
 * What it carries forward from the old flat view:
 *   - Search box (now filters the tree, expanding ancestors of any
 *     match so hits stay visible)
 *   - Mapped/unmapped indicator + control count badge per row
 *   - Drilldown into mapped controls for a selected requirement
 *
 * What it adds:
 *   - Real hierarchy with section / requirement / sub-requirement
 *     nesting (3+ levels) drawn from the new tree API
 *   - Global Expand-all / Collapse-all toggle
 *   - Keyboard navigation + ARIA tree semantics inherited from
 *     `<TreeView>`
 *   - Stable side-panel detail view with description + linked
 *     controls
 *
 * Coverage data is reused from the existing
 * `/frameworks/<key>?action=coverage` endpoint — no new server
 * surface is needed for the mapped/unmapped indicators.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import { TreeView } from '@/components/ui/TreeView';
import { TreeViewItem } from '@/components/ui/TreeViewItem';
import { TreeExpandCollapseToggle } from '@/components/ui/TreeExpandCollapseToggle';
import { ComplianceStatusIndicator } from '@/components/ui/ComplianceStatusIndicator';
import { FrameworkMinimap } from '@/components/ui/FrameworkMinimap';
import {
    collectExpandableIds,
    filterTree,
} from '@/lib/framework-tree/tree-helpers';
import type {
    ComplianceStatus,
    FrameworkTreeNode,
    FrameworkTreePayload,
} from '@/lib/framework-tree/types';

// ─── Coverage shapes (subset of the existing coverage usecase output) ──

interface ControlMapping {
    requirementCode: string;
    controlCode: string;
    controlName: string;
    controlStatus: string;
}
interface CoveragePayload {
    controlMappings?: ControlMapping[];
}

// ─── Props ─────────────────────────────────────────────────────────────

export interface FrameworkExplorerProps {
    tree: FrameworkTreePayload;
    coverage: CoveragePayload | null;
    /**
     * Callback when the user picks a requirement. The detail
     * panel renders inline — this is purely for parents that want
     * to react (e.g. URL sync). Selecting a section node is a no-op.
     */
    onRequirementSelected?: (node: FrameworkTreeNode) => void;
}

// ─── Component ─────────────────────────────────────────────────────────

export function FrameworkExplorer({
    tree,
    coverage,
    onRequirementSelected,
}: FrameworkExplorerProps) {
    // ── Derived: per-requirement control mappings, keyed by code. ────
    // The coverage usecase keys by `requirementCode` (not id), so we
    // build a lookup once and reuse it on every selection.
    const controlsByCode = useMemo(() => {
        const map = new Map<string, ControlMapping[]>();
        for (const m of coverage?.controlMappings ?? []) {
            const list = map.get(m.requirementCode) ?? [];
            list.push(m);
            map.set(m.requirementCode, list);
        }
        return map;
    }, [coverage]);

    // ── Search → filtered tree + auto-expansion of matching paths. ───
    const [search, setSearch] = useState('');
    const trimmed = search.trim().toLowerCase();
    const filteredTree = useMemo(() => {
        if (!trimmed) return tree.nodes;
        return filterTree(tree.nodes, (node) => {
            // Sections only match if their LABEL matches — searching
            // "people" surfaces the whole PEOPLE theme. Requirements
            // match on code OR title.
            if (node.kind === 'section') {
                return node.label.toLowerCase().includes(trimmed);
            }
            return (
                (node.code ?? '').toLowerCase().includes(trimmed) ||
                node.title.toLowerCase().includes(trimmed)
            );
        });
    }, [tree.nodes, trimmed]);

    // ── Expansion state. ──────────────────────────────────────────────
    // While a search is active we auto-expand every matching ancestor
    // so hits are visible without the user clicking. When the search
    // clears, we restore the user's manual expansion (cached).
    const [userExpanded, setUserExpanded] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const allExpandableIdsForSearch = useMemo(
        () => collectExpandableIds(filteredTree),
        [filteredTree],
    );
    const expanded: ReadonlySet<string> = trimmed
        ? allExpandableIdsForSearch
        : userExpanded;

    // Total expandable count (for the toggle's tri-state) is computed
    // off the UNFILTERED tree so disabling logic doesn't flicker as
    // the user types.
    const totalExpandable = useMemo(
        () => collectExpandableIds(tree.nodes).size,
        [tree.nodes],
    );

    const handleExpandedChange = useCallback(
        (next: ReadonlySet<string>) => {
            // Ignore writes while search-driven auto-expansion is in
            // effect — they'd be overwritten on the next render anyway.
            if (trimmed) return;
            setUserExpanded(next);
        },
        [trimmed],
    );

    const handleExpandAll = useCallback(() => {
        if (trimmed) {
            // Bail out of search first so the new expansion sticks.
            setSearch('');
        }
        setUserExpanded(collectExpandableIds(tree.nodes));
    }, [tree.nodes, trimmed]);

    const handleCollapseAll = useCallback(() => {
        if (trimmed) setSearch('');
        setUserExpanded(new Set());
    }, [trimmed]);

    // ── Selection. ────────────────────────────────────────────────────
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedNode = useMemo(() => {
        if (!selectedId) return null;
        return findNodeById(tree.nodes, selectedId);
    }, [tree.nodes, selectedId]);

    const handleSelect = useCallback(
        (node: FrameworkTreeNode) => {
            setSelectedId(node.id);
            if (node.kind === 'requirement') {
                onRequirementSelected?.(node);
            }
        },
        [onRequirementSelected],
    );

    // Clear selection when the underlying framework changes.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedId(null);
        setUserExpanded(new Set());
    }, [tree.framework.id]);

    // ── Mapped/unmapped lookup for badges. ────────────────────────────
    const isMapped = useCallback(
        (code: string | undefined) => {
            if (!code) return false;
            return controlsByCode.has(code);
        },
        [controlsByCode],
    );

    // Ref to the tree's scroll container so the minimap can both
    // observe scroll position AND trigger scrollIntoView jumps.
    // Declared BEFORE the empty-state early return so the hook
    // call order stays stable across renders (rules-of-hooks).
    const treeScrollRef = useRef<HTMLDivElement | null>(null);

    // Minimap → tree handler: ensure the section is expanded so the
    // user lands on a populated row, not a collapsed header that
    // would immediately scroll out of view as the surrounding rows
    // re-flow.
    const handleMinimapJump = useCallback(
        (sectionId: string) => {
            if (trimmed) {
                // Search-active overrides expansion — the minimap
                // jump is the user's intent, so clear the search.
                setSearch('');
            }
            setUserExpanded((prev) => {
                if (prev.has(sectionId)) return prev;
                const next = new Set(prev);
                next.add(sectionId);
                return next;
            });
            setSelectedId(sectionId);
        },
        [trimmed],
    );

    // ── Empty state for the tree side. ────────────────────────────────
    if (tree.nodes.length === 0) {
        return (
            <div className="glass-card text-center py-10 text-content-subtle" id="framework-explorer-empty">
                This framework has no requirements yet.
            </div>
        );
    }

    return (
        <div
            className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px),12rem,1fr] gap-4"
            id="framework-explorer"
        >
            {/* ── Tree pane ── */}
            <div className="glass-card flex flex-col min-h-[24rem]">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <input
                        type="text"
                        placeholder="Search code or title..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="input flex-1 min-w-[10rem]"
                        id="framework-explorer-search"
                        aria-label="Search requirements"
                    />
                    <TreeExpandCollapseToggle
                        expandedCount={expanded.size}
                        totalExpandable={totalExpandable}
                        onExpandAll={handleExpandAll}
                        onCollapseAll={handleCollapseAll}
                        id="framework-explorer-toggle"
                    />
                </div>
                <div className="flex items-center justify-between text-xs text-content-subtle mb-2">
                    <span>
                        {tree.totals.sections} sections · {tree.totals.requirements} requirements
                    </span>
                    {trimmed && (
                        <span className="text-[var(--brand-default)]">
                            Search active — all matches expanded
                        </span>
                    )}
                </div>
                <div
                    ref={treeScrollRef}
                    className="flex-1 overflow-y-auto -mx-2 px-1"
                    id="framework-explorer-tree-scroll"
                >
                    <TreeView
                        nodes={filteredTree}
                        expanded={expanded}
                        onExpandedChange={handleExpandedChange}
                        selectedId={selectedId}
                        onSelect={handleSelect}
                        ariaLabel={`${tree.framework.name} requirements`}
                        renderItem={(node, ctx) => (
                            <FrameworkTreeRow
                                node={node}
                                ctx={ctx}
                                isMapped={isMapped(node.code)}
                                mappedCount={
                                    node.code ? controlsByCode.get(node.code)?.length ?? 0 : 0
                                }
                                onToggle={() => {
                                    if (trimmed) return; // honour the search-active gate
                                    const next = new Set(expanded);
                                    if (next.has(node.id)) next.delete(node.id);
                                    else next.add(node.id);
                                    handleExpandedChange(next);
                                }}
                                onSelect={() => handleSelect(node)}
                            />
                        )}
                    />
                </div>
            </div>

            {/* ── Minimap (Epic 46.3) ── */}
            <div className="hidden lg:block">
                <FrameworkMinimap
                    nodes={tree.nodes}
                    scrollContainerRef={treeScrollRef}
                    onSectionSelected={handleMinimapJump}
                />
            </div>

            {/* ── Detail pane ── */}
            <div className="glass-card min-h-[24rem]" id="framework-explorer-detail">
                {!selectedNode ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-content-subtle px-6 py-10">
                        <FileText className="w-8 h-8 mb-2 opacity-60" aria-hidden="true" />
                        <p className="text-sm font-medium text-content-muted">Select a requirement</p>
                        <p className="text-xs mt-1 max-w-xs">
                            Click any requirement on the left to see its description and the controls
                            currently mapped to it.
                        </p>
                    </div>
                ) : selectedNode.kind === 'section' ? (
                    <SectionDetail node={selectedNode} />
                ) : (
                    <RequirementDetail
                        node={selectedNode}
                        controls={controlsByCode.get(selectedNode.code ?? '') ?? []}
                    />
                )}
            </div>
        </div>
    );
}

// ─── Row renderer ──────────────────────────────────────────────────────

interface FrameworkTreeRowProps {
    node: FrameworkTreeNode;
    ctx: {
        depth: number;
        expanded: boolean;
        selected: boolean;
        focusable: boolean;
        loading: boolean;
    };
    isMapped: boolean;
    mappedCount: number;
    onToggle: () => void;
    onSelect: () => void;
}

function FrameworkTreeRow({
    node,
    ctx,
    isMapped,
    mappedCount,
    onToggle,
    onSelect,
}: FrameworkTreeRowProps) {
    // Epic 46.3 — compliance status comes from the server. Sections
    // get the aggregated status; requirements get their own. When
    // the tree was loaded without coverage context the status falls
    // back to `undefined` and we render the legacy mapped/unmapped
    // affordance — that's a safety net, not the happy path.
    const status: ComplianceStatus | undefined = node.complianceStatus;
    const isSection = node.kind === 'section';

    let indicator: React.ReactNode = null;
    let meta: React.ReactNode;

    if (isSection) {
        // Sections show the aggregated status as a small dot plus
        // the descendant count. Avoids the "Mapped (37)" green-bias
        // bug where a section with 30 in-progress controls looked
        // green just because every requirement had at least one
        // mapped control.
        if (status) {
            indicator = (
                <ComplianceStatusIndicator status={status} mode="dot" />
            );
        }
        meta = (
            <span className="text-content-subtle text-[11px]">
                {node.descendantCount}
            </span>
        );
    } else {
        // Requirement rows: the dot encodes compliance status; the
        // meta badge shows the mapped-controls count when there is
        // one, otherwise the explicit "Unmapped" pill.
        if (status) {
            indicator = (
                <ComplianceStatusIndicator status={status} mode="dot" />
            );
            meta = isMapped ? (
                <span className="text-[10px] text-content-subtle tabular-nums">
                    {mappedCount}
                </span>
            ) : (
                <ComplianceStatusIndicator
                    status="gap"
                    mode="chip"
                    labelled={false}
                />
            );
        } else {
            // Coverage data missing — fall back to the prompt-2 affordance.
            meta = isMapped ? (
                <span className="badge badge-success text-[10px] py-0.5 px-1.5">
                    {mappedCount}
                </span>
            ) : (
                <span
                    className="badge text-[10px] py-0.5 px-1.5"
                    style={{ background: 'rgba(100,116,139,0.25)', color: '#94a3b8' }}
                >
                    Unmapped
                </span>
            );
        }
    }

    return (
        <TreeViewItem
            id={node.id}
            label={node.label}
            secondary={
                isSection ? null : (
                    <span className="inline-flex items-center gap-1.5">
                        {indicator}
                        <span>{node.title}</span>
                    </span>
                )
            }
            meta={
                isSection ? (
                    <span className="inline-flex items-center gap-1.5">
                        {indicator}
                        {meta}
                    </span>
                ) : (
                    meta
                )
            }
            depth={ctx.depth}
            hasChildren={node.hasChildren}
            expanded={ctx.expanded}
            selected={ctx.selected}
            focusable={ctx.focusable}
            loading={ctx.loading}
            onToggle={onToggle}
            onSelect={onSelect}
        />
    );
}

// ─── Detail-pane sub-components ────────────────────────────────────────

function SectionDetail({ node }: { node: FrameworkTreeNode }) {
    return (
        <div className="p-5">
            <p className="text-xs uppercase tracking-wider text-content-subtle mb-1">
                Section
            </p>
            <h3 className="text-base font-semibold text-content-emphasis">{node.label}</h3>
            <p className="text-xs text-content-muted mt-2">
                {node.descendantCount} requirement
                {node.descendantCount === 1 ? '' : 's'} in this section.
            </p>
        </div>
    );
}

function RequirementDetail({
    node,
    controls,
}: {
    node: FrameworkTreeNode;
    controls: ControlMapping[];
}) {
    return (
        <div className="p-5 space-y-4" id="framework-explorer-requirement-detail">
            <div>
                <p className="text-xs uppercase tracking-wider text-content-subtle mb-1">
                    Requirement
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                    <code className="text-sm font-mono text-[var(--brand-default)]">
                        {node.code}
                    </code>
                    <h3 className="text-base font-semibold text-content-emphasis">
                        {node.title}
                    </h3>
                    {node.complianceStatus && (
                        <ComplianceStatusIndicator
                            status={node.complianceStatus}
                            mode="chip"
                        />
                    )}
                </div>
            </div>

            {node.description && (
                <p className="text-sm text-content-muted whitespace-pre-line">
                    {node.description}
                </p>
            )}

            {node.children.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-content-subtle mb-2">
                        Sub-requirements ({node.children.length})
                    </p>
                    <ul className="space-y-1">
                        {node.children.map((c) => (
                            <li key={c.id} className="text-xs text-content-default">
                                <code className="font-mono text-[var(--brand-default)] mr-2">
                                    {c.code}
                                </code>
                                {c.title}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-content-subtle">
                        Mapped Controls ({controls.length})
                    </p>
                    {controls.length === 0 && (
                        <span className="text-[10px] text-content-warning">Unmapped</span>
                    )}
                </div>
                {controls.length === 0 ? (
                    <p className="text-xs text-content-subtle italic">
                        No controls are currently mapped to this requirement.
                    </p>
                ) : (
                    <ul className="space-y-1.5">
                        {controls.map((c, i) => (
                            <li
                                key={`${c.controlCode}-${i}`}
                                className="flex items-center gap-2 text-xs"
                            >
                                <code className="font-mono text-[var(--brand-default)] truncate max-w-[8rem]">
                                    {c.controlCode}
                                </code>
                                <span className="text-content-default flex-1 truncate">
                                    {c.controlName}
                                </span>
                                <span
                                    className={`badge text-[10px] ${
                                        c.controlStatus === 'IMPLEMENTED'
                                            ? 'badge-success'
                                            : c.controlStatus === 'IN_PROGRESS'
                                              ? 'badge-warning'
                                              : 'badge-primary'
                                    }`}
                                >
                                    {c.controlStatus}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

// ─── Local utility ─────────────────────────────────────────────────────

function findNodeById(
    nodes: ReadonlyArray<FrameworkTreeNode>,
    id: string,
): FrameworkTreeNode | null {
    for (const n of nodes) {
        if (n.id === id) return n;
        const sub = findNodeById(n.children, id);
        if (sub) return sub;
    }
    return null;
}

// Re-export so callers that just want one import path can pull it
// from the explorer module.
export { TreeExpandCollapseToggle };
