/**
 * Cadastre import — PRIVACY strip.
 *
 * We import parcel GEOMETRY + cadastral IDENTIFIER + LAND-USE only. Even though
 * we deliberately fetch the "поземлени имоти" (land-parcels) archive and never
 * the ownership registers, a defensive belt-and-braces strip runs over every
 * feature's attribute bag before persist: КАИС shapefiles occasionally carry an
 * owner / person column, and a CC-licensed OpenData portal is NOT a GDPR waiver.
 * Any owner-ish key (Bulgarian or transliterated) is dropped so personal data
 * can never reach `Parcel.propertiesJson`.
 *
 * Pure module — no I/O. Unit-tested (`tests/unit/cadastre-privacy.test.ts`).
 *
 * @module lib/cadastre/privacy
 */

/**
 * STRONG owner-ish fragments — matched as a SUBSTRING of the normalized key.
 * These are unambiguous: no legitimate land-use / geometry column contains them.
 */
const OWNER_STRONG_FRAGMENTS: readonly string[] = [
    // Bulgarian (Cyrillic)
    'собствен', // собственик / собственост (owner / ownership)
    'титуляр', // title holder
    'егн', // national identity number
    'лнч', // foreigner personal number
    'булстат',
    'адрес', // address
    'нотариален',
    // Latin transliterations / export headers
    'owner',
    'sobstven',
    'titular',
    'bulstat',
    'adres',
    'address',
    'proprietor',
    'holder',
];

/**
 * TOKEN owner-ish fragments — matched only against a WHOLE underscore/space/
 * punctuation-delimited token of the key, NOT as a substring. This keeps a bare
 * `ИМЕ` (owner name) column stripped while a land-use `НАИМЕНОВАНИЕ`
 * (designation) column — which merely CONTAINS "име" — is preserved.
 */
const OWNER_TOKEN_FRAGMENTS: ReadonlySet<string> = new Set([
    'име', 'имена', 'лице', 'person', 'lice', 'egn', 'eik',
]);

/** Normalize a key for matching: trim, lower-case. */
function normKey(key: string): string {
    return key.trim().toLowerCase();
}

/** True when an attribute key looks owner-ish (must be stripped). */
export function isOwnerAttributeKey(key: string): boolean {
    const k = normKey(key);
    if (OWNER_STRONG_FRAGMENTS.some((frag) => k.includes(frag))) return true;
    const tokens = k.split(/[^0-9a-zа-я]+/i).filter(Boolean);
    return tokens.some((tok) => OWNER_TOKEN_FRAGMENTS.has(tok));
}

/**
 * Return a COPY of `properties` with every owner-ish key removed. Non-object
 * input returns an empty object. Nested objects are NOT recursed — КАИС
 * attribute bags are flat — but a nested value under a stripped top-level key is
 * gone with its parent.
 */
export function stripOwnerAttributes(
    properties: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!properties || typeof properties !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
        if (isOwnerAttributeKey(key)) continue;
        out[key] = value;
    }
    return out;
}
