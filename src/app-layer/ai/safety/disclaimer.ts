/**
 * Advisory disclaimer + safe-fallback constants (feat/ai-evals-safety).
 *
 * Exported so the advisor, the UI cards, and the tests all share ONE
 * source of truth. The disclaimer rides on EVERY `AdvisoryResult`; the
 * safe-fallback is what a high-stakes (dosage / chemical-mixing /
 * regulatory) query gets when the answer cannot be safely grounded —
 * a calibrated "go to the label / a licensed agronomist / the regulator"
 * message, NEVER a guess.
 */

/** Stamped on every advisory response. Must mention "agronomist". */
export const ADVISORY_DISCLAIMER =
    'This is general guidance, not a prescription — verify with a licensed ' +
    'agronomist and the product label before acting.';

/**
 * Returned when a high-stakes query cannot be grounded (no citations, or
 * no structured product data for a dosage/REI/PHI ask). It tells the user
 * exactly where to get the authoritative answer instead of guessing.
 */
export const SAFE_FALLBACK_ANSWER =
    "I can't safely answer this from the information I have. For dosage, " +
    'tank-mixing, re-entry (REI), or pre-harvest (PHI) decisions, follow the ' +
    'product label exactly and consult a licensed agronomist or your local ' +
    'agricultural regulator before applying anything.';
