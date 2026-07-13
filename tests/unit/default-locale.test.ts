/**
 * "Bulgarian for first-time users" is delivered through the AUTHENTICATED
 * path: a new user's `User.uiLanguage` column defaults to `bg`, so the app
 * renders Bulgarian on first login. The runtime `DEFAULT_LOCALE` fallback
 * (unauthenticated pages: login, invite preview, shared packs) stays `en`.
 *
 * This pins both halves so a refactor can't silently regress either — and so
 * the split (why unauthenticated pages are English) is documented in a test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_LOCALE, isLocale, LOCALES } from '@/lib/i18n/locales';

describe('default locale', () => {
    it('runtime fallback (unauthenticated pages) is English', () => {
        expect(DEFAULT_LOCALE).toBe('en');
        expect(isLocale(DEFAULT_LOCALE)).toBe(true);
        expect(LOCALES).toContain('en');
        expect(LOCALES).toContain('bg');
    });

    it('new users default to Bulgarian via the User.uiLanguage column default', () => {
        const schema = readFileSync(
            resolve(__dirname, '../../prisma/schema/auth.prisma'),
            'utf8',
        );
        // The `uiLanguage` field carries `@default("bg")` — first-time
        // authenticated users get a Bulgarian app on first login.
        const line = schema
            .split('\n')
            .find((l) => /^\s*uiLanguage\s+String/.test(l));
        expect(line).toBeDefined();
        expect(line).toMatch(/@default\("bg"\)/);
    });
});
