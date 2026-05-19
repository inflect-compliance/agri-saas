"use client";

/**
 * R26-PR-A — PersistedProcessCanvas.
 *
 * Bridges the page's process-selection chrome to the underlying
 * xyflow canvas, adding:
 *
 *   • Server load of the selected map's graph (fetch on
 *     `activeId` change → `initialNodes` / `initialEdges` rehydrate)
 *   • Save button that PUTs the current canvas state back
 *   • New-process button that POSTs a fresh map
 *   • A minimal process selector at the top of the body
 *
 * The richer editor UX (visible name editing, save-as, inspector,
 * alignment, undo-redo) is intentionally NOT here — that lands in
 * R26-PR-E. PR-A's only ambition is: prove the persistence loop.
 *
 * State ownership:
 *   • The PersistedProcessCanvas owns the xyflow `nodes` + `edges`
 *     state. R25's `ProcessCanvas` always owned its own state and
 *     accepted `initialNodes` / `initialEdges` for rehydration; for
 *     PR-A we hoist that state up one level so the Save callback
 *     can read the current graph synchronously.
 *   • The canvas inner component is re-keyed on `activeId` so that
 *     opening a different map fully unmounts the existing xyflow
 *     instance (cheaper than trying to diff-update; xyflow handles
 *     mount in <100ms even for several-hundred-node graphs).
 */
