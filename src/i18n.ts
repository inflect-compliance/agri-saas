import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from '@/lib/i18n/locales';

/**
 * next-intl request config — resolves the active UI locale per request.
 *
 * T00: the locale is read from the `NEXT_LOCALE` cookie (set by the
 * language switcher, and seeded by the middleware from the user's
 * persisted `uiLanguage` preference). The cookie value is validated
 * against the supported `LOCALES`; anything absent or unrecognised
 * falls back to `DEFAULT_LOCALE` ('bg') — a first-time user with no
 * cookie / no persisted preference sees the app in Bulgarian.
 */
export default getRequestConfig(async () => {
    // `cookies()` is async in Next 15+. It may be absent (first visit,
    // static context) — default cleanly in that case.
    let locale = DEFAULT_LOCALE;
    try {
        const cookieStore = await cookies();
        const value = cookieStore.get(LOCALE_COOKIE)?.value;
        if (isLocale(value)) {
            locale = value;
        }
    } catch {
        // No request cookie store available — keep the default locale.
    }

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    };
});
