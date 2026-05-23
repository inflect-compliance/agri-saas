/**
 * Ambient global declarations for runtime-injected values.
 *
 * `EdgeRuntime` is set by Next.js to a string identifier ('edge')
 * when a module is evaluated in the Edge Runtime; it's `undefined`
 * in the Node runtime. Declaring it as a global lets us
 * branch on `typeof EdgeRuntime === 'undefined'` without resorting
 * to `(globalThis as any).EdgeRuntime`.
 *
 * Reference:
 * https://nextjs.org/docs/app/api-reference/edge#edge-runtime-globals
 */

declare global {
    /**
     * Defined by Next.js Edge Runtime as a string identifier
     * ('edge'). `undefined` in Node runtime contexts.
     */

    var EdgeRuntime: string | undefined;
}

/**
 * Side-effect CSS imports from third-party packages (e.g.
 * `driver.js/dist/driver.css`, `@xyflow/react/dist/style.css`).
 * Next.js + webpack handle the actual import at build time;
 * TypeScript only needs to know the module shape exists. Without
 * these declarations, `await import('driver.js/dist/driver.css')`
 * fails type-checking with TS2307.
 *
 * The wildcard form alone doesn't apply to deep subpath imports
 * from node_modules — explicit per-package declarations cover
 * the cases we hit.
 */
declare module '*.css' {
    const content: { [className: string]: string };
    export default content;
}
declare module 'driver.js/dist/driver.css';
declare module '@xyflow/react/dist/style.css';

export {};
