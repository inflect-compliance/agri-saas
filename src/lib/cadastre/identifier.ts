/**
 * Bulgarian КАИС cadastral identifier — strict validation + normalization.
 *
 * A parcel identifier is `ЕКАТТЕ.масив.номер` (EKATTE.masiv.parcel), e.g.
 * `68134.8360.729`: a 5-digit settlement code (ЕКАТТЕ), then the dot-separated
 * cadastral block (масив) and parcel (имот) numbers. Leading zeros are
 * SIGNIFICANT (`00134` ≠ `134`), so the identifier is validated and carried as
 * a STRING throughout — never coerced through `Number`, which would silently
 * drop a leading-zero ЕКАТТЕ or a trailing-zero component.
 *
 * Pure module — no I/O, no DB. The КАИС import UI validates each pasted line
 * against this before submit; the job re-validates + groups by the ЕКАТТЕ
 * prefix (which selects the settlement archive to fetch).
 *
 * @module lib/cadastre/identifier
 */

/**
 * A full parcel identifier: 5-digit ЕКАТТЕ, then EXACTLY the масив + номер
 * parts (`\d{5}\.\d+\.\d+`). Stricter than `parse.ts`'s
 * `CADASTRAL_ID_RE` (which tolerates ≥3 parts from arbitrary export columns):
 * user-typed КАИС identifiers are always the canonical three-part form.
 */
export const CADASTRE_IDENTIFIER_RE = /^\d{5}\.\d+\.\d+$/;

/** The 5-digit ЕКАТТЕ settlement prefix. */
const EKATTE_RE = /^\d{5}$/;

/**
 * Normalize a raw pasted identifier: trim surrounding whitespace and collapse a
 * few forgivable typos (full-width dots, Cyrillic-looking separators) to the
 * canonical ASCII `.`. Does NOT validate — pass the result to
 * `isValidCadastreIdentifier`. Leading zeros are preserved verbatim.
 */
export function normalizeCadastreIdentifier(raw: string): string {
    return raw
        .trim()
        // Normalize any run of dot-like separators to a single ASCII dot.
        .replace(/[．。]/g, '.')
        .replace(/\s+/g, '');
}

/** True when `value` is a canonical `ЕКАТТЕ.масив.номер` identifier. */
export function isValidCadastreIdentifier(value: string): boolean {
    return CADASTRE_IDENTIFIER_RE.test(value);
}

/** The 5-digit ЕКАТТЕ prefix of a valid identifier, else null. */
export function ekatteOf(identifier: string): string | null {
    const dot = identifier.indexOf('.');
    if (dot !== 5) return null;
    const prefix = identifier.slice(0, 5);
    return EKATTE_RE.test(prefix) ? prefix : null;
}

export interface ParsedIdentifierList {
    /** Normalized, VALID identifiers, de-duplicated (first occurrence kept). */
    valid: string[];
    /** Normalized lines that FAILED validation (surfaced back to the user). */
    invalid: string[];
}

/**
 * Parse a free-text block (one identifier per line, paste-friendly) into valid
 * + invalid buckets. Blank lines are ignored. Duplicates within the valid set
 * are collapsed. The order of `valid` follows first appearance so the UI + job
 * results read predictably.
 */
export function parseIdentifierList(text: string): ParsedIdentifierList {
    const valid: string[] = [];
    const seen = new Set<string>();
    const invalid: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const norm = normalizeCadastreIdentifier(line);
        if (!norm) continue;
        if (isValidCadastreIdentifier(norm)) {
            if (!seen.has(norm)) {
                seen.add(norm);
                valid.push(norm);
            }
        } else {
            invalid.push(norm);
        }
    }
    return { valid, invalid };
}

/**
 * Group valid identifiers by their ЕКАТТЕ prefix — the settlement archive that
 * must be fetched to satisfy them. Returns a Map<ekatte, identifiers[]>.
 */
export function groupByEkatte(identifiers: readonly string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const id of identifiers) {
        const ekatte = ekatteOf(id);
        if (!ekatte) continue;
        const list = groups.get(ekatte);
        if (list) list.push(id);
        else groups.set(ekatte, [id]);
    }
    return groups;
}
