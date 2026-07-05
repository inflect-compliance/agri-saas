'use client';

/**
 * ListPageShellRail — the optional left/aside rail wrapper for
 * `ListPageShell.Body`, split into its own client leaf.
 *
 * The rail's `aria-label` is the only translated string in the whole
 * ListPageShell primitive. Keeping the `useTranslations` call here —
 * rather than on the shell itself — lets `ListPageShell` stay a SHARED
 * (server + client) component. The T04 i18n migration originally put
 * `'use client'` on ListPageShell to reach `useTranslations`; that
 * turned a core layout primitive into a client boundary and 500'd the
 * server-rendered `/admin/audit-log` page (E2E: no <h1>, ChunkLoadError).
 * This leaf restores the shell's server-compatibility while preserving
 * the translated rail labels.
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export function ListPageShellRail({
    kind,
    testId,
    children,
}: {
    kind: 'orientation' | 'context';
    testId: string;
    children: ReactNode;
}) {
    const t = useTranslations('listPageShell');
    return (
        <aside className="flex-shrink-0 xl:self-start" aria-label={t(kind)} data-testid={testId}>
            {children}
        </aside>
    );
}
