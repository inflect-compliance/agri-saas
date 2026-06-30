'use client';

/**
 * Asset-create form hook — B6 useZodForm adoption.
 *
 * Pre-B6 this was a hand-rolled `useState` shape with a canSubmit
 * gate. B6 ports it onto `useZodForm` driven by
 * `NewAssetFormSchema` so the validation is Zod-typed + the
 * shared hook owns dirty/touch/submit semantics.
 *
 * Return shape preserves the legacy contract so the wrapping
 * `<NewAssetModal>` + `<NewAssetFields>` mount with no caller-side
 * changes.
 */
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useZodForm } from '@/lib/hooks/use-zod-form';
import {
    NewAssetFormSchema,
    type NewAssetFormValues,
} from '@/lib/schemas/asset-form';

export type NewAssetFormFields = NewAssetFormValues;

export interface NewAssetFormReturn {
    fields: NewAssetFormFields;
    setField: <K extends keyof NewAssetFormFields>(
        key: K,
        value: NewAssetFormFields[K],
    ) => void;
    touchField: <K extends keyof NewAssetFormFields>(key: K) => void;
    fieldError: <K extends keyof NewAssetFormFields>(
        key: K,
    ) => string | undefined;
    submitting: boolean;
    error: string | null;
    canSubmit: boolean;
    submit: () => Promise<void>;
    isDirty: boolean;
}

export interface UseNewAssetFormOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (asset: any) => void;
}

const INITIAL: NewAssetFormFields = {
    name: '',
    type: 'TRACTOR',
    status: 'ACTIVE',
    criticality: undefined,
    ownerUserId: '',
    location: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    year: undefined,
    purchaseDate: '',
    purchaseCost: undefined,
};

export function useNewAssetForm({
    onSuccess,
}: UseNewAssetFormOptions): NewAssetFormReturn {
    const apiUrl = useTenantApiUrl();
    const zod = useZodForm({
        schema: NewAssetFormSchema,
        initial: INITIAL,
        onSubmit: async (payload) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body: any = {
                name: payload.name,
                type: payload.type,
                status: payload.status,
            };
            if (payload.criticality) body.criticality = payload.criticality;
            if (payload.ownerUserId) body.ownerUserId = payload.ownerUserId;
            if (payload.location) body.location = payload.location;
            if (payload.manufacturer) body.manufacturer = payload.manufacturer;
            if (payload.model) body.model = payload.model;
            if (payload.serialNumber) body.serialNumber = payload.serialNumber;
            if (payload.year != null) body.year = payload.year;
            if (payload.purchaseDate) body.purchaseDate = payload.purchaseDate;
            if (payload.purchaseCost != null) body.purchaseCost = payload.purchaseCost;

            const res = await fetch(apiUrl('/assets'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || 'Failed to create asset');
            }
            const asset = await res.json();
            onSuccess(asset);
        },
    });

    return {
        fields: zod.values,
        setField: zod.setField,
        touchField: zod.touchField,
        fieldError: zod.fieldError,
        submitting: zod.submitting,
        error: zod.error,
        canSubmit: zod.canSubmit,
        submit: async () => {
            await zod.submit();
        },
        isDirty: zod.isDirty,
    };
}
