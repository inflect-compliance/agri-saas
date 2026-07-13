/**
 * The runtime default locale is Bulgarian — Agrent's operators are Bulgarian
 * farms, so a first-time user (no NEXT_LOCALE cookie, no persisted
 * `uiLanguage`) sees the app in Bulgarian. Anyone who picks English keeps it.
 *
 * This pins the product decision so a refactor can't silently flip it back.
 * (`en` is still the i18n COMPLETENESS reference — that's a separate concern
 * handled by scripts/i18n-diff.mjs and unaffected by this default.)
 */
import { DEFAULT_LOCALE, isLocale, LOCALES } from '@/lib/i18n/locales';

describe('default locale', () => {
    it('is Bulgarian for first-time users', () => {
        expect(DEFAULT_LOCALE).toBe('bg');
    });

    it('is a supported locale', () => {
        expect(isLocale(DEFAULT_LOCALE)).toBe(true);
        expect(LOCALES).toContain('en');
        expect(LOCALES).toContain('bg');
    });
});
