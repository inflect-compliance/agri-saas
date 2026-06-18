'use client';

/**
 * SprayJobWizard — mobile-first "New spray job" flow (mobile-data-entry).
 *
 * Wraps the shared `<StepWizard>` primitive to walk a field operator
 * through one decision per screen: parcels → product → rate → confirm.
 * Reuses the data + submit shape of `PrescriptionPanel` (the desktop
 * inline spray-job form) but routes the create through `useOfflineSync`
 * so it completes OFFLINE — queued in the outbox on a phone with no
 * signal and flushed on reconnect.
 *
 * The wizard OWNS the form, so each step's `content` is FIELDS only (no
 * nested form / submit). `assigneeUserId` is the CURRENT user (the same
 * field PrescriptionPanel POSTs), resolved from `/api/auth/me`.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { StepWizard, type StepWizardStep } from '@/components/ui/step-wizard';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';
import { apiGet } from '@/lib/api-client';

// Mirror the DTOs PrescriptionPanel uses for /items + /units?measure=RATE.
interface ItemDTO {
    id: string;
    name: string;
    category: string;
    defaultUnit?: { id: string; symbol: string } | null;
}
interface UnitDTO {
    id: string;
    key: string;
    name: string;
    symbol: string;
    measure: string;
}
interface MeResponse {
    user?: { id?: string | null } | null;
}

export interface SprayParcel {
    id: string;
    name: string;
    areaHa?: number | null;
}

export interface SprayJobWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: string;
    /** The location's parcels (already loaded by the detail page). */
    parcels: SprayParcel[];
    /** Fired after a successful (or queued) create so the page can refresh. */
    onCreated?: (result: { queued: boolean }) => void;
}

