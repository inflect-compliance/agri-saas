'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldX } from 'lucide-react';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';

/**
 * Shared forbidden/access-denied page for tenant routes.
 * Shows a clear message and a link back to the tenant dashboard.
 *
 * Use this instead of notFound() when you want users to know they
 * lack the required permission (vs. the page not existing).
 */
export function ForbiddenPage({
    title,
    message,
}: {
    title?: string;
    message?: string;
}) {
    const t = useTranslations('forbidden');
    const tenantHref = useTenantHref();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fadeIn px-4">
            <div className="w-16 h-16 rounded-lg bg-bg-error border border-border-error flex items-center justify-center mb-6">
                <ShieldX className="w-8 h-8 text-content-error" />
            </div>
            <Heading level={1} className="text-content-emphasis mb-2" id="forbidden-heading">{title ?? t('title')}</Heading>
            <p className="text-content-muted text-sm max-w-md mb-8">{message ?? t('message')}</p>
            <Link
                href={tenantHref('/dashboard')}
                className={buttonVariants({ variant: 'primary' })}
                id="forbidden-back-btn"
            >
                ← {t('backToDashboard')}
            </Link>
        </div>
    );
}

/**
 * Server-side forbidden page — used directly in server components
 * where TenantProvider context is not available.
 */
export function ServerForbiddenPage({
    tenantSlug,
    title,
    message,
}: {
    tenantSlug: string;
    title?: string;
    message?: string;
}) {
    const t = useTranslations('forbidden');

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fadeIn px-4">
            <div className="w-16 h-16 rounded-lg bg-bg-error border border-border-error flex items-center justify-center mb-6">
                <ShieldX className="w-8 h-8 text-content-error" />
            </div>
            <Heading level={1} className="text-content-emphasis mb-2" id="forbidden-heading">{title ?? t('title')}</Heading>
            <p className="text-content-muted text-sm max-w-md mb-8">{message ?? t('message')}</p>
            <a
                href={`/t/${tenantSlug}/dashboard`}
                className={buttonVariants({ variant: 'primary' })}
                id="forbidden-back-btn"
            >
                ← {t('backToDashboard')}
            </a>
        </div>
    );
}