import {
    useCallback,
    useEffect,
    useState,
    type DragEvent,
    type ReactNode,
} from "react";
import {
    Background,
    BackgroundVariant,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type EdgeTypes,
    type Node,
    type NodeChange,
    type NodeTypes,
    type OnConnect,
    type OnEdgesChange,
    type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import {
    ProcessPalette,
    PALETTE_DRAG_MIME,
    type PaletteDropPayload,
} from "./ProcessPalette";
import { ProcessTypedNode, PROCESS_STEP_NODE_TYPE } from "./ProcessTypedNode";
import {
    NODE_TAXONOMY,
    NODE_TAXONOMY_ORDER,
    isProcessNodeKind,
    type ProcessNodeKind,
} from "./node-taxonomy";
import { ProcessEdge, PROCESS_EDGE_TYPE } from "./ProcessEdge";
import type { ProcessMapSummary } from "@/app/t/[tenantSlug]/(app)/processes/ProcessesClient";

// Every taxonomy kind registers the SAME renderer. The renderer
// branches internally on `data.kind` so the chassis stays shared.
// Module-level so the reference is stable across re-renders
// (xyflow warns + remounts every node when `nodeTypes` changes).
const NODE_TYPES: NodeTypes = Object.fromEntries(
    NODE_TAXONOMY_ORDER.map((kind) => [kind, ProcessTypedNode]),
);
const EDGE_TYPES: EdgeTypes = {
    [PROCESS_EDGE_TYPE]: ProcessEdge,
};

interface PersistedProcessCanvasProps {
    tenantSlug: string;
    processes: ProcessMapSummary[];
    activeId: string | null;
    onActiveIdChange: (id: string | null) => void;
    onProcessesChange: (next: ProcessMapSummary[]) => void;
}

export function PersistedProcessCanvas(props: PersistedProcessCanvasProps) {
    return (
        <ReactFlowProvider>
            <Inner {...props} />
        </ReactFlowProvider>
    );
}

interface LoadedGraph {
    mapId: string;
    nodes: Node[];
    edges: Edge[];
    version: number;
}

function Inner({
    tenantSlug,
    processes,
    activeId,
    onActiveIdChange,
    onProcessesChange,
}: PersistedProcessCanvasProps) {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [loadedMap, setLoadedMap] = useState<LoadedGraph | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { screenToFlowPosition } = useReactFlow();

    // ─── Server load on activeId change ────────────────────────────

    useEffect(() => {
        if (!activeId) {
            setNodes([]);
            setEdges([]);
            setLoadedMap(null);
            return;
        }
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(
                    `/api/t/${tenantSlug}/processes/${activeId}`,
                );
                if (!res.ok) throw new Error(`Load failed (${res.status})`);
                const data = (await res.json()) as {
                    id: string;
                    version: number;
                    nodes: Array<{
                        nodeKey: string;
                        nodeType: string;
                        label: string;
                        subtitle: string | null;
                        posX: number;
                        posY: number;
                    }>;
                    edges: Array<{
                        edgeKey: string;
                        sourceKey: string;
                        targetKey: string;
                        edgeKind: string;
                        labelOverride: string | null;
                    }>;
                };
                if (cancelled) return;
                const rehydratedNodes: Node[] = data.nodes.map((n) => {
                    // The `nodeType` column is forward-compatible
                    // (typed `String`, not enum) so unknown kinds
                    // never crash rehydration. Fall back to the
                    // default kind; the renderer does the same.
                    const kind: ProcessNodeKind = isProcessNodeKind(n.nodeType)
                        ? n.nodeType
                        : PROCESS_STEP_NODE_TYPE;
                    return {
                        id: n.nodeKey,
                        type: kind,
                        position: { x: n.posX, y: n.posY },
                        data: {
                            label: n.label,
                            kind,
                            ...(n.subtitle ? { subtitle: n.subtitle } : {}),
                        },
                    };
                });
                const rehydratedEdges: Edge[] = data.edges.map((e) => ({
                    id: e.edgeKey,
                    source: e.sourceKey,
                    target: e.targetKey,
                    type: PROCESS_EDGE_TYPE,
                    ...(e.labelOverride ? { label: e.labelOverride } : {}),
                }));
                setNodes(rehydratedNodes);
                setEdges(rehydratedEdges);
                setLoadedMap({
                    mapId: data.id,
                    nodes: rehydratedNodes,
                    edges: rehydratedEdges,
                    version: data.version,
                });
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Load failed");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [activeId, tenantSlug]);

    // ─── Save current canvas state ─────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!activeId) return;
        setSaving(true);
        setError(null);
        try {
            const payload = {
                nodes: nodes.map((n, idx) => {
                    // The xyflow node carries its kind on `type`
                    // (registered in NODE_TYPES) AND on `data.kind`
                    // (consumed by the renderer). Both come back
                    // from the rehydration step. On save we trust
                    // `n.type` — it is the canonical xyflow
                    // identifier and the field the registry keys
                    // off — and fall back to the default kind if
                    // it ever drifts.
                    const kind: ProcessNodeKind = isProcessNodeKind(n.type)
                        ? n.type
                        : PROCESS_STEP_NODE_TYPE;
                    const meta = NODE_TAXONOMY[kind];
                    const dataLabel =
                        n.data &&
                        typeof (n.data as { label?: unknown }).label ===
                            "string"
                            ? (n.data as { label: string }).label
                            : meta.defaultLabel;
                    const dataSubtitle =
                        n.data &&
                        typeof (n.data as { subtitle?: unknown }).subtitle ===
                            "string"
                            ? (n.data as { subtitle: string }).subtitle
                            : null;
                    return {
                        nodeKey: n.id || `node-${idx + 1}`,
                        nodeType: kind,
                        label: dataLabel,
                        subtitle: dataSubtitle,
                        posX: n.position.x,
                        posY: n.position.y,
                    };
                }),
                edges: edges.map((e, idx) => ({
                    edgeKey: e.id || `edge-${idx + 1}`,
                    sourceKey: e.source,
                    targetKey: e.target,
                    edgeKind: "flow",
                    labelOverride:
                        typeof e.label === "string" ? e.label : null,
                    controls: [],
                })),
            };
            const res = await fetch(
                `/api/t/${tenantSlug}/processes/${activeId}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            );
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
            const data = await res.json();
            // Update the summary list with the fresh version + updatedAt
            onProcessesChange(
                processes.map((p) =>
                    p.id === activeId
                        ? {
                              ...p,
                              version: data.version,
                              updatedAt: data.updatedAt,
                              nodeCount: data.nodes.length,
                              edgeCount: data.edges.length,
                          }
                        : p,
                ),
            );
            setLoadedMap({
                mapId: data.id,
                nodes,
                edges,
                version: data.version,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    }, [activeId, nodes, edges, tenantSlug, processes, onProcessesChange]);

    // ─── Create new process ────────────────────────────────────────

    const handleNew = useCallback(async () => {
        setCreating(true);
        setError(null);
        try {
            const name = `Untitled process ${processes.length + 1}`;
            const res = await fetch(`/api/t/${tenantSlug}/processes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) throw new Error(`Create failed (${res.status})`);
            const data = await res.json();
            const summary: ProcessMapSummary = {
                id: data.id,
                name: data.name,
                description: data.description,
                status: data.status,
                version: data.version,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                nodeCount: 0,
                edgeCount: 0,
            };
            onProcessesChange([summary, ...processes]);
            onActiveIdChange(data.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Create failed");
        } finally {
            setCreating(false);
        }
    }, [tenantSlug, processes, onProcessesChange, onActiveIdChange]);

    // ─── Canvas plumbing (xyflow change handlers + drop) ───────────

    const onNodesChange = useCallback<OnNodesChange>(
        (changes: NodeChange[]) =>
            setNodes((nds) => applyNodeChanges(changes, nds)),
        [],
    );
    const onEdgesChange = useCallback<OnEdgesChange>(
        (changes: EdgeChange[]) =>
            setEdges((eds) => applyEdgeChanges(changes, eds)),
        [],
    );
    const onConnect = useCallback<OnConnect>(
        (c: Connection) =>
            setEdges((eds) =>
                addEdge({ ...c, type: PROCESS_EDGE_TYPE, id: `edge-${Date.now()}` }, eds),
            ),
        [],
    );
    const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);
    const onDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const raw = event.dataTransfer.getData(PALETTE_DRAG_MIME);
            if (!raw) return;
            // R26-PR-B widened the palette payload from a raw label
            // (`"Process step"`) to a JSON object `{ kind, label }`.
            // Parse the structured form first; if that fails we
            // gracefully fall back to treating `raw` as a label and
            // minting a default-kind step node. The fallback keeps
            // backwards compat with any stale drag source still
            // sending the R25 payload shape.
            let kind: ProcessNodeKind = PROCESS_STEP_NODE_TYPE;
            let label = raw;
            try {
                const parsed = JSON.parse(raw) as PaletteDropPayload;
                if (
                    parsed &&
                    typeof parsed === "object" &&
                    isProcessNodeKind(parsed.kind) &&
                    typeof parsed.label === "string"
                ) {
                    kind = parsed.kind;
                    label = parsed.label;
                }
            } catch {
                // Non-JSON payload — keep the raw-label fallback.
            }
            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            const meta = NODE_TAXONOMY[kind];
            setNodes((nds) => [
                ...nds,
                {
                    id: `node-${Date.now()}`,
                    type: kind,
                    position,
                    data: { label: label || meta.defaultLabel, kind },
                },
            ]);
        },
        [screenToFlowPosition],
    );

    const showEmpty = !activeId;

    return (
        <div className="flex h-full w-full flex-col" data-process-canvas="true">
            {/* Slim header strip: selector + actions. R26-PR-E will
                refine this into a proper editor toolbar. */}
            <div
                className="flex items-center gap-default border-b border-border-subtle bg-bg-default/60 px-3 py-2"
                data-persisted-canvas-toolbar="true"
            >
                <select
                    value={activeId ?? ""}
                    onChange={(e) =>
                        onActiveIdChange(e.target.value || null)
                    }
                    disabled={processes.length === 0 || loading || saving}
                    className="rounded-[6px] border border-border-subtle bg-bg-default px-2 py-1 text-xs text-content-emphasis"
                    aria-label="Select process map"
                    data-testid="process-selector"
                >
                    {processes.length === 0 && (
                        <option value="">(no processes yet)</option>
                    )}
                    {processes.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleNew}
                    disabled={creating}
                    data-testid="new-process-btn"
                >
                    {creating ? "Creating…" : "New process"}
                </Button>
                <div className="ml-auto flex items-center gap-default">
                    {error && (
                        <span
                            className="text-xs text-content-error"
                            role="alert"
                        >
                            {error}
                        </span>
                    )}
                    {loadedMap && (
                        <span className="text-xs text-content-subtle tabular-nums">
                            v{loadedMap.version}
                        </span>
                    )}
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={handleSave}
                        disabled={!activeId || saving || loading}
                        data-testid="save-process-btn"
                    >
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </div>
            </div>

            <ProcessPalette />
            <div
                className="relative flex-1 min-h-0"
                onDragOver={onDragOver}
                onDrop={onDrop}
            >
                {showEmpty && (
                    <CanvasEmpty
                        onNew={handleNew}
                        creating={creating}
                    />
                )}
                {!showEmpty && nodes.length === 0 && !loading && (
                    <div
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                        data-canvas-empty-state="true"
                    >
                        <p className="text-sm text-content-muted">
                            Drag a process step from the palette to begin.
                        </p>
                    </div>
                )}
                <ReactFlow
                    key={activeId ?? "no-map"}
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    fitView
                    proOptions={{ hideAttribution: true }}
                    aria-label="Process canvas"
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={24}
                        size={1.4}
                        color="var(--border-subtle)"
                    />
                </ReactFlow>
            </div>
        </div>
    );
}

function CanvasEmpty({
    onNew,
    creating,
}: {
    onNew: () => void;
    creating: boolean;
}): ReactNode {
    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-default">
                <p className="text-sm text-content-muted">
                    No process maps yet.
                </p>
                <Button
                    size="sm"
                    variant="primary"
                    onClick={onNew}
                    disabled={creating}
                    data-testid="empty-state-new-btn"
                >
                    {creating ? "Creating…" : "Create your first process"}
                </Button>
            </div>
        </div>
    );
}
