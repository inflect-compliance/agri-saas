'use client';

/**
 * Asset-edit form hook — modal-form P1 extraction.
 *
 * Unlike the other three entities (create flows), the asset hook is
 * an EDIT flow. The detail page passes `assetId` + `initial` (seeded
 * from the loaded `asset` row); `submit()` PATCHes the partial form
 * back. `onSuccess` receives the updated asset and is expected to
 * close the editor / refresh the detail card.
 *
 * The hook is structurally identical to the create hooks so the P2
 * `<EditAssetModal>` can compose it against the same `<EditAssetFields>`
 * markup. See
 * `docs/implementation-notes/2026-05-24-modal-form-architecture.md`.
 */
import { useState } from 'react';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export interface EditAssetFormFields {
    name: string;
    type: string;
    classification: string;
    owner: string;
    /** "Assigned to" — real user reference (User.id), '' = unassigned. */
    ownerUserId: string;
    location: string;
    criticality: string;
    status: string;
    dataResidency: string;
    externalRef: string;
    confidentiality: number;
    integrity: number;
    availability: number;
}

export interface EditAssetFormReturn {
    fields: EditAssetFormFields;
    setField: <K extends keyof EditAssetFormFields>(
        key: K,
        value: EditAssetFormFields[K],
    ) => void;
    submitting: boolean;
    error: string | null;
    canSubmit: boolean;
    submit: () => Promise<void>;
    isDirty: boolean;
}

export interface UseEditAssetFormOptions {
    assetId: string;
    initial: Partial<EditAssetFormFields>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (asset: any) => void;
}

const DEFAULTS: EditAssetFormFields = {
    name: '',
    type: 'SYSTEM',
    classification: '',
    owner: '',
    ownerUserId: '',
    location: '',
    criticality: '',
    status: 'ACTIVE',
    dataResidency: '',
    externalRef: '',
    confidentiality: 3,
    integrity: 3,
    availability: 3,
};

export function useEditAssetForm({
    assetId,
    initial,
    onSuccess,
}: UseEditAssetFormOptions): EditAssetFormReturn {
    const apiUrl = useTenantApiUrl();

    const [fields, setFields] = useState<EditAssetFormFields>(() => ({
        ...DEFAULTS,
        ...initial,
    }));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    const setField = <K extends keyof EditAssetFormFields>(
        key: K,
        value: EditAssetFormFields[K],
    ) => {
        setFields((f) => ({ ...f, [key]: value }));
        setIsDirty(true);
    };

    const canSubmit = fields.name.trim().length > 0 && !submitting;

    const submit = async (): Promise<void> => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/assets/${assetId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            });
            if (!res.ok) throw new Error(`Failed to save (${res.status})`);
            const updated = await res.json();
            setIsDirty(false);
            onSuccess(updated);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return {
        fields,
        setField,
        submitting,
        error,
        canSubmit,
        submit,
        isDirty,
    };
}
