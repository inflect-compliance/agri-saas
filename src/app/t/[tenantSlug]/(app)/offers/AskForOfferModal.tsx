'use client';

/**
 * "Ask for offer" modal — send a lead to a company promotion (#12).
 *
 * Lead-gen only: the message is sanitized server-side and stored as a
 * PromotionLead; the requester gets a confirmation notification. Mirrors the
 * Exchange InquiryModal shape.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { env } from '@/env';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

interface AskForOfferModalProps {
    promotionId: string;
    company: string;
}

export function AskForOfferModal({ promotionId, company }: AskForOfferModalProps) {
    const t = useTranslations('ag.offers.ask');
    const buildUrl = useTenantApiUrl();
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    // Consent is a submit PRE-CONDITION, not a field that can be left blank:
    // the request only exists to be forwarded to a supplier, so an unticked
    // box means there is nothing lawful to send. Starts false every time —
    // never remembered across opens.
    const [consent, setConsent] = useState(false);
    // The in-app /privacy page now exists, so this always resolves. The env
    // var stays as an override for an operator who hosts their own policy.
    const privacyUrl = env.NEXT_PUBLIC_PRIVACY_URL ?? '/privacy';

    const canSubmit = message.trim().length > 0 && consent && !submitting;

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            await apiPost(buildUrl('/offers/leads'), {
                promotionId,
                message: message.trim(),
                consent,
            });
            setOpen(false);
            setMessage('');
            setSent(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('error'));
        } finally {
            setSubmitting(false);
        }
    }

    const title = t('titleWithCompany', { company });

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setOpen(true)}
                disabled={sent}
            >
                {sent ? t('sent') : t('open')}
            </Button>
            <Modal
                showModal={open}
                setShowModal={setOpen}
                size="md"
                title={title}
                description={t('description', { company })}
                preventDefaultClose={submitting}
                isDirty={message !== ''}
            >
                <Modal.Header title={title} description={t('description', { company })} />
                <Modal.Form
                    id="offer-lead-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <Modal.Body>
                        {error && (
                            <div
                                role="alert"
                                className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            >
                                {error}
                            </div>
                        )}
                        <fieldset disabled={submitting} className="m-0 space-y-default border-0 p-0">
                            <FormField label={t('message')} required>
                                <Textarea
                                    id="offer-lead-message"
                                    rows={3}
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder={t('messagePlaceholder')}
                                />
                            </FormField>
                            {/* FormField owns the label element and the
                                htmlFor/id wiring, so the consent sentence stays
                                a real, clickable label without this file
                                hand-rolling a raw <label> (the coverage guard's
                                whole point). The privacy link renders only when
                                an operator has configured a real policy URL —
                                this app ships no privacy page, and pointing the
                                consent notice at a 404 would be the same broken
                                promise the rest of this work removes. */}
                            <FormField
                                label={
                                    <span className="font-normal text-content-muted">
                                        {t('consent', { company })}
                                        {' '}
                                        <Link
                                            href={privacyUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="underline hover:text-content-emphasis"
                                        >
                                            {t('privacyLink')}
                                        </Link>
                                    </span>
                                }
                                required
                            >
                                <Checkbox
                                    id="offer-lead-consent"
                                    checked={consent}
                                    onCheckedChange={(v) => setConsent(v === true)}
                                />
                            </FormField>
                        </fieldset>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => setOpen(false)}
                            disabled={submitting}
                        >
                            {t('cancel')}
                        </Button>
                        <Button variant="primary" size="sm" type="submit" loading={submitting} disabled={!canSubmit}>
                            {t('submit')}
                        </Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>
        </>
    );
}
