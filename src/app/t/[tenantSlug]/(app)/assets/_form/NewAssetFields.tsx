'use client';

/**
 * Controlled field markup for the asset-create form (agricultural
 * assets — machines, buildings, equipment).
 */
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { UserCombobox } from '@/components/ui/user-combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { ASSET_CRITICALITY_OPTIONS, ASSET_STATUS_OPTIONS } from './asset-options';
import { ASSET_TYPE_LABELS } from '../filter-defs';
import type { NewAssetFormFields, NewAssetFormReturn } from './useNewAssetForm';

const ASSET_TYPE_OPTIONS: ComboboxOption[] = Object.entries(ASSET_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
);

export interface NewAssetFieldsLabels {
    name: string;
    type: string;
    owner: string;
    location: string;
}

export function NewAssetFields({
    form,
    labels,
    tenantSlug,
}: {
    form: NewAssetFormReturn;
    labels: NewAssetFieldsLabels;
    tenantSlug: string;
}) {
    const numeric = (value: string): number | undefined =>
        value.trim() === '' ? undefined : Number(value);

    return (
        <>
            <FormField label={labels.name} required>
                <Input
                    id="asset-name-input"
                    value={form.fields.name}
                    onChange={(e) => form.setField('name', e.target.value)}
                    placeholder="e.g. John Deere 6155R"
                    required
                />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label={labels.type}>
                    <Combobox
                        id="asset-type-select"
                        name="type"
                        options={ASSET_TYPE_OPTIONS}
                        selected={
                            ASSET_TYPE_OPTIONS.find(
                                (o) => o.value === form.fields.type,
                            ) ?? null
                        }
                        setSelected={(o) =>
                            form.setField(
                                'type',
                                (o?.value ?? 'TRACTOR') as NewAssetFormFields['type'],
                            )
                        }
                        placeholder="Select type…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
                <FormField label="Criticality">
                    <Combobox
                        id="asset-criticality-select"
                        name="criticality"
                        options={ASSET_CRITICALITY_OPTIONS}
                        selected={
                            ASSET_CRITICALITY_OPTIONS.find(
                                (o) => o.value === form.fields.criticality,
                            ) ?? null
                        }
                        setSelected={(o) =>
                            form.setField(
                                'criticality',
                                (o?.value as NewAssetFormFields['criticality']) ??
                                    undefined,
                            )
                        }
                        placeholder="Select criticality…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label="Manufacturer">
                    <Input
                        id="asset-manufacturer-input"
                        value={form.fields.manufacturer}
                        onChange={(e) =>
                            form.setField('manufacturer', e.target.value)
                        }
                        placeholder="e.g. John Deere"
                    />
                </FormField>
                <FormField label="Model">
                    <Input
                        id="asset-model-input"
                        value={form.fields.model}
                        onChange={(e) => form.setField('model', e.target.value)}
                        placeholder="e.g. 6155R"
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label="Serial number">
                    <Input
                        id="asset-serial-input"
                        value={form.fields.serialNumber}
                        onChange={(e) =>
                            form.setField('serialNumber', e.target.value)
                        }
                    />
                </FormField>
                <FormField label="Year">
                    <Input
                        id="asset-year-input"
                        inputMode="numeric"
                        value={form.fields.year ?? ''}
                        onChange={(e) =>
                            form.setField('year', numeric(e.target.value))
                        }
                        placeholder="e.g. 2021"
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label={labels.owner}>
                    <UserCombobox
                        id="asset-owner-input"
                        tenantSlug={tenantSlug}
                        selectedId={form.fields.ownerUserId || null}
                        onChange={(userId) =>
                            form.setField('ownerUserId', userId ?? '')
                        }
                        forceDropdown
                        matchTriggerWidth
                        placeholder="Unassigned"
                    />
                </FormField>
                <FormField label={labels.location}>
                    <Input
                        id="asset-location-input"
                        value={form.fields.location}
                        onChange={(e) =>
                            form.setField('location', e.target.value)
                        }
                        placeholder="e.g. North machine shed"
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
                <FormField label="Status">
                    <Combobox
                        id="asset-status-select"
                        name="status"
                        options={ASSET_STATUS_OPTIONS}
                        selected={
                            ASSET_STATUS_OPTIONS.find(
                                (o) => o.value === form.fields.status,
                            ) ?? null
                        }
                        setSelected={(o) =>
                            form.setField(
                                'status',
                                (o?.value ?? 'ACTIVE') as NewAssetFormFields['status'],
                            )
                        }
                        placeholder="Select status…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
                <FormField label="Purchase date">
                    <DatePicker
                        id="asset-purchase-date-input"
                        placeholder="Select date"
                        clearable
                        align="start"
                        value={parseYMD(form.fields.purchaseDate)}
                        onChange={(next) =>
                            form.setField('purchaseDate', toYMD(next) ?? '')
                        }
                    />
                </FormField>
            </div>

            <FormField label="Purchase cost">
                <Input
                    id="asset-purchase-cost-input"
                    inputMode="decimal"
                    value={form.fields.purchaseCost ?? ''}
                    onChange={(e) =>
                        form.setField('purchaseCost', numeric(e.target.value))
                    }
                    placeholder="e.g. 145000"
                />
            </FormField>
        </>
    );
}
