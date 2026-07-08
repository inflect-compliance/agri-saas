'use client';

/**
 * "Ask for offer" insurance-quote modal (#13). Lead-gen only: stores an
 * InsuranceLead (with a snapshot of the parcel's satellite risk) + a
 * confirmation notification. Mirrors the #12 offers AskForOfferModal.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

interface AskInsuranceModalProps {
    parcelId: string;
    locationId: string;
    risk: { overall: string; ndvi: number | null; ndmi: number | null };
}

export function AskInsuranceModal({ parcelId, locationId, risk }: AskInsuranceModalProps) {
    const t = useTranslations('ag.risk.ask');
    const buildUrl = useTenantApiUrl();
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const canSubmit = message.trim().length > 0 && !submitting;

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            await apiPost(buildUrl('/insurance/leads'), {
                parcelId,
                locationId,
                message: message.trim(),
                risk,
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

    return (
        <>
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(true)} disabled={sent}>
                {sent ? t('sent') : t('open')}
            </Button>
            <Modal
                showModal={open}
                setShowModal={setOpen}
                size="md"
                title={t('title')}
                description={t('description')}
                preventDefaultClose={submitting}
                isDirty={message !== ''}
            >
                <Modal.Header title={t('title')} description={t('description')} />
                <Modal.Form
                    id="insurance-lead-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <Modal.Body>
                        {error && (
                            <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                {error}
                            </div>
                        )}
                        <fieldset disabled={submitting} className="m-0 space-y-default border-0 p-0">
                            <FormField label={t('message')} required>
                                <Textarea
                                    id="insurance-lead-message"
                                    rows={3}
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder={t('messagePlaceholder')}
                                />
                            </FormField>
                        </fieldset>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)} disabled={submitting}>
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
