import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { env } from '@/env';
import { Heading } from '@/components/ui/typography';

/**
 * Privacy notice — a PUBLIC route (no tenant, no auth), because the promotions
 * consent notice links here before a supplier ever sees a farmer's request.
 *
 * ## What this page may and may not say
 *
 * Every factual claim below is one the code actually implements and this
 * session verified:
 *
 *   - sensitive fields are ciphertext at rest        → Epic B manifest
 *   - one farm's data is isolated from another's     → Postgres RLS, FORCEd
 *   - an offer request shares name + message         → the consent notice text
 *   - consent is recorded with a timestamp           → PromotionLead.consentedAt
 *
 * Deliberately ABSENT: any retention or auto-deletion period. `deletedAt`
 * exists on `PromotionLead`, but the only retention sweep that runs is
 * Evidence-only — promising "we delete after N months" would be a claim the
 * system does not keep, which is exactly the class of defect the promotions
 * work removed. When a lead sweep is scheduled, add the window here.
 *
 * The data CONTROLLER is the operator of this deployment, not the software, so
 * their identity and contact address come from configuration rather than being
 * invented here. Where it is unset the section is omitted rather than filled
 * with a placeholder that reads as real.
 */
export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('privacy');
    return { title: t('title'), description: t('intro') };
}

export default async function PrivacyPage() {
    const t = await getTranslations('privacy');
    const contact = env.PRIVACY_CONTACT_EMAIL;

    const sections = [
        { key: 'collect', body: ['collectAccount', 'collectFarm', 'collectRequests'] },
        { key: 'use', body: ['useOperate', 'useSuppliers'] },
        { key: 'protect', body: ['protectEncryption', 'protectIsolation', 'protectConsent'] },
        { key: 'rights', body: ['rightsList'] },
    ] as const;

    return (
        <main className="mx-auto max-w-3xl space-y-section px-4 py-12">
            <header className="space-y-default">
                <Heading level={1}>{t('title')}</Heading>
                <p className="text-content-muted">{t('intro')}</p>
            </header>

            {sections.map((section) => (
                <section key={section.key} className="space-y-default">
                    <Heading level={2}>{t(`${section.key}Title`)}</Heading>
                    {section.body.map((line) => (
                        <p key={line} className="text-content-muted">
                            {t(line)}
                        </p>
                    ))}
                </section>
            ))}

            <section className="space-y-default">
                <Heading level={2}>{t('controllerTitle')}</Heading>
                <p className="text-content-muted">{t('controllerBody')}</p>
                {/* Rendered only when the operator has configured a real
                    address — an unconfigured deployment shows no contact rather
                    than an invented one. */}
                {contact ? (
                    <p className="text-content-muted">
                        {t('controllerContact')}{' '}
                        <a href={`mailto:${contact}`} className="underline hover:text-content-emphasis">
                            {contact}
                        </a>
                    </p>
                ) : null}
            </section>
        </main>
    );
}
