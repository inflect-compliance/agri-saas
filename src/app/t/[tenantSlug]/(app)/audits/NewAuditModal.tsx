'use client';

/**
 * NewAuditModal — modal-form follow-up (audits was missed by the
 * original P2 which scoped tasks / policies / vendors / assets-EDIT
 * only). Mirrors `<NewVendorModal>`: shared `<NewAuditFields>` +
 * unsaved-changes guard + `Modal.Form` pinned-footer shell.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { queryKeys } from '@/lib/queryKeys';
import { useNewAuditForm } from './_form/useNewAuditForm';
import {
    NewAuditFields,
    type NewAuditFieldsLabels,
} from './_form/NewAuditFields';

export interface NewAuditModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    /**
     * Called after a successful create — AuditsClient uses this to
     * load the freshly-minted audit into its master/detail pane so
     * the modal close lands the user on the new row's detail view.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onCreated?: (audit: any) => void;
    labels: NewAuditFieldsLabels & {
        cancel: string;
        createAudit: string;
        newAudit: string;
    };
}

export function NewAuditModal({
    open,
    setOpen,
    tenantSlug,
    onCreated,
    labels,
}: NewAuditModalProps) {
    const queryClient = useQueryClient();
    const t = useTranslations('audits');

    const form = useNewAuditForm({
        onSuccess: (audit) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.audits.all(tenantSlug),
            });
            setOpen(false);
            onCreated?.(audit);
        },
    });

    const guardedSetOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
        (next) => {
            const wantClose =
                typeof next === 'function' ? !next(true) : next === false;
            if (wantClose) {
                if (form.submitting) return;
                if (
                    form.isDirty &&
                    !window.confirm(t('discardConfirm'))
                ) {
                    return;
                }
            }
            setOpen(next);
        },
        [form.submitting, form.isDirty, setOpen],
    );
    const close = () => guardedSetOpen(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void form.submit();
    };

    return (
        <Modal
            showModal={open}
            setShowModal={guardedSetOpen}
            size="lg"
            title={labels.newAudit}
            description={t('newAuditDescription')}
            preventDefaultClose={form.submitting}
        >
            <Modal.Header
                title={labels.newAudit}
                description={t('newAuditDescription')}
            />
            <Modal.Form id="new-audit-form" onSubmit={handleSubmit}>
                <Modal.Body>
                    {form.error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="new-audit-error"
                            role="alert"
                        >
                            {form.error}
                        </div>
                    )}
                    <fieldset
                        disabled={form.submitting}
                        className="m-0 p-0 border-0 space-y-default"
                    >
                        <NewAuditFields form={form} labels={labels} />
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={close}
                        disabled={form.submitting}
                        id="new-audit-cancel-btn"
                    >
                        {labels.cancel}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!form.canSubmit}
                        id="create-audit-btn"
                    >
                        {form.submitting ? t('creating') : labels.createAudit}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
