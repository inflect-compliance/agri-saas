import { type Locale } from '@/lib/i18n/locales';

/**
 * A system-prompt line that pins the model's OUTPUT LANGUAGE to the user's UI
 * locale. Every AI surface that emits user-facing prose (field briefings,
 * agronomy explanations, photo recommendations, the safety advisor, risk
 * suggestions) appends this to its system prompt so a Bulgarian user reads
 * Bulgarian, not English.
 *
 * Returns '' for English (the models already default to English, so there's
 * nothing to add and no tokens to spend). Product names, units, chemical
 * names and codes are explicitly kept verbatim so we don't get "ха" for "ha"
 * or a transliterated brand.
 *
 * Locale is resolved from `getLocale()` (next-intl) in request scope, or from
 * the owning user's persisted `User.uiLanguage` in background jobs — narrow
 * untrusted values with `isLocale()` before calling.
 */
export function localeOutputInstruction(locale: Locale | string | null | undefined): string {
    if (locale === 'bg') {
        return (
            'Write your ENTIRE response in Bulgarian (Cyrillic script). ' +
            'All natural-language prose — summaries, explanations, recommendations, ' +
            'headlines and any free-text field values — must be written in Bulgarian. ' +
            'Keep product names, brand names, chemical/active-ingredient names, units ' +
            '(e.g. ha, kg, l, t/ha, mm, °C), codes and identifiers exactly as given; do not transliterate them.'
        );
    }
    return '';
}

/**
 * Append the language instruction to an existing system prompt. Convenience
 * for the common "system string + one extra line" shape. Returns `system`
 * unchanged for English (or an empty instruction).
 */
export function withLocaleInstruction(system: string, locale: Locale | string | null | undefined): string {
    const line = localeOutputInstruction(locale);
    return line ? `${system}\n\n${line}` : system;
}
