'use client';

/**
 * PrescriptionPanel — turns a parcel selection into a spray job. Pick a
 * product + dose (RATE unit) + operator, then POST the field-operation:
 * one FIELD_OPERATION Task assigned to the operator with one
 * OperationParcel line per selected parcel.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { UserCombobox } from '@/components/ui/user-combobox';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';

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

export interface PrescriptionPanelProps {
    locationId: string;
    tenantSlug: string;
    selectedParcelIds: string[];
    onCreated?: (r: { taskId: string; taskKey?: string | null; parcelCount: number }) => void;
}

const SELECT_CLASS = 'block w-full rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm';

export function PrescriptionPanel({ locationId, tenantSlug, selectedParcelIds, onCreated }: PrescriptionPanelProps) {
    const t = useTranslations('ag.map.prescription');
    const buildUrl = useTenantApiUrl();
    const { data: items } = useTenantSWR<ItemDTO[]>('/items');
    // Units are a slow-changing catalog — relax SWR revalidation.
    const { data: units } = useTenantSWR<UnitDTO[]>('/units?measure=RATE', {
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
    });

    const [productItemId, setProductItemId] = useState('');
    const [doseValue, setDoseValue] = useState('');
    const [doseUnitId, setDoseUnitId] = useState('');
    const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit = Boolean(
        selectedParcelIds.length > 0 && productItemId && doseValue && doseUnitId && assigneeUserId && !busy,
    );

    const submit = async () => {
        if (!assigneeUserId) return;
        setBusy(true);
        setError(null);
        try {
            const result = await apiPost<{ taskId: string; taskKey?: string | null; parcelCount: number }>(
                buildUrl(`/locations/${locationId}/operations`),
                {
                    operationType: 'SPRAY',
                    assigneeUserId,
                    parcelIds: selectedParcelIds,
                    productItemId,
                    doseValue: Number(doseValue),
                    doseUnitId,
                    targetNote: note || null,
                },
            );
            onCreated?.(result);
            setProductItemId('');
            setDoseValue('');
            setDoseUnitId('');
            setAssigneeUserId(null);
            setNote('');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('createFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-default">
            <p className="text-sm text-content-secondary">
                {t('parcelsSelected', { count: selectedParcelIds.length })}
            </p>
            {error && (
                <div role="alert" className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                    {error}
                </div>
            )}
            <FormField label={t('product')} required>
                <select value={productItemId} onChange={(e) => setProductItemId(e.target.value)} className={SELECT_CLASS}>
                    <option value="">{t('selectProduct')}</option>
                    {(items ?? []).map((it) => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                </select>
            </FormField>
            <div className="grid grid-cols-2 gap-default">
                <FormField label={t('dose')} required>
                    <Input type="number" min="0" step="0.0001" value={doseValue} onChange={(e) => setDoseValue(e.target.value)} placeholder={t('dosePlaceholder')} />
                </FormField>
                <FormField label={t('unit')} required>
                    <select value={doseUnitId} onChange={(e) => setDoseUnitId(e.target.value)} className={SELECT_CLASS}>
                        <option value="">{t('unitPlaceholder')}</option>
                        {(units ?? []).map((u) => (
                            <option key={u.id} value={u.id}>{u.symbol}</option>
                        ))}
                    </select>
                </FormField>
            </div>
            <FormField label={t('operator')} required>
                <UserCombobox
                    tenantSlug={tenantSlug}
                    selectedId={assigneeUserId}
                    onChange={(id) => setAssigneeUserId(id)}
                    placeholder={t('assignOperator')}
                    forceDropdown
                />
            </FormField>
            <FormField label={t('note')}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
            </FormField>
            <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit} loading={busy}>
                {busy ? t('creating') : t('createJob')}
            </Button>
        </div>
    );
}

export default PrescriptionPanel;
