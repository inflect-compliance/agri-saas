'use client';

import { useTranslations } from 'next-intl';
import { RequirePermission } from '@/components/require-permission';
import { ForbiddenPage } from '@/components/ForbiddenPage';

/**
 * Admin layout guard — centralized permission check for the entire
 * /t/:tenantSlug/admin/* subtree.
 *
 * Every admin page inherits this guard automatically. Non-admin users
 * see a consistent "Access Denied" experience via ForbiddenPage.
 *
 * Defence-in-depth:
 *   1. Edge middleware (middleware.ts) — redirects non-admin to dashboard
 *   2. This layout — client-side guard catches any edge cases
 *   3. API routes — server-side RBAC (separate concern)
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const t = useTranslations('admin');
    return (
        <RequirePermission
            resource="admin"
            action="view"
            fallback={
                <ForbiddenPage
                    title={t('forbidden.title')}
                    message={t('forbidden.message')}
                />
            }
        >
            {children}
        </RequirePermission>
    );
}
