/**
 * Bulgarian КАИС cadastre helpers — shared, dependency-light constants and
 * pure functions used by BOTH the server parser (`src/lib/spatial/parse.ts`)
 * and client surfaces (location detail, parcel sheet). Kept free of the heavy
 * spatial deps (shpjs / @turf / @xmldom) so it is safe to import into a client
 * bundle.
 */
import { haToDca } from '@/lib/agro/rate-calc';

/** Public КАИС cadastre map viewer (deep-linked from the UI, new tab). */
export const KAIS_MAP_URL = 'https://kais.cadastre.bg/bg/Map';

/** propertiesJson key holding the documentary area (площ по документ) in decares. */
export const DOC_AREA_DCA_KEY = '_cadastreDocAreaDca';

/** Divergence beyond this fraction (5%) surfaces the area-reconciliation badge. */
export const AREA_DIVERGENCE_THRESHOLD = 0.05;

/**
 * The documentary parcel area in DECARES carried on a parcel's properties, or
 * null when absent / non-positive. DISPLAY-ONLY — dca is never persisted (#236);
 * the authoritative area is the geometry-derived `areaHa`.
 */
export function documentaryAreaDca(properties: unknown): number | null {
    if (!properties || typeof properties !== 'object') return null;
    const v = (properties as Record<string, unknown>)[DOC_AREA_DCA_KEY];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * True when the documentary area (dca) diverges by more than the threshold
 * from the geometry-derived area (`areaHa` → dca). False when either input is
 * missing — the badge only appears when there is a real, measurable gap.
 */
export function areaDivergesFromDocument(
    areaHa: number | null | undefined,
    documentaryDca: number | null | undefined,
): boolean {
    if (areaHa == null || documentaryDca == null || documentaryDca <= 0) return false;
    const geometryDca = haToDca(areaHa);
    if (geometryDca <= 0) return false;
    return Math.abs(geometryDca - documentaryDca) / documentaryDca > AREA_DIVERGENCE_THRESHOLD;
}
