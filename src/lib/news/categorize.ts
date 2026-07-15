/**
 * Pure news categoriser for the Trends → News tab.
 *
 * Every aggregated headline is bucketed into one of three categories the UI
 * filters by. The rule is deterministic — NO I/O, NO AI — so it unit-tests
 * without a network, exactly like `price-parse.ts`:
 *
 *   1. If the title/summary matches a POLICY keyword → 'policy'.
 *   2. Else if it matches a MARKET keyword → 'market'.
 *   3. Else the feed's own default category stands.
 *
 * Policy wins over market when both appear: a subsidy/regulation headline is
 * the more actionable classification for a Bulgarian farm operator than the
 * price angle it may also mention.
 *
 * Keywords are STEMS matched as case-insensitive substrings over
 * `title + ' ' + summary`, so a single Bulgarian stem (`субсиди`) catches every
 * inflection (субсидия / субсидии / субсидиите). Both Bulgarian (Cyrillic) and
 * English terms are listed because the EC agri press feed is English.
 *
 * @module lib/news/categorize
 */

/** The three buckets the News tab filters by. Single source of truth — the
 *  Zod enum in `trends.schemas.ts` is built from this tuple. */
export const NEWS_CATEGORIES = ['market', 'policy', 'general'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/**
 * Policy / subsidy / regulation stems (BG + EN). Checked FIRST — the most
 * actionable classification for a farm operator (CAP deadlines, subsidy
 * windows, regulation changes).
 */
const POLICY_KEYWORDS: readonly string[] = [
    // Bulgarian
    'субсиди', // субсидия/субсидии
    'дфз', // Държавен фонд Земеделие
    'фонд земедели',
    'плащан', // директни плащания
    'регламент',
    'наредба',
    'директив',
    'еврофонд',
    'прср', // Програма за развитие на селските райони
    'осп', // Обща селскостопанска политика
    'министерств',
    'еко схем',
    'еко-схем',
    'грант',
    'подпомаган',
    // English
    'subsid',
    'cap ', // Common Agricultural Policy (trailing space avoids "capacity")
    'regulation',
    'directive',
    'ministry',
    'grant',
    'aid scheme',
    'eco-scheme',
    'eco scheme',
    'direct payment',
];

/**
 * Market / commodity / price stems (BG + EN). Checked SECOND — headlines that
 * move grain & oilseed prices (harvest, exports, market moves).
 */
const MARKET_KEYWORDS: readonly string[] = [
    // Bulgarian
    'цена', // цена/цени → both start "цен"
    'цени',
    'цен на',
    'реколт',
    'износ',
    'внос',
    'борса',
    'борсов',
    'пазар',
    'търгови', // търговия/търговски
    'зърно',
    'зърнен',
    'фючърс',
    'котировк',
    'тон', // цена на тон / тонаж
    'добив', // yield
    // English
    'price',
    'harvest',
    'export',
    'import',
    'market',
    'futures',
    'grain',
    'yield',
    'tonne',
];

/** True when any stem in `stems` appears in the lowercased haystack. */
function matchesAny(haystack: string, stems: readonly string[]): boolean {
    return stems.some((stem) => haystack.includes(stem));
}

/**
 * Categorise one news item. `feedDefault` is used when no keyword matches —
 * it MUST already be a valid {@link NewsCategory} (the feed registry types it).
 */
export function categorize(
    title: string,
    summary: string | null | undefined,
    feedDefault: NewsCategory,
): NewsCategory {
    const haystack = `${title ?? ''} ${summary ?? ''}`.toLowerCase();
    if (matchesAny(haystack, POLICY_KEYWORDS)) return 'policy';
    if (matchesAny(haystack, MARKET_KEYWORDS)) return 'market';
    return feedDefault;
}
