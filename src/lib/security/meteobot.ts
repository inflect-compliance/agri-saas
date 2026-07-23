/**
 * Meteobot station embed — the ONE place that defines which hosts the app may
 * embed on /climate. Both the CSP `frame-src` allowlist (`src/lib/security/
 * csp.ts`) and the stored-URL validator (`usecases/modules.ts` + the
 * `climate/meteobot` route) read from here, so "what the browser is allowed to
 * frame" and "what URL an admin is allowed to save" can never drift apart.
 *
 * Edge-safe: only `URL` + arrays, no Node APIs — `csp.ts` imports this from the
 * Edge middleware.
 *
 * (When the native Meteobot data-fetch lands — see the climate note — the API
 * host is validated the same way; extend METEOBOT_EMBED_HOSTS if the data API
 * lives on a different domain.)
 */

/** Apex hosts whose dashboards may be embedded (apex + any subdomain). */
export const METEOBOT_EMBED_HOSTS = ['meteobot.com'] as const;

/**
 * CSP `frame-src` source fragment for the Meteobot embed — apex + wildcard
 * subdomain per allowed host (`https://meteobot.com https://*.meteobot.com`).
 * Spread into the directive alongside `'self'`.
 */
export const METEOBOT_FRAME_SRC: string[] = METEOBOT_EMBED_HOSTS.flatMap((h) => [
    `https://${h}`,
    `https://*.${h}`,
]);

/**
 * True when `url` is an `https:` URL on an allowed Meteobot host (the apex or a
 * subdomain of it). Anything else — a different origin, `http:`, or garbage —
 * is rejected so the app never persists (nor asks the browser to frame) a URL
 * the CSP would block anyway. The validator and the CSP share this one list.
 */
export function isAllowedMeteobotUrl(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return METEOBOT_EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
