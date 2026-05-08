'use client';

import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button';

/**
 * Shared forbidden/access-denied page for tenant routes.
 * Shows a clear message and a link back to the tenant dashboard.
 *
 * Use this instead of notFound() when you want users to know they
 * lack the required permission (vs. the page not existing).
 */
export function ForbiddenPage({
    title = 'Access Denied',
    message = "You do not have permission to view this page. Contact your workspace admin to request access.",
}: {
    title?: string;
    message?: string;
}) {
    const tenantHref = useTenantHref();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fadeIn px-4">
            <div className="w-16 h-16 rounded-2xl bg-bg-error border border-border-error flex items-center justify-center mb-6">
                <ShieldX className="w-8 h-8 text-content-error" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2" id="forbidden-heading">{title}</h1>
            <p className="text-content-muted text-sm max-w-md mb-8">{message}</p>
            <Link
                href={tenantHref('/dashboard')}
                className={buttonVariants({ variant: 'primary' })}
                id="forbidden-back-btn"
            >
                ← Back to Dashboard
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
    title = 'Access Denied',
    message = "You do not have permission to view this page. Contact your workspace admin to request access.",
}: {
    tenantSlug: string;
    title?: string;
    message?: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fadeIn px-4">
            <div className="w-16 h-16 rounded-2xl bg-bg-error border border-border-error flex items-center justify-center mb-6">
                <ShieldX className="w-8 h-8 text-content-error" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2" id="forbidden-heading">{title}</h1>
            <p className="text-content-muted text-sm max-w-md mb-8">{message}</p>
            <a
                href={`/t/${tenantSlug}/dashboard`}
                className={buttonVariants({ variant: 'primary' })}
                id="forbidden-back-btn"
            >
                ← Back to Dashboard
            </a>
        </div>
    );
}
