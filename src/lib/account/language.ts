/**
 * Self-service UI-language preference (T00).
 *
 * Mirrors `updateOwnDisplayName` in `./profile`: acts ONLY on the
 * authenticated session user (the caller passes their own `userId`),
 * so one user can never write another's preference. Account-level, not
 * tenant-scoped — the chosen locale follows the user across every
 * tenant they belong to.
 */
import prisma from '@/lib/prisma';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Persist the authenticated user's UI language. The value is a
 * validated `Locale` (the API route narrows it via the zod enum before
 * calling), so no further sanitisation is required.
 */
export async function updateOwnUiLanguage(
    userId: string,
    language: Locale,
): Promise<{ uiLanguage: Locale }> {
    await prisma.user.update({
        where: { id: userId },
        data: { uiLanguage: language },
    });
    return { uiLanguage: language };
}
