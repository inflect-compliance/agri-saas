/**
 * Minimal ambient declaration for `@google/earthengine` (the official
 * Earth Engine JS/Node client), which ships no type definitions.
 *
 * The EE client is a fluent, deeply-dynamic server SDK — typing it
 * precisely buys little. We expose the handful of entry points the NDVI
 * tile service in `src/lib/agro/earth-engine.ts` actually calls, as
 * loosely-typed members on a default-exported `ee` object.
 */
declare module '@google/earthengine' {
    // The EE API surface is built at runtime; `any` is the pragmatic
    // contract for a server-only integration we fully control + test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ee: any;
    export default ee;
}
