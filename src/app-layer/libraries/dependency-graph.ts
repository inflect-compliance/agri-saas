/**
 * Dependency Graph — Topological sort and cycle detection for YAML library dependencies.
 *
 * Libraries can declare dependencies on other libraries via the `dependencies` field.
 * When loading or importing multiple libraries, they must be processed in dependency
 * order: a library's dependencies must be loaded before the library itself.
 *
 * This module provides:
 * 1. Graph construction from LoadedLibrary sets
 * 2. Topological sort (Kahn's algorithm) for deterministic ordering
 * 3. Cycle detection with clear error reporting
 * 4. Safe handling of missing dependencies (warn, don't crash)
 *
 * Architecture:
 * ─────────────
 * This is a pure-logic module. No Prisma, no filesystem, no side effects.
 * It operates entirely on in-memory LoadedLibrary/StoredLibrary data.
 */

// ─── Error Types ─────────────────────────────────────────────────────

export class DependencyCycleError extends Error {
    constructor(
        public readonly cycle: string[],
    ) {
        const cycleStr = cycle.join(' → ');
        super(`Dependency cycle detected: ${cycleStr}`);
        this.name = 'DependencyCycleError';
    }
}

// ─── Types ───────────────────────────────────────────────────────────

/** Minimal shape needed for dependency resolution — avoids coupling to LoadedLibrary. */
export interface DependencyNode {
    /** Library URN (unique identifier) */
    readonly urn: string;
    /** Display name (for error messages) */
    readonly name: string;
    /** URNs of libraries this one depends on */
    readonly dependencies: readonly string[];
}

/** Result of a dependency resolution. */
export interface DependencyResolution {
    /** Libraries in topological order (dependencies first) */
    readonly order: readonly string[];
    /** Libraries that have dependencies not present in the input set */
    readonly missingDependencies: ReadonlyMap<string, readonly string[]>;
    /** Whether all declared dependencies are satisfied */
    readonly fullyResolved: boolean;
}

// ─── Graph Construction ──────────────────────────────────────────────

/**
 * Build an adjacency list from a set of dependency nodes.
 * Returns a map of URN → set of dependency URNs.
 */
function buildAdjacencyList(nodes: DependencyNode[]): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    const knownUrns = new Set(nodes.map(n => n.urn));

    for (const node of nodes) {
        // Only include dependencies that exist in the input set
        const deps = new Set<string>();
        for (const dep of node.dependencies) {
            if (knownUrns.has(dep)) {
                deps.add(dep);
            }
        }
        adj.set(node.urn, deps);
    }

    return adj;
}

// ─── Topological Sort (Kahn's Algorithm) ─────────────────────────────

/**
 * Perform a topological sort on a set of dependency nodes.
 *
 * Uses Kahn's algorithm for deterministic, stable ordering:
 * 1. Compute in-degrees for all nodes
 * 2. Start with nodes that have zero in-degree (no dependents)
 * 3. Process each node, decrementing in-degrees of its dependencies
 * 4. Repeat until all nodes are processed or a cycle is detected
 *
 * Nodes with equal priority are sorted lexicographically by URN
 * to ensure deterministic output across runs.
 *
 * @throws DependencyCycleError if a cycle exists
 */
export function topologicalSort(nodes: DependencyNode[]): string[] {
    if (nodes.length === 0) return [];

    // Note: no early return for length === 1 — self-dependencies must be caught

    const adj = buildAdjacencyList(nodes);

    // Start with nodes that have no dependencies pointing into them
    // (i.e., they are depended on by nobody, or they are leaf consumers)
    //
    // Wait — we need to reverse the logic: dependencies-first.
    // A depends on B means B must come first.
    // In Kahn's, we want to emit nodes with in-degree 0 — those with
    // no nodes depending on them... which is backwards.
    //
    // Let's think about this correctly:
    // Edge: A → B means "A depends on B" → B must be loaded before A.
    // For topo sort: we want B before A.
    //
    // In standard Kahn's with edge A→B in the adj list:
    // in-degree of B = 1 (A points to B)
    // We start with nodes with in-degree 0 (nothing points to them = nobody depends on them)
    // That means: A has in-degree 0 if nothing depends on A.
    // We'd emit A first — but A depends on B, so A should come AFTER B.
    //
    // Fix: We need to reverse the edge direction.
    // Edge A→B (A depends on B) means B→A in the processing graph.
    // Then in-degree of A = 1, in-degree of B = 0.
    // We start with B (in-degree 0), emit B, then A. Correct!

    // Rebuild with reversed edges
    const reversedAdj = new Map<string, Set<string>>();
    const reversedInDegree = new Map<string, number>();

    for (const urn of adj.keys()) {
        reversedAdj.set(urn, new Set());
        reversedInDegree.set(urn, 0);
    }

    for (const [urn, deps] of adj) {
        // urn depends on each dep → reversed edge: dep → urn
        for (const dep of deps) {
            reversedAdj.get(dep)?.add(urn);
            reversedInDegree.set(urn, (reversedInDegree.get(urn) ?? 0) + 1);
        }
    }

    // Kahn's algorithm on reversed graph
    const queue: string[] = [];
    for (const [urn, deg] of reversedInDegree) {
        if (deg === 0) queue.push(urn);
    }
    // Sort for determinism
    queue.sort();

    const result: string[] = [];

    while (queue.length > 0) {
        // Take the lexicographically smallest to ensure determinism
        queue.sort();
        const current = queue.shift()!;
        result.push(current);

        // For each node that depends on current, decrement its in-degree
        const dependents = reversedAdj.get(current) ?? new Set();
        for (const dependent of dependents) {
            const newDeg = (reversedInDegree.get(dependent) ?? 1) - 1;
            reversedInDegree.set(dependent, newDeg);
            if (newDeg === 0) {
                queue.push(dependent);
            }
        }
    }

    // If we haven't processed all nodes, there's a cycle
    if (result.length !== adj.size) {
        const remaining = [...adj.keys()].filter(urn => !result.includes(urn));
        const cycle = detectCycle(adj, remaining);
        throw new DependencyCycleError(cycle);
    }

    return result;
}

