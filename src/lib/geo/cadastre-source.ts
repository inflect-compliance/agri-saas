/**
 * Cadastre WMS upstream resolution — SERVER-ONLY (reads env).
 *
 * The Bulgarian cadastre overlay is an OPT-IN, operator-configured seam. No
 * upstream URL is hardcoded (a hidden feature beats a hardcoded 404), so the
 * overlay stays HIDDEN until an operator sets `CADASTRE_WMS_URL` or
 * `CADASTRE_WMS_PREMIUM_URL` (premium wins). Two upstream shapes are
 * supported, auto-detected from the URL (see `resolveCadastreSource`):
 *   • OGC WMS `GetMap` — a classic INSPIRE view service.
 *   • ArcGIS REST `…/MapServer` — АГКК publishes its parcels as a public
 *     ArcGIS service (arcgis.cadastre.bg/arcgisnopki/rest/services/
 *     ExternalKais/ParcelsCache/MapServer); its WMS interface is disabled, so
 *     we speak ArcGIS `export`. This is the recommended FREE source.
 * `CADASTRE_WMS_PREMIUM_URL` is for the paid №8002 endpoint (commercial terms
 * in the implementation note).
 *
 * The resolved upstream URL NEVER reaches the client: the browser only ever
 * sees the same-origin proxy tile template + a `configured` boolean. This
 * module is imported only by the proxy + config routes (server runtime).
 */
import { env } from '@/env';
import { isArcgisMapServer } from '@/lib/geo/cadastre-tiles';

export interface CadastreSource {
    /** Operator-configured upstream base URL. Never sent to the client. */
    url: string;
    /** WMS LAYERS value (INSPIRE `CP.CadastralParcel` by default; ignored in arcgis mode). */
    layers: string;
    /** Cache-key discriminator — 'premium' (№8002) or 'base' (free source). */
    source: 'premium' | 'base';
    /**
     * Upstream protocol. `wms` → OGC WMS `GetMap`; `arcgis` → ArcGIS REST
     * `export` (the shape АГКК's ParcelsCache/MapServer serves — a Referer
     * from the upstream origin is required, added by the proxy). Auto-detected
     * from the URL so the operator only sets one env var.
     */
    mode: 'wms' | 'arcgis';
}

/**
 * Resolve the active cadastre upstream, or `null` when the feature is
 * unconfigured (the overlay stays hidden). Premium (№8002) wins over the free
 * base when both are present. The protocol (`wms` vs `arcgis`) is auto-detected
 * from the URL shape (a `…/MapServer` URL is ArcGIS REST).
 */
export function resolveCadastreSource(): CadastreSource | null {
    const premium = env.CADASTRE_WMS_PREMIUM_URL;
    const base = env.CADASTRE_WMS_URL;
    const url = premium || base;
    if (!url) return null;
    return {
        url,
        layers: env.CADASTRE_WMS_LAYERS,
        source: premium ? 'premium' : 'base',
        mode: isArcgisMapServer(url) ? 'arcgis' : 'wms',
    };
}

/** True when an operator has configured a cadastre WMS upstream. */
export function isCadastreConfigured(): boolean {
    return resolveCadastreSource() !== null;
}
