/**
 * Cadastre WMS upstream resolution — SERVER-ONLY (reads env).
 *
 * The Bulgarian cadastre overlay is an OPT-IN, operator-configured seam. No
 * upstream URL is hardcoded: the free INSPIRE view WMS for КККР parcels could
 * not be located by probing (inspire.egov.bg is a JS SPA, the АГКК geoserver
 * hosts don't resolve), and a hardcoded default that 404s is worse than a
 * hidden feature. So the overlay is HIDDEN until an operator sets
 * `CADASTRE_WMS_URL` (a free INSPIRE GetMap base) or `CADASTRE_WMS_PREMIUM_URL`
 * (the paid №8002 endpoint — see the implementation note for the commercial
 * terms). The premium URL takes precedence when both are set.
 *
 * The resolved upstream URL NEVER reaches the client: the browser only ever
 * sees the same-origin proxy tile template + a `configured` boolean. This
 * module is imported only by the proxy + config routes (server runtime).
 */
import { env } from '@/env';

export interface CadastreSource {
    /** Operator-configured WMS GetMap base URL. Never sent to the client. */
    url: string;
    /** WMS LAYERS value (INSPIRE `CP.CadastralParcel` by default). */
    layers: string;
    /** Cache-key discriminator — 'premium' (№8002) or 'base' (free INSPIRE). */
    source: 'premium' | 'base';
}

/**
 * Resolve the active cadastre WMS upstream, or `null` when the feature is
 * unconfigured (the overlay stays hidden). Premium (№8002) wins over the free
 * INSPIRE base when both are present.
 */
export function resolveCadastreSource(): CadastreSource | null {
    const premium = env.CADASTRE_WMS_PREMIUM_URL;
    const base = env.CADASTRE_WMS_URL;
    if (premium) {
        return { url: premium, layers: env.CADASTRE_WMS_LAYERS, source: 'premium' };
    }
    if (base) {
        return { url: base, layers: env.CADASTRE_WMS_LAYERS, source: 'base' };
    }
    return null;
}

/** True when an operator has configured a cadastre WMS upstream. */
export function isCadastreConfigured(): boolean {
    return resolveCadastreSource() !== null;
}
