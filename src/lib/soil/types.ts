/**
 * Shared soil types, the colour palette, and label helpers — PURE, no I/O.
 *
 * `SoilProfile` is the structured shape persisted to BOTH `Parcel.soilJson`
 * and the global `SoilSample.dataJson`. Every numeric field is a MODELLED
 * ESTIMATE from open data (ISRIC SoilGrids), NOT a lab measurement — the UI
 * must always frame it that way and surface the uncertainty.
 *
 * @module lib/soil/types
 */
import type { UsdaTextureClass } from './texture';

/** Per-property modelled value + its SoilGrids uncertainty companion. */
export interface SoilPropertyStat {
    /** Mean value in real-world units (%, pH, g/kg, g/cm³ — see field docs). */
    mean: number | null;
    /**
     * SoilGrids uncertainty for the property — the ratio between the
     * 0.05/0.95 prediction-interval width and the median (larger = less
     * certain). Carried verbatim so the UI can show "how modelled" a value
     * is; null when the provider omitted it.
     */
    uncertainty: number | null;
}

/**
 * Structured soil profile for a single point/parcel. A modelled estimate —
 * see module header. Persisted verbatim; the UI derives its display from it.
 */
export interface SoilProfile {
    /** WRB reference soil group, when a WRB source is wired (optional). */
    wrbClass?: string | null;
    /** USDA texture class derived from sand/silt/clay (the primary label). */
    textureClass: UsdaTextureClass | null;
    /** Sand fraction, % (0–100). */
    sandPct: number | null;
    /** Silt fraction, % (0–100). */
    siltPct: number | null;
    /** Clay fraction, % (0–100). */
    clayPct: number | null;
    /** Soil pH in water. */
    phH2o: number | null;
    /** Soil organic carbon, g/kg. */
    socGkg: number | null;
    /** Bulk density of the fine earth fraction, g/cm³. */
    bulkDensity: number | null;
    /** Depth interval the values describe (e.g. "0-5cm"). */
    depth: string;
    /** Per-property uncertainty companions (SoilGrids), keyed by property. */
    uncertainty?: Partial<Record<'sand' | 'silt' | 'clay' | 'phh2o' | 'soc' | 'bdod', SoilPropertyStat>>;
    /** Provider key — matches SOIL_PROVIDER ("soilgrids"). */
    provider: string;
    /** ISO timestamp the provider response was captured. */
    fetchedAt: string;
}

/**
 * Colour-blind-safe categorical palette for the 12 USDA texture classes.
 * Ordered sand→clay so it also reads as a perceptual ramp (texture is
 * quasi-ordinal), while staying distinguishable under deuteranopia/
 * protanopia. Mid-tone hues chosen to hold contrast against BOTH the light
 * and dark map backgrounds. `pending` is the neutral tone for a parcel with
 * no soil yet (rendered as a low-opacity/hatched "pending" fill).
 */
export const SOIL_TEXTURE_COLORS: Record<UsdaTextureClass, string> = {
    Sand: '#e9c46a',
    'Loamy sand': '#e0a94b',
    'Sandy loam': '#d98c4a',
    Loam: '#9bad5a',
    'Silt loam': '#6faf96',
    Silt: '#5f97bf',
    'Sandy clay loam': '#c07f4e',
    'Clay loam': '#b06a44',
    'Silty clay loam': '#9a6b8c',
    'Sandy clay': '#a8564f',
    'Silty clay': '#7d5a9e',
    Clay: '#8a4636',
};

/** Neutral fill for parcels awaiting a soil reading ("soil pending"). */
export const SOIL_PENDING_COLOR = '#94a3b8';

/** Resolve the fill colour for a texture class (pending tone when null). */
export function soilColorForTexture(texture: UsdaTextureClass | null | undefined): string {
    if (!texture) return SOIL_PENDING_COLOR;
    return SOIL_TEXTURE_COLORS[texture] ?? SOIL_PENDING_COLOR;
}
