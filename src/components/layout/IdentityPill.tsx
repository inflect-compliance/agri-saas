'use client';

/**
 * IdentityPill — Roadmap-2 PR-2.
 *
 * Right-edge of the top chrome. Two variants, one per shell:
 *   • TenantIdentityPill — reads `useTenantContext` for the active
 *     tenant name; click navigates to the tenant picker.
 *   • OrgIdentityPill    — reads `useOrgContext` for the active
 *     organization name; click navigates to the org picker.
 *
 * The two pills are SEPARATE components so each one calls its own
 * context hook unconditionally — `<AppShell>` picks the right pill
 * based on its `variant` prop, so a tenant page never tries to
 * read org context (which would throw) and vice versa.
 *
 * Visual treatment is deliberately quiet: the pill announces
 * context, it does not advertise itself as primary navigation.
 * The underlying click target is large enough for accessibility
 * but the tone hugs the chrome.
 */
import Link from 'next/link';
import { useTenantContext } from '@/lib/tenant-context-provider';
import { useOrgContext } from '@/lib/org-context-provider';

const PILL_CLASS =
    'inline-flex items-center gap-tight rounded-full border border-border-subtle bg-bg-default px-3 py-1 text-xs font-medium text-content-muted transition-colors hover:bg-bg-muted/40 hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

const AVATAR_CLASS =
    'flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-subtle)] text-[10px] font-semibold text-[var(--brand-emphasis)]';

function initials(name: string): string {
    const cleaned = name.trim();
    if (!cleaned) return '·';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
    return (
        parts[0]!.charAt(0).toUpperCase() +
        parts[parts.length - 1]!.charAt(0).toUpperCase()
    );
}

export function TenantIdentityPill() {
    const { tenantName } = useTenantContext();
    return (
        <Link
            href="/tenants"
            className={PILL_CLASS}
            aria-label={`Current tenant: ${tenantName}. Click to switch.`}
            data-testid="top-chrome-tenant-pill"
        >
            <span className={AVATAR_CLASS} aria-hidden="true">
                {initials(tenantName)}
            </span>
            <span className="max-w-[14ch] truncate">{tenantName}</span>
        </Link>
    );
}

export function OrgIdentityPill() {
    const { orgName } = useOrgContext();
    // No dedicated /orgs picker today — `/tenants` is the unified
    // post-sign-in picker (Tenant + Organization memberships both
    // surface there). Linking the org pill back to that picker
    // keeps the affordance consistent with the tenant pill while
    // a future /orgs picker would only swap the href.
    return (
        <Link
            href="/tenants"
            className={PILL_CLASS}
            aria-label={`Current organization: ${orgName}. Click to switch.`}
            data-testid="top-chrome-org-pill"
        >
            <span className={AVATAR_CLASS} aria-hidden="true">
                {initials(orgName)}
            </span>
            <span className="max-w-[14ch] truncate">{orgName}</span>
        </Link>
    );
}