// ─── Cycle Detection ─────────────────────────────────────────────────

/**
 * Detect a cycle in the dependency graph using DFS.
 * Returns the cycle path as an array of URNs.
 */
function detectCycle(adj: Map<string, Set<string>>, candidates: string[]): string[] {
    const WHITE = 0; // Not visited
    const GRAY = 1;  // In current DFS path
    const BLACK = 2; // Fully explored

    const color = new Map<string, number>();
    const parent = new Map<string, string>();

    for (const urn of adj.keys()) {
        color.set(urn, WHITE);
    }

    for (const startUrn of candidates) {
        if (color.get(startUrn) !== WHITE) continue;

        const stack: string[] = [startUrn];
        while (stack.length > 0) {
            const urn = stack[stack.length - 1];
            const state = color.get(urn) ?? WHITE;

            if (state === WHITE) {
                color.set(urn, GRAY);
                const deps = adj.get(urn) ?? new Set();
                for (const dep of deps) {
                    const depState = color.get(dep) ?? WHITE;
                    if (depState === GRAY) {
                        // Found a cycle — reconstruct path
                        const cycle = [dep, urn];
                        let current = urn;
                        while (current !== dep) {
                            const p = parent.get(current);
                            if (!p || cycle.includes(p)) break;
                            cycle.push(p);
                            current = p;
                        }
                        cycle.push(dep); // Close the cycle
                        return cycle.reverse();
                    }
                    if (depState === WHITE) {
                        parent.set(dep, urn);
                        stack.push(dep);
                    }
                }
            } else {
                stack.pop();
                color.set(urn, BLACK);
            }
        }
    }

    // Fallback: return candidates as the cycle indication
    return [...candidates, candidates[0]];
}

// ─── Full Resolution ─────────────────────────────────────────────────

/**
 * Resolve dependencies for a set of libraries.
 *
 * Returns:
 * - `order`: Libraries in dependency-first order (safe to load sequentially)
 * - `missingDependencies`: Dependencies declared but not present in the set
 * - `fullyResolved`: True if all dependencies are satisfied
 *
 * Missing dependencies are NOT treated as errors — the system logs a warning
 * and continues. This is critical for safe operation when libraries are
 * added incrementally.
 *
 * @throws DependencyCycleError if a cycle exists among the provided nodes
 */
export function resolveDependencies(nodes: DependencyNode[]): DependencyResolution {
    const knownUrns = new Set(nodes.map(n => n.urn));
    const missing = new Map<string, string[]>();

    // Detect missing dependencies
    for (const node of nodes) {
        const missingDeps = node.dependencies.filter(dep => !knownUrns.has(dep));
        if (missingDeps.length > 0) {
            missing.set(node.urn, missingDeps);
        }
    }

    // Topological sort (may throw DependencyCycleError)
    const order = topologicalSort(nodes);

    return {
        order,
        missingDependencies: missing,
        fullyResolved: missing.size === 0,
    };
}

/**
 * Convenience: given a Map of URN → LoadedLibrary, return them in dependency order.
 * This is the primary entry point for the import pipeline.
 */
export function sortLibrariesByDependency<T extends DependencyNode>(
    libraries: Iterable<T>,
): { sorted: T[]; resolution: DependencyResolution } {
    const libs = [...libraries];
    const resolution = resolveDependencies(libs);

    const byUrn = new Map(libs.map(l => [l.urn, l]));
    const sorted = resolution.order
        .map(urn => byUrn.get(urn))
        .filter((l): l is T => l !== undefined);

    return { sorted, resolution };
}
