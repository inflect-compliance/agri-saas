/**
 * Advisory-intent classifier (feat/ai-evals-safety).
 *
 * A deterministic, keyword/heuristic classifier — NO model call — so it is
 * fully unit-testable and cheap. It decides which safety regime a query
 * falls under so the advisor can HARD-escalate the high-stakes ones
 * (dosage / chemical-mixing / regulatory) to the strongest model tier and
 * require grounding.
 *
 * Precedence (most → least dangerous): dosage → chemical-mixing →
 * regulatory → general. A query that trips more than one bucket is
 * classified to the most dangerous one so it gets the strictest handling.
 */

export type AdvisoryIntent = 'dosage' | 'chemical-mixing' | 'regulatory' | 'general';

/** Lower-cased, whitespace-collapsed text + a word-boundary tester. */
function normalise(query: string): string {
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
}

// ── Dosage: "how much / what rate / dose" + unit/rate language ──
const DOSAGE_PATTERNS: RegExp[] = [
    /\bdos(?:e|age|ing)\b/,
    /\bapplication rate\b/,
    /\brate of application\b/,
    /\bhow much\b/,
    /\bhow many (?:ml|l|litres|liters|gal|gallons|oz|kg|g|grams)\b/,
    /\b\d+(?:\.\d+)?\s?(?:ml|l|litres|liters|gal|oz|kg|g)\s?(?:\/|per)\s?(?:ha|hectare|acre|ac|m2|m²)\b/,
    /\b(?:ml|l|litres|liters|gal|oz|kg|g)\s?(?:\/|per)\s?(?:ha|hectare|acre)\b/,
    /\b(?:rate|amount)\b.*\b(?:apply|spray|mix)\b/,
    /\bper (?:hectare|acre|ha)\b/,
];

// ── Chemical-mixing: mix/tank-mix/combine + a chemical noun ──
const MIX_VERB_PATTERNS: RegExp[] = [
    /\btank[ -]?mix\b/,
    /\bmix(?:ing|es|ed)?\b/,
    /\bcombin(?:e|ing)\b/,
    /\bcompatib(?:le|ility)\b/,
    /\bblend(?:ing)?\b/,
];
const CHEMICAL_NOUN_PATTERNS: RegExp[] = [
    /\bpesticide\b/,
    /\bherbicide\b/,
    /\bfungicide\b/,
    /\binsecticide\b/,
    /\bchemical(?:s)?\b/,
    /\bproduct(?:s)?\b/,
    /\badjuvant\b/,
    /\bspray\b/,
];

// ── Regulatory: PHI/REI/MRL/certification/organic/legal/label rules ──
const REGULATORY_PATTERNS: RegExp[] = [
    /\bphi\b/,
    /\brei\b/,
    /\bre-?entry\b/,
    /\bpre-?harvest\b/,
    /\bwithholding\b/,
    /\bmaximum residue\b/,
    /\bmrl\b/,
    /\bresidue limit\b/,
    /\bcertification\b/,
    /\borganic standard\b/,
    /\bcertified organic\b/,
    /\blabel requirement\b/,
    /\bregulat(?:ion|ory)\b/,
    /\bcompliance\b/,
    /\blegal(?:ly)?\b/,
    /\bpermitted\b/,
    /\ballowed under\b/,
];

/**
 * Classify a free-text advisory query into one of the four intents.
 * Deterministic and side-effect-free.
 */
export function classifyAdvisoryIntent(query: string): AdvisoryIntent {
    const text = normalise(query);
    if (text.length === 0) return 'general';

    // Dosage wins first — wrong numbers are the highest-stakes failure.
    if (hasAny(text, DOSAGE_PATTERNS)) return 'dosage';

    // Chemical-mixing requires BOTH a mix verb AND a chemical noun, so
    // "mix the soil" or "combine the rows" don't escalate.
    if (hasAny(text, MIX_VERB_PATTERNS) && hasAny(text, CHEMICAL_NOUN_PATTERNS)) {
        return 'chemical-mixing';
    }

    if (hasAny(text, REGULATORY_PATTERNS)) return 'regulatory';

    return 'general';
}

/** True for the intents that demand HARD escalation + grounding. */
export function isHighStakes(intent: AdvisoryIntent): boolean {
    return intent === 'dosage' || intent === 'chemical-mixing' || intent === 'regulatory';
}