export function SprayJobWizard({
    open,
    onOpenChange,
    locationId,
    parcels,
    onCreated,
}: SprayJobWizardProps) {
    const buildUrl = useTenantApiUrl();
    const { submit } = useOfflineSync();

    // Data sources mirror PrescriptionPanel exactly.
    const { data: items } = useTenantSWR<ItemDTO[]>('/items');
    const { data: units } = useTenantSWR<UnitDTO[]>('/units?measure=RATE', {
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
    });
    // Current user → assigneeUserId (the field PrescriptionPanel sends).
    // `/api/auth/me` is unscoped, so it uses plain useSWR + apiGet rather
    // than the tenant-prefixing useTenantSWR (per its docstring guidance).
    const { data: me } = useSWR<MeResponse>('/api/auth/me', apiGet);
    const assigneeUserId = me?.user?.id ?? null;

    const [selectedParcelIds, setSelectedParcelIds] = useState<string[]>([]);
    const [productItemId, setProductItemId] = useState('');
    const [dose, setDose] = useState('');
    const [doseUnitId, setDoseUnitId] = useState('');

    const productOptions = useMemo<ComboboxOption<ItemDTO>[]>(
        () => (items ?? []).map((it) => ({ value: it.id, label: it.name, meta: it })),
        [items],
    );
    const unitOptions = useMemo<ComboboxOption<UnitDTO>[]>(
        () => (units ?? []).map((u) => ({ value: u.id, label: u.symbol, meta: u })),
        [units],
    );

    const selectedProduct = productOptions.find((o) => o.value === productItemId) ?? null;
    const selectedUnit = unitOptions.find((o) => o.value === doseUnitId) ?? null;
    const doseNumber = Number(dose);
    const doseValid = dose.trim() !== '' && Number.isFinite(doseNumber) && doseNumber > 0;

    const toggleParcel = (id: string) =>
        setSelectedParcelIds((prev) =>
            prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        );

    const reset = () => {
        setSelectedParcelIds([]);
        setProductItemId('');
        setDose('');
        setDoseUnitId('');
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    const steps: StepWizardStep[] = [
        {
            id: 'parcels',
            title: 'Which parcels?',
            description: 'Pick the parcels this spray job covers.',
            canAdvance: selectedParcelIds.length > 0,
            content: (
                <div role="group" aria-label="Parcels" className="space-y-tight">
                    {parcels.length === 0 ? (
                        <p className="py-6 text-center text-sm text-content-muted">
                            This location has no parcels yet.
                        </p>
                    ) : (
                        parcels.map((p) => {
                            const checked = selectedParcelIds.includes(p.id);
                            const inputId = `spray-parcel-${p.id}`;
                            return (
                                <label
                                    key={p.id}
                                    htmlFor={inputId}
                                    className="flex min-h-[44px] cursor-pointer items-center gap-default rounded-lg border border-border-subtle px-3 py-2 hover:bg-bg-muted/50"
                                >
                                    <Checkbox
                                        id={inputId}
                                        size="lg"
                                        checked={checked}
                                        onCheckedChange={() => toggleParcel(p.id)}
                                    />
                                    <span className="flex-1">
                                        <span className="block text-sm font-medium">{p.name}</span>
                                        {p.areaHa != null && (
                                            <span className="block text-xs text-content-subtle">
                                                {p.areaHa} ha
                                            </span>
                                        )}
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>
            ),
        },
        {
            id: 'product',
            title: 'Which product?',
            description: 'Choose the product to apply.',
            canAdvance: Boolean(productItemId),
            content: (
                <FormField label="Product" required>
                    <Combobox<false, ItemDTO>
                        options={productOptions}
                        selected={selectedProduct}
                        setSelected={(opt) => setProductItemId(opt?.value ?? '')}
                        placeholder="Select a product…"
                        searchPlaceholder="Search products…"
                        emptyState="No products match"
                        forceDropdown
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
            ),
        },
        {
            id: 'rate',
            title: 'What rate?',
            description: 'Set the dose and unit.',
            canAdvance: doseValid && Boolean(doseUnitId),
            content: (
                <div className="grid grid-cols-2 gap-default">
                    <FormField label="Dose" required>
                        {/* inputMode decimal → mobile number pad (with decimal
                            point), without the native numeric-input wheel-scroll
                            / locale-separator footguns. Validated in JS (doseValid). */}
                        <Input
                            inputMode="decimal"
                            value={dose}
                            onChange={(e) => setDose(e.target.value)}
                            placeholder="e.g. 2.5"
                        />
                    </FormField>
                    <FormField label="Unit" required>
                        <Combobox<false, UnitDTO>
                            options={unitOptions}
                            selected={selectedUnit}
                            setSelected={(opt) => setDoseUnitId(opt?.value ?? '')}
                            placeholder="Unit…"
                            searchPlaceholder="Search units…"
                            emptyState="No units match"
                            forceDropdown
                            matchTriggerWidth
                            buttonProps={{ className: 'w-full' }}
                            caret
                        />
                    </FormField>
                </div>
            ),
        },
        {
            id: 'confirm',
            title: 'Confirm spray job',
            description: 'Review before creating.',
            // Final guard: the schema requires an assignee — block finish
            // until /api/auth/me has resolved the current user.
            canAdvance: Boolean(assigneeUserId),
            content: (
                <dl className="space-y-default text-sm">
                    <div>
                        <dt className="text-content-secondary">Parcels</dt>
                        <dd className="font-medium">
                            {selectedParcelIds
                                .map((id) => parcels.find((p) => p.id === id)?.name ?? id)
                                .join(', ') || '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-content-secondary">Product</dt>
                        <dd className="font-medium">{selectedProduct?.label ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-content-secondary">Rate</dt>
                        <dd className="font-medium">
                            {doseValid ? doseNumber : '—'} {selectedUnit?.meta?.symbol ?? ''}
                        </dd>
                    </div>
                    {!assigneeUserId && (
                        <p className="text-xs text-content-muted">
                            Loading your account…
                        </p>
                    )}
                </dl>
            ),
        },
    ];

    const isDirty =
        selectedParcelIds.length > 0 ||
        Boolean(productItemId) ||
        dose.trim() !== '' ||
        Boolean(doseUnitId);

    const onFinish = async (): Promise<{ queued: boolean }> => {
        // assigneeUserId is gated by the confirm step's canAdvance.
        const result = await submit({
            url: buildUrl(`/locations/${locationId}/operations`),
            method: 'POST',
            body: {
                operationType: 'SPRAY',
                assigneeUserId,
                parcelIds: selectedParcelIds,
                productItemId,
                doseValue: Number(dose),
                doseUnitId,
            },
            label: 'Create spray job',
        });
        const queued = result === 'queued';
        onCreated?.({ queued });
        reset();
        return { queued };
    };

    return (
        <StepWizard
            open={open}
            onOpenChange={handleOpenChange}
            title="New spray job"
            steps={steps}
            onFinish={onFinish}
            finishLabel="Create spray job"
            isDirty={isDirty}
        />
    );
}

export default SprayJobWizard;
