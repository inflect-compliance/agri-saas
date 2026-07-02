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
 * nested form / submit). The final confirm step carries an "Assign to"
 * people-picker (`<UserCombobox>`) — defaulted to the CURRENT user
 * (resolved from `/api/auth/me`) but reassignable to any active member,
 * so a manager can dispatch the job to the operator who'll run it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { StepWizard, type StepWizardStep } from '@/components/ui/step-wizard';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { UserCombobox } from '@/components/ui/user-combobox';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';
import { apiGet } from '@/lib/api-client';
import { haToDca, totalLabel, trimNumber } from '@/lib/agro/rate-calc';
import type { LocationSmartDefaults } from '@/app-layer/usecases/smart-defaults';

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
    /**
     * Parcels to pre-select when the wizard opens — powers the
     * "Start operation here" affordance from the mobile parcel sheet, so
     * the operator lands on the product step with their parcel already
     * chosen. Re-seeded on every open.
     */
    initialParcelIds?: string[];
    /** Fired after a successful (or queued) create so the page can refresh. */
    onCreated?: (result: { queued: boolean }) => void;
    /**
     * Recall over this location's past jobs (recency/frequency, no ML) —
     * powers "Repeat last job" + the dose/unit prefills. Every applied value
     * is an editable SUGGESTION; the operator can override any field.
     */
    smartDefaults?: LocationSmartDefaults | null;
}

