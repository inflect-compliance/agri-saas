'use client';

/**
 * UI-language toggle for the user menu.
 *
 * Mounted INSIDE the account-avatar menu (top chrome), in a row directly
 * beneath the Theme toggle — the personal-preferences pairing, since both
 * `uiLanguage` and theme are per-user, not per-tenant. It mirrors the
 * compact `ToggleGroup` shape the admin-page `LanguageSetting` uses:
 * choosing a locale PUTs it to `/api/account/language` (persists
 * `User.uiLanguage` + sets the `NEXT_LOCALE` cookie), then `router.refresh()`
 * re-renders the server tree in the new locale.
 *
 * Option labels are locale endonyms from `LOCALE_LABELS` so the choice is
 * recognisable regardless of the currently-active UI locale.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { LOCALES, LOCALE_LABELS, isLocale } from '@/lib/i18n/locales';

export function UserMenuLanguageToggle() {
    const t = useTranslations('userMenu');
    const router = useRouter();
    const activeLocale = useLocale();

    // Optimistic local selection for immediate feedback; reconciles with
    // the server-resolved locale once `router.refresh()` completes.
    const [selected, setSelected] = useState<string>(activeLocale);
    const [isPending, startTransition] = useTransition();

    const options = LOCALES.map((code) => ({
        value: code,
        label: LOCALE_LABELS[code],
        id: `user-menu-language-option-${code}`,
    }));

    const onSelect = (value: string) => {
        if (!isLocale(value) || value === selected || isPending) return;
        const previous = selected;
        setSelected(value);
        startTransition(async () => {
            try {
                const res = await fetch('/api/account/language', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ language: value }),
                });
                if (!res.ok) {
                    setSelected(previous);
                    return;
                }
                router.refresh();
            } catch {
                setSelected(previous);
            }
        });
    };

    return (
        <ToggleGroup
            size="sm"
            options={options}
            selected={selected}
            selectAction={onSelect}
            ariaLabel={t('language')}
        />
    );
}
