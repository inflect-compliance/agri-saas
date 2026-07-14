/**
 * Shared price-string parser for the EC AGRI-food feeds.
 *
 * The two EC endpoints report prices with DIFFERENT decimal conventions:
 *   • Cereals   — `"€178,00"`  (European: dot = thousands, COMMA = decimal)
 *   • Oilseeds  — `"€512.00"`  (DOT decimal)
 *
 * `parseEuroPrice` handles both by inspecting the LAST separator: if it is a
 * comma the string is European (strip dots, comma→dot); if it is a dot the
 * string is dot-decimal (strip commas). A non-numeric value (e.g. `":"`,
 * `""`, `"n/a"`) yields `null` so the caller skips the row rather than
 * fabricating a zero.
 *
 * @module lib/market/price-parse
 */

/** Parse a EUR-glyph price string ("€178,00" | "€512.00") → number | null. */
export function parseEuroPrice(raw: string | number | null | undefined): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

    // Strip everything except digits, separators, and a leading minus.
    const cleaned = raw.replace(/[^0-9.,-]/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    let normalized: string;
    if (lastComma === -1 && lastDot === -1) {
        // Pure integer.
        normalized = cleaned;
    } else if (lastComma > lastDot) {
        // Comma is the decimal separator (European): dots are thousands.
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
        // Dot is the decimal separator: commas are thousands.
        normalized = cleaned.replace(/,/g, '');
    }

    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the ISO currency of an EC OILSEEDS series from its member-state
 * region. The oilseeds endpoint reports prices in `"national currency/ton"`
 * and prefixes them with a MISLEADING generic `€` glyph — the real currency
 * is the member state's national currency, so we trust the region, NOT the
 * glyph. Cereals prices are always EUR and never go through here.
 */
export function oilseedCurrencyForRegion(region: string): string {
    switch (region.toUpperCase()) {
        case 'BG':
            return 'BGN';
        case 'RO':
            return 'RON';
        // EL (Greece) + EU aggregate + everything else report in EUR.
        default:
            return 'EUR';
    }
}