export function SprayJobWizard({
    open,
    onOpenChange,
    locationId,
    parcels,
    initialParcelIds,
    onCreated,
    smartDefaults,
}: SprayJobWizardProps) {
    const buildUrl = useTenantApiUrl();
    // Route slug for the assignee picker's member fetch — read from the URL
    // params (same source the parent page uses), so it needs no extra
    // provider wiring in tests that render this wizard.
    const { tenantSlug } = useParams<{ tenantSlug: string }>();
    const { submit } = useOfflineSync();

    // Data sources mirror PrescriptionPanel exactly.
    const { data: items } = useTenantSWR<ItemDTO[]>('/items');
    const { data: units } = useTenantSWR<UnitDTO[]>('/units?measure=RATE', {
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
    });
    // Current user → the DEFAULT assignee. `/api/auth/me` is unscoped, so it
    // uses plain useSWR + apiGet rather than the tenant-prefixing
    // useTenantSWR (per its docstring guidance). The operator can reassign
    // the job to any active member in the confirm step's "Assign to" picker.
    const { data: me } = useSWR<MeResponse>('/api/auth/me', apiGet);
    const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);

    const [selectedParcelIds, setSelectedParcelIds] = useState<string[]>(initialParcelIds ?? []);
    // Soil-nurturing fertilizer (step 2/3) then treatment product (step 4/5).
    const [fertilizerItemId, setFertilizerItemId] = useState('');
    const [fertDose, setFertDose] = useState('');
    const [fertDoseUnitId, setFertDoseUnitId] = useState('');
    const [productItemId, setProductItemId] = useState('');
    const [dose, setDose] = useState('');
    const [doseUnitId, setDoseUnitId] = useState('');
    // Water-carrier rate (per-decare) for the spray tank — feeds the total-
    // water calculation and is persisted on the treatment line.
    const [waterRate, setWaterRate] = useState('');
    const [waterRateUnitId, setWaterRateUnitId] = useState('');

    // Fertilizers feed the Soil Nurturing step; everything else feeds the
    // Treatment step, so the two pickers never overlap.
    const fertilizerOptions = useMemo<ComboboxOption<ItemDTO>[]>(
        () => (items ?? []).filter((it) => it.category === 'FERTILIZER').map((it) => ({ value: it.id, label: it.name, meta: it })),
        [items],
    );
    const treatmentOptions = useMemo<ComboboxOption<ItemDTO>[]>(
        () => (items ?? []).filter((it) => it.category !== 'FERTILIZER').map((it) => ({ value: it.id, label: it.name, meta: it })),
        [items],
    );
    const unitOptions = useMemo<ComboboxOption<UnitDTO>[]>(
        () => (units ?? []).map((u) => ({ value: u.id, label: u.symbol, meta: u })),
        [units],
    );

    const selectedFertilizer = fertilizerOptions.find((o) => o.value === fertilizerItemId) ?? null;
    const selectedFertUnit = unitOptions.find((o) => o.value === fertDoseUnitId) ?? null;
    const fertDoseNumber = Number(fertDose);
    const fertDoseValid = fertDose.trim() !== '' && Number.isFinite(fertDoseNumber) && fertDoseNumber > 0;

    const selectedProduct = treatmentOptions.find((o) => o.value === productItemId) ?? null;
    const selectedUnit = unitOptions.find((o) => o.value === doseUnitId) ?? null;
    const doseNumber = Number(dose);
    const doseValid = dose.trim() !== '' && Number.isFinite(doseNumber) && doseNumber > 0;

    const selectedWaterUnit = unitOptions.find((o) => o.value === waterRateUnitId) ?? null;
    const waterRateNumber = Number(waterRate);
    const waterRateValid =
        waterRate.trim() !== '' && Number.isFinite(waterRateNumber) && waterRateNumber > 0;

    // Combined area of the selected parcels — the calculator basis.
    const selectedAreaHa = useMemo(
        () =>
            selectedParcelIds.reduce(
                (sum, id) => sum + (parcels.find((p) => p.id === id)?.areaHa ?? 0),
                0,
            ),
        [selectedParcelIds, parcels],
    );
    const selectedDca = haToDca(selectedAreaHa);
    const areaSummary =
        selectedAreaHa > 0 ? `${trimNumber(selectedAreaHa)} ha · ${trimNumber(selectedDca)} dca` : null;

    // Seed the parcel selection from `initialParcelIds` each time the
    // wizard opens (the "Start operation here" path). Keyed on the joined
    // ids so a changed seed re-applies; `open` gates it to entry only.
    const seedKey = (initialParcelIds ?? []).join(',');
    useEffect(() => {
        if (open) setSelectedParcelIds(initialParcelIds ?? []);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on open only
    }, [open, seedKey]);

    // Default the assignee to the current operator once the wizard is open
    // and /api/auth/me has resolved — but never clobber a deliberate
    // reassignment (only fill when still empty). reset() clears it on close
    // so the next open re-seeds to whoever is signed in.
    useEffect(() => {
        if (open && me?.user?.id) {
            setAssigneeUserId((prev) => prev ?? me.user?.id ?? null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on open / me-resolve only
    }, [open, me?.user?.id]);

    // ── Smart defaults (editable suggestions) ──────────────────────────
    const repeatLast = smartDefaults?.repeatLast ?? null;

    // Prefill the default unit on open (the location's most-recently-used
    // RATE unit) — only when the operator hasn't picked one.
    useEffect(() => {
        if (!open) return;
        if (!doseUnitId && smartDefaults?.defaultUnitId) setDoseUnitId(smartDefaults.defaultUnitId);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill on open only
    }, [open, smartDefaults?.defaultUnitId]);

    // Default the water-carrier unit to litres-per-decare when available —
    // the standard tank rate, and the basis the calculator expects.
    useEffect(() => {
        if (!open || waterRateUnitId) return;
        const lPerDca = (units ?? []).find((u) => u.symbol === 'L/dca');
        if (lPerDca) setWaterRateUnitId(lPerDca.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- default on open / units-resolve only
    }, [open, units]);

    // The dose last used for the chosen product on this location (recency).
    const recalledForProduct = useMemo(() => {
        if (!productItemId) return null;
        if (repeatLast?.productItemId === productItemId) {
            return { doseValue: repeatLast.doseValue, doseUnitId: repeatLast.doseUnitId };
        }
        return (
            Object.values(smartDefaults?.byParcel ?? {}).find(
                (d) => d.productItemId === productItemId,
            ) ?? null
        );
    }, [productItemId, repeatLast, smartDefaults]);

    // Suggest that dose when a product with history is picked and the operator
    // hasn't typed one — editable, never forced.
    useEffect(() => {
        if (!recalledForProduct || dose.trim() !== '') return;
        setDose(String(recalledForProduct.doseValue));
        if (!doseUnitId) setDoseUnitId(recalledForProduct.doseUnitId);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- suggest on product pick only
    }, [recalledForProduct]);

    // One-tap "Repeat last job": apply the whole prior job (parcels still on
    // this location + product + dose + unit). The operator can then edit any
    // step before confirming.
    const applyRepeatLast = () => {
        if (!repeatLast) return;
        setSelectedParcelIds(repeatLast.parcelIds.filter((id) => parcels.some((p) => p.id === id)));
        setProductItemId(repeatLast.productItemId);
        setDose(String(repeatLast.doseValue));
        setDoseUnitId(repeatLast.doseUnitId);
    };

    const repeatLabel = repeatLast
        ? [
              items?.find((i) => i.id === repeatLast.productItemId)?.name,
              `${repeatLast.doseValue} ${units?.find((u) => u.id === repeatLast.doseUnitId)?.symbol ?? ''}`.trim(),
          ]
              .filter(Boolean)
              .join(' · ')
        : null;

    const recalledUnitSymbol = recalledForProduct
        ? units?.find((u) => u.id === recalledForProduct.doseUnitId)?.symbol ?? ''
        : '';

    const toggleParcel = (id: string) =>
        setSelectedParcelIds((prev) =>
            prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        );

    const reset = () => {
        setSelectedParcelIds([]);
        setFertilizerItemId('');
        setFertDose('');
        setFertDoseUnitId('');
        setProductItemId('');
        setDose('');
        setDoseUnitId('');
        setWaterRate('');
        setWaterRateUnitId('');
        setAssigneeUserId(null);
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    // One "X needed" row — rate × selected-parcel area, honouring the
    // unit's /ha or /dca basis. Renders nothing until the inputs are usable.
    const totalRow = (label: string, rateStr: string, unitSymbol?: string) => {
        const rate = Number(rateStr);
        if (!unitSymbol || !Number.isFinite(rate) || rate <= 0 || selectedAreaHa <= 0) return null;
        return (
            <div className="flex items-baseline justify-between gap-default">
                <dt className="text-content-secondary">{label}</dt>
                <dd className="font-medium tabular-nums">{totalLabel(rate, unitSymbol, selectedAreaHa)}</dd>
            </div>
        );
    };

    // The calculator panel — combined area + the "needed for these parcels"
    // totals. Hidden until parcels with a known area are selected.
    const totalsPanel = (rows: ReactNode) => {
        if (selectedAreaHa <= 0) return null;
        return (
            <div className="rounded-lg border border-border-subtle bg-bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-content-muted">
                    Needed for {areaSummary}
                </p>
                <dl className="space-y-tight">{rows}</dl>
            </div>
        );
    };

    const steps: StepWizardStep[] = [
        {
            id: 'parcels',
            title: 'Which parcels?',
            description: 'Pick the parcels this spray job covers.',
            canAdvance: selectedParcelIds.length > 0,
            content: (
                <div role="group" aria-label="Parcels" className="space-y-tight">
                    {repeatLast && (
                        <button
                            type="button"
                            onClick={applyRepeatLast}
                            className="flex min-h-[44px] w-full items-center gap-default rounded-lg border border-border-emphasis bg-bg-muted/40 px-3 py-2 text-left hover:bg-bg-muted"
                        >
                            <span className="flex-1">
                                <span className="block text-sm font-medium">Repeat last job</span>
                                {repeatLabel && (
                                    <span className="block text-xs text-content-secondary">
                                        {repeatLabel}
                                    </span>
                                )}
                            </span>
                        </button>
                    )}
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
            id: 'fertilizer',
            title: 'Soil Nurturing',
            description: 'Choose the fertilizer to apply.',
            canAdvance: Boolean(fertilizerItemId),
            content: (
                <FormField label="Fertilizer" required>
                    <Combobox<false, ItemDTO>
                        options={fertilizerOptions}
                        selected={selectedFertilizer}
                        setSelected={(opt) => setFertilizerItemId(opt?.value ?? '')}
                        placeholder="Select a fertilizer…"
                        searchPlaceholder="Search fertilizers…"
                        emptyState="No fertilizers in inventory"
                        forceDropdown
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
            ),
        },
        {
            id: 'fertilizer-rate',
            title: 'What rate?',
            description: 'Set the fertilizer dose and unit.',
            canAdvance: fertDoseValid && Boolean(fertDoseUnitId),
            content: (
                <div className="space-y-default">
                    <div className="grid grid-cols-2 gap-default">
                        <FormField label="Dose" required>
                            <Input
                                inputMode="decimal"
                                value={fertDose}
                                onChange={(e) => setFertDose(e.target.value)}
                                placeholder="e.g. 150"
                            />
                        </FormField>
                        <FormField label="Unit" required>
                            <Combobox<false, UnitDTO>
                                options={unitOptions}
                                selected={selectedFertUnit}
                                setSelected={(opt) => setFertDoseUnitId(opt?.value ?? '')}
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
                    {totalsPanel(totalRow('Fertilizer', fertDose, selectedFertUnit?.meta?.symbol))}
                </div>
            ),
        },
        {
            id: 'product',
            title: 'Treatment',
            description: 'Choose the product to apply.',
            canAdvance: Boolean(productItemId),
            content: (
                <FormField label="Product" required>
                    <Combobox<false, ItemDTO>
                        options={treatmentOptions}
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
                <div className="space-y-tight">
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
                {recalledForProduct && (
                    <p className="text-xs text-content-secondary">
                        Last time: {recalledForProduct.doseValue} {recalledUnitSymbol} — edit if it&rsquo;s changed.
                    </p>
                )}
                {/* Water carrier — the tank-mix volume rate. Optional; drives
                    the total-water figure in the calculator below. */}
                <div className="grid grid-cols-2 gap-default">
                    <FormField label="Water (carrier)">
                        <Input
                            inputMode="decimal"
                            value={waterRate}
                            onChange={(e) => setWaterRate(e.target.value)}
                            placeholder="e.g. 14"
                        />
                    </FormField>
                    <FormField label="Unit">
                        <Combobox<false, UnitDTO>
                            options={unitOptions}
                            selected={selectedWaterUnit}
                            setSelected={(opt) => setWaterRateUnitId(opt?.value ?? '')}
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
                {totalsPanel(
                    <>
                        {totalRow('Water', waterRate, selectedWaterUnit?.meta?.symbol)}
                        {totalRow('Product', dose, selectedUnit?.meta?.symbol)}
                    </>,
                )}
                </div>
            ),
        },
        {
            id: 'confirm',
            title: 'Confirm Spray Job',
            description: 'Review before creating.',
            // Final guard: the schema requires an assignee — block finish
            // until /api/auth/me has resolved the current user.
            canAdvance: Boolean(assigneeUserId),
            content: (
                <div className="space-y-default">
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
                            <dt className="text-content-secondary">Fertilizer</dt>
                            <dd className="font-medium">{selectedFertilizer?.label ?? '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-content-secondary">Fertilizer rate</dt>
                            <dd className="font-medium">
                                {fertDoseValid ? fertDoseNumber : '—'} {selectedFertUnit?.meta?.symbol ?? ''}
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
                        {waterRateValid && (
                            <div>
                                <dt className="text-content-secondary">Water (carrier)</dt>
                                <dd className="font-medium">
                                    {waterRateNumber} {selectedWaterUnit?.meta?.symbol ?? ''}
                                </dd>
                            </div>
                        )}
                    </dl>
                    {totalsPanel(
                        <>
                            {totalRow('Water', waterRate, selectedWaterUnit?.meta?.symbol)}
                            {totalRow('Product', dose, selectedUnit?.meta?.symbol)}
                            {totalRow('Fertilizer', fertDose, selectedFertUnit?.meta?.symbol)}
                        </>,
                    )}
                    {/* Assignee — the LAST field before creating. Defaults to
                        the current operator; reassignable to any active member
                        so a manager can dispatch the job. Required (the create
                        schema rejects an unassigned spray job). */}
                    <FormField label="Assign to" required>
                        <UserCombobox
                            id="spray-assignee-input"
                            name="assigneeUserId"
                            tenantSlug={tenantSlug}
                            selectedId={assigneeUserId}
                            onChange={(userId) => setAssigneeUserId(userId)}
                            placeholder="Select an operator…"
                            matchTriggerWidth
                        />
                    </FormField>
                </div>
            ),
        },
    ];

    const isDirty =
        selectedParcelIds.length > 0 ||
        Boolean(fertilizerItemId) ||
        fertDose.trim() !== '' ||
        Boolean(fertDoseUnitId) ||
        Boolean(productItemId) ||
        dose.trim() !== '' ||
        Boolean(doseUnitId) ||
        waterRate.trim() !== '';

    const onFinish = async (): Promise<{ queued: boolean }> => {
        // assigneeUserId is gated by the confirm step's canAdvance.
        const result = await submit({
            url: buildUrl(`/locations/${locationId}/operations`),
            method: 'POST',
            body: {
                operationType: 'SPRAY',
                assigneeUserId,
                parcelIds: selectedParcelIds,
                // Soil-nurturing fertilizer line (steps 2–3).
                fertilizerItemId,
                fertilizerDoseValue: Number(fertDose),
                fertilizerDoseUnitId: fertDoseUnitId,
                // Treatment product line (steps 4–5).
                productItemId,
                doseValue: Number(dose),
                doseUnitId,
                // Water carrier (optional) — persisted on the treatment line.
                waterRateValue: waterRateValid ? waterRateNumber : null,
                waterRateUnitId: waterRateValid ? waterRateUnitId : null,
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
