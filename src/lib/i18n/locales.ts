/**
 * Shared locale contract for the UI i18n layer (T00).
 *
 * Single source of truth for the set of supported UI locales, the
 * default, the cookie name the server reads to resolve the request
 * locale, and the endonym labels shown in the language switcher.
 *
 * Consumed by:
 *   - `src/i18n.ts`       — resolves the request locale from the cookie.
 *   - `src/middleware.ts` — seeds the cookie from the JWT preference.
 *   - `src/auth.ts`       — carries `uiLanguage` on the token/session.
 *   - the account language API + the admin LanguageSetting selector.
 */

/** Every UI locale the product ships message catalogues for. */
export const LOCALES = ['en', 'bg'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Locale used when no preference/cookie resolves — Bulgarian. Agrent's
 * operators are Bulgarian farms, so a first-time user (no `NEXT_LOCALE`
 * cookie, no persisted `uiLanguage`) sees the app in Bulgarian; anyone who
 * picks English keeps it. Note: `en` remains the i18n COMPLETENESS reference
 * (scripts/i18n-diff.mjs) — this only changes the runtime fallback, not which
 * locale is the translation source of truth.
 */
export const DEFAULT_LOCALE: Locale = 'bg';

/**
 * Cookie the server reads to resolve the request locale. `NEXT_LOCALE`
 * is the de-facto next-intl / Next.js convention name.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Narrow an untrusted value (cookie, DB column, JWT claim) to a Locale. */
export function isLocale(v: unknown): v is Locale {
    return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * Display labels for each locale, written as endonyms (each language
 * names itself in its own script) so the option is recognisable
 * regardless of the currently-active UI locale.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
    en: 'English',
    bg: 'Български',
};
