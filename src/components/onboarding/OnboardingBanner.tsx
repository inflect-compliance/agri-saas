'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';

/**
 * Dashboard card that shows "Complete Setup" when onboarding is not complete.
 * Only visible to admins.
 */
export default function OnboardingBanner() {
    const t = useTranslations('onboarding');
    const { permissions } = useTenantContext();
    const tenantHref = useTenantHref();

    if (!permissions.canAdmin) return null;

    return (
        <Card className="border-[var(--brand-default)]/30 bg-gradient-to-r from-[var(--brand-subtle)] to-[var(--brand-subtle)]">
            <div className="flex items-center gap-compact">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--brand-emphasis)] to-[var(--brand-default)] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <Heading level={3}>{t('bannerTitle')}</Heading>
                    <p className="text-xs text-content-muted mt-0.5">{t('bannerDesc')}</p>
                </div>
                <Link href={tenantHref('/onboarding')} className={buttonVariants({ variant: 'primary', size: 'sm', className: 'flex-shrink-0' })} data-testid="onboarding-cta">
                    <Sparkles className="w-3.5 h-3.5" /> {t('continueSetup')}
                </Link>
            </div>
        </Card>
    );
}
