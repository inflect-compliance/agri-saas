/**
 * Typed unit-of-measure conversion + dimensional analysis.
 *
 * The agriculture domain mixes VOLUME (L/mL), WEIGHT (kg/g/t), AREA
 * (ha/m²/ac) and RATE units (L/ha …). Spray dose math multiplies a RATE
 * by an area and deducts the result from a product lot whose default unit
 * may differ from the rate's numerator (L/ha applied, but the lot is in
 * mL). Getting that wrong is a financial + regulatory error, so the math
 * goes through this single typed layer that:
 *
 *   - converts ONLY within a dimension (kg→g exact; kg→L throws), and
 *   - resolves a RATE as numerator/denominator so `L/ha × ha = L` is a
 *     dimensionally-checked operation, not an untyped multiply.
 *
 * Keys are the stable `Unit.key` slugs from `scripts/import-units.ts`
 * (`l`, `kg`, `ha`, `l-per-ha`, …) — NOT display symbols. Bases per
 * dimension are chosen so every catalog factor is an EXACT integer
 * (WEIGHT base = g, VOLUME base = mL, AREA base = m²), so `kg→g` and
 * `L→mL` carry no floating-point drift.
 *
 * Pure + dependency-free; locked by
 * `tests/guardrails/unit-conversion-dimensional-analysis.test.ts`.
 */

export type Dimension = 'AREA' | 'VOLUME' | 'WEIGHT' | 'COUNT' | 'LENGTH';

export class UnknownUnitError extends Error {
    constructor(public readonly unitKey: string) {
        super(`Unknown unit: '${unitKey}'`);
        this.name = 'UnknownUnitError';
    }
}

export class DimensionMismatchError extends Error {
    constructor(
        public readonly fromKey: string,
        public readonly toKey: string,
        public readonly fromDimension: Dimension,
        public readonly toDimension: Dimension,
    ) {
        super(
            `Cannot convert '${fromKey}' (${fromDimension}) to '${toKey}' (${toDimension}): different dimensions`,
        );
        this.name = 'DimensionMismatchError';
    }
}

interface SimpleUnitDef {
    dimension: Dimension;
    /** value_in_base = value * toBase. Base unit per dimension has toBase = 1. */
    toBase: number;
}

interface RateUnitDef {
    /** Unit key of the rate's numerator (the thing applied), e.g. 'l'. */
    numerator: string;
    /** Unit key of the rate's denominator (per what), e.g. 'ha'. */
    denominator: string;
}

/**
 * Scalar units keyed by `Unit.key`. Bases give exact integer factors:
 * WEIGHT→g, VOLUME→mL, AREA→m², LENGTH→m, COUNT→each.
 */
const SIMPLE_UNITS: Readonly<Record<string, SimpleUnitDef>> = {
    // AREA — base m²
    m2: { dimension: 'AREA', toBase: 1 },
    ha: { dimension: 'AREA', toBase: 10_000 },
    dca: { dimension: 'AREA', toBase: 1000 }, // decare (декар) = 1000 m² = 0.1 ha (Bulgarian standard)
    ac: { dimension: 'AREA', toBase: 4046.8564224 }, // international acre (exact defn)
    // VOLUME — base mL
    ml: { dimension: 'VOLUME', toBase: 1 },
    l: { dimension: 'VOLUME', toBase: 1000 },
    // WEIGHT — base g
    g: { dimension: 'WEIGHT', toBase: 1 },
    kg: { dimension: 'WEIGHT', toBase: 1000 },
    t: { dimension: 'WEIGHT', toBase: 1_000_000 },
    // COUNT — base each
    each: { dimension: 'COUNT', toBase: 1 },
    // LENGTH — base m
    m: { dimension: 'LENGTH', toBase: 1 },
    km: { dimension: 'LENGTH', toBase: 1000 },
};

