'use client';

/**
 * B5 — Evidence edit modal.
 *
 * Pre-B5 evidence rows could not be edited after creation through
 * the UI — the `updateEvidence` usecase + the
 * `PATCH /api/t/:slug/evidence/:id` route both existed but no
 * client surface called them.
 *
 * Mirrors the canonical modal-form shape (NewVendorModal +
 * NewAssetModal) — wraps the existing `<Modal>` shell with a
 * disabled-while-submitting fieldset and an unsaved-changes guard
 * on close.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { UserCombobox } from '@/components/ui/user-combobox';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export interface EditEvidenceModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    initial: {
        id: string;
        title: string;
        description: string | null;
        ownerUserId: string | null;
        controlId: string | null;
    } | null;
    onSaved?: () => void;
}

export function EditEvidenceModal({
    open,
    setOpen,
    tenantSlug,
    initial,
    onSaved,
}: EditEvidenceModalProps) {
    const apiUrl = useTenantApiUrl();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
    const [controlId, setControlId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    // Seed from `initial` when the modal opens; reset dirty + error
    // each time so a re-open after cancel reads clean.
    useEffect(() => {
        if (open && initial) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTitle(initial.title);
            setDescription(initial.description ?? '');
            setOwnerUserId(initial.ownerUserId);
            setControlId(initial.controlId ?? '');
            setSubmitting(false);
            setError(null);
            setIsDirty(false);
        }
    }, [open, initial]);

    const canSubmit = title.trim().length > 0 && !submitting;

    const submit = async () => {
        if (!initial) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/evidence/${initial.id}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    description: description || null,
                    ownerUserId: ownerUserId || null,
                    controlId: controlId || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err.error?.message || 'Failed to update evidence');
                return;
            }
            setIsDirty(false);
            setOpen(false);
            onSaved?.();
        } finally {
            setSubmitting(false);
        }
    };

    const guardedSetOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
        (next) => {
            const wantClose =
                typeof next === 'function' ? !next(true) : next === false;
            if (wantClose) {
                if (submitting) return;
                if (
                    isDirty &&
                    !window.confirm(
                        'Discard changes? Any edits you made will be lost.',
                    )
                ) {
                    return;
                }
            }
            setOpen(next);
        },
        [submitting, isDirty, setOpen],
    );
    const close = () => guardedSetOpen(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void submit();
    };

    const markDirty = () => setIsDirty(true);

    return (
        <Modal
            showModal={open}
            setShowModal={guardedSetOpen}
            size="lg"
            title="Edit evidence"
            description="Update the details of this evidence record."
            preventDefaultClose={submitting}
        >
            <Modal.Header
                title="Edit evidence"
                description="Update the details of this evidence record."
            />
            <Modal.Form id="edit-evidence-form" onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="edit-evidence-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset
                        disabled={submitting}
                        className="m-0 p-0 border-0 space-y-default"
                    >
                        <FormField label="Title" required>
                            <Input
                                id="edit-evidence-title-input"
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                    markDirty();
                                }}
                                required
                            />
                        </FormField>
                        <FormField label="Description">
                            <Textarea
                                id="edit-evidence-description"
                                className="h-24"
                                value={description}
                                onChange={(e) => {
                                    setDescription(e.target.value);
                                    markDirty();
                                }}
                            />
                        </FormField>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                            <FormField label="Owner">
                                <UserCombobox
                                    id="edit-evidence-owner-input"
                                    name="ownerUserId"
                                    tenantSlug={tenantSlug}
                                    selectedId={ownerUserId}
                                    onChange={(userId) => {
                                        setOwnerUserId(userId ?? null);
                                        markDirty();
                                    }}
                                    placeholder="Unassigned"
                                />
                            </FormField>
                            <FormField label="Control ID (optional)">
                                <Input
                                    id="edit-evidence-control-input"
                                    value={controlId}
                                    onChange={(e) => {
                                        setControlId(e.target.value);
                                        markDirty();
                                    }}
                                    placeholder="Paste control ID to link"
                                />
                            </FormField>
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={close}
                        disabled={submitting}
                        id="edit-evidence-cancel-btn"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!canSubmit}
                        id="edit-evidence-submit-btn"
                    >
                        {submitting ? 'Saving…' : 'Save changes'}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
