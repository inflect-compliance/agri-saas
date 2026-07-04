/**
 * Minimal ambient declaration for `@google/earthengine` (the official
 * Earth Engine JS/Node client), which ships no type definitions.
 *
 * The EE API is a fluent, deeply-dynamic server SDK — every computation
 * method returns another EE node. We model that with a recursive
 * `EeNode` and pin only the handful of entry points the NDVI tile
 * service (`src/lib/agro/earth-engine.ts`) actually calls. No `any` —
 * `EeNode` keeps the chain typed without widening the codebase's
 * explicit-any budget.
 */
declare module '@google/earthengine' {
    /** A fluent Earth Engine value — each method returns another node. */
    interface EeNode {
        [method: string]: (...args: unknown[]) => EeNode;
    }

    interface EarthEngine {
        data: {
            authenticateViaPrivateKey(
                key: Record<string, unknown>,
                onSuccess: () => void,
                onError: (err: unknown) => void,
            ): void;
        };
        initialize(
            baseUrl: string | null,
            tileUrl: string | null,
            onSuccess: () => void,
            onError: (err: unknown) => void,
            xsrfToken: string | null,
            project?: string,
        ): void;
        Geometry: { Rectangle(coords: number[]): EeNode };
        Filter: { lt(property: string, value: number): EeNode };
        ImageCollection(id: string): EeNode;
        /** Reducers for aggregation (e.g. `reduceRegion`). */
        Reducer: { mean(): EeNode };
    }

    const ee: EarthEngine;
    export default ee;
}