/** RATE units keyed by `Unit.key`, resolved to numerator/denominator keys. */
const RATE_UNITS: Readonly<Record<string, RateUnitDef>> = {
    'l-per-ha': { numerator: 'l', denominator: 'ha' },
    'ml-per-ha': { numerator: 'ml', denominator: 'ha' },
    'kg-per-ha': { numerator: 'kg', denominator: 'ha' },
    'g-per-ha': { numerator: 'g', denominator: 'ha' },
    // Per-decare (Bulgarian standard). `applyRate(dose, key, areaHa, 'ha')`
    // converts the area 'ha' → 'dca' (× 10) via toBase, so consumption is
    // dose × decares — dimensionally correct.
    'l-per-dca': { numerator: 'l', denominator: 'dca' },
    'ml-per-dca': { numerator: 'ml', denominator: 'dca' },
    'kg-per-dca': { numerator: 'kg', denominator: 'dca' },
    'g-per-dca': { numerator: 'g', denominator: 'dca' },
};

/** The dimension of a scalar unit, or `'RATE'` for a rate unit, or null if unknown. */
export function dimensionOf(unitKey: string): Dimension | 'RATE' | null {
    if (unitKey in SIMPLE_UNITS) return SIMPLE_UNITS[unitKey].dimension;
    if (unitKey in RATE_UNITS) return 'RATE';
    return null;
}

export function isKnownUnit(unitKey: string): boolean {
    return unitKey in SIMPLE_UNITS || unitKey in RATE_UNITS;
}

export function isRateUnit(unitKey: string): boolean {
    return unitKey in RATE_UNITS;
}

/** The numerator unit key of a rate (e.g. `l-per-ha` → `l`), or null. */
export function rateNumeratorUnit(rateKey: string): string | null {
    return RATE_UNITS[rateKey]?.numerator ?? null;
}

/** True iff `fromKey` and `toKey` are both known scalar units in the same dimension. */
export function canConvert(fromKey: string, toKey: string): boolean {
    const f = SIMPLE_UNITS[fromKey];
    const t = SIMPLE_UNITS[toKey];
    return !!f && !!t && f.dimension === t.dimension;
}

/**
 * Convert a scalar quantity between two units of the SAME dimension.
 * Throws `UnknownUnitError` for an unregistered unit and
 * `DimensionMismatchError` across dimensions (the dimensional-analysis
 * guarantee — kg→L can never silently succeed).
 *
 * @example convert(1, 'kg', 'g') === 1000   // exact
 * @example convert(2.5, 'l', 'ml') === 2500 // exact
 */
export function convert(value: number, fromKey: string, toKey: string): number {
    const from = SIMPLE_UNITS[fromKey];
    if (!from) throw new UnknownUnitError(fromKey);
    const to = SIMPLE_UNITS[toKey];
    if (!to) throw new UnknownUnitError(toKey);
    if (from.dimension !== to.dimension) {
        throw new DimensionMismatchError(fromKey, toKey, from.dimension, to.dimension);
    }
    if (fromKey === toKey) return value;
    return (value * from.toBase) / to.toBase;
}

export interface RateApplication {
    /** Magnitude in the rate's numerator unit. */
    value: number;
    /** The numerator unit key (e.g. 'l'). */
    unitKey: string;
}

/**
 * Apply a RATE over an area: `rateValue [num/denom] × area [areaUnit]`,
 * yielding an amount in the rate's NUMERATOR unit. The area is first
 * converted into the rate's denominator unit, so `L/ha × ha = L` and
 * `L/ha × m² = L` are both dimensionally correct.
 *
 * Throws `UnknownUnitError` if the rate or area unit is unregistered, or
 * `DimensionMismatchError` if the area unit isn't an AREA (the rate's
 * denominator is always an area in this catalog).
 *
 * @example applyRate(2, 'l-per-ha', 3, 'ha') → { value: 6, unitKey: 'l' }
 */
export function applyRate(
    rateValue: number,
    rateKey: string,
    area: number,
    areaUnitKey: string,
): RateApplication {
    const rate = RATE_UNITS[rateKey];
    if (!rate) throw new UnknownUnitError(rateKey);
    // Express the area in the rate's denominator unit (dimension-checked).
    const areaInDenominator = convert(area, areaUnitKey, rate.denominator);
    return { value: rateValue * areaInDenominator, unitKey: rate.numerator };
}
