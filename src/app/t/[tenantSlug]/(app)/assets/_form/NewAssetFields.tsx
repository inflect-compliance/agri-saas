'use client';

/**
 * Controlled field markup for the asset-create form. Same shape as
 * the legacy inline form on AssetsClient that this modal replaces.
 */
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { UserCombobox } from '@/components/ui/user-combobox';
import { AssetCriticalityFields } from './AssetCriticalityFields';
import {
    ASSET_CLASSIFICATION_OPTIONS,
    ASSET_DATA_RESIDENCY_OPTIONS,
    ASSET_STATUS_OPTIONS,
} from './asset-options';
import type { NewAssetFormFields, NewAssetFormReturn } from './useNewAssetForm';

const ASSET_TYPES = [
    'INFORMATION',
    'APPLICATION',
    'SYSTEM',
    'SERVICE',
    'DATA_STORE',
    'INFRASTRUCTURE',
    'VENDOR',
    'PROCESS',
    'PEOPLE_PROCESS',
    'OTHER',
];
const ASSET_TYPE_OPTIONS: ComboboxOption[] = ASSET_TYPES.map((t) => ({
    value: t,
    label: t.replace(/_/g, ' '),
}));

export interface NewAssetFieldsLabels {
    name: string;
    type: string;
    classification: string;
    classificationPlaceholder: string;
    owner: string;
    location: string;
    dataResidency: string;
    residencyPlaceholder: string;
    confidentiality: string;
    integrity: string;
    availability: string;
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
    return (
        <>
            <FormField label={labels.name} required>
                <Input
                    id="asset-name-input"
                    value={form.fields.name}
                    onChange={(e) => form.setField('name', e.target.value)}
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
                                (o?.value ?? 'SYSTEM') as NewAssetFormFields['type'],
                            )
                        }
                        placeholder="Select type…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
                <FormField label={labels.classification}>
                    <Combobox
                        id="asset-classification-input"
                        name="classification"
                        options={ASSET_CLASSIFICATION_OPTIONS}
                        selected={
                            ASSET_CLASSIFICATION_OPTIONS.find(
                                (o) => o.value === form.fields.classification,
                            ) ?? null
                        }
                        setSelected={(o) =>
                            form.setField('classification', o?.value ?? '')
                        }
                        placeholder="Select classification…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
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
                <FormField label={labels.dataResidency}>
                    <Combobox
                        id="asset-data-residency-input"
                        name="dataResidency"
                        options={ASSET_DATA_RESIDENCY_OPTIONS}
                        selected={
                            ASSET_DATA_RESIDENCY_OPTIONS.find(
                                (o) => o.value === form.fields.dataResidency,
                            ) ?? null
                        }
                        setSelected={(o) =>
                            form.setField('dataResidency', o?.value ?? '')
                        }
                        placeholder="Select residency…"
                        hideSearch
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full' }}
                        caret
                    />
                </FormField>
            </div>

            {/* CIA triad → asset criticality (sliders + high-water-mark
                score). min/max=1..5 matches the ISO 27005 impact scale. */}
            <AssetCriticalityFields
                confidentiality={form.fields.confidentiality}
                integrity={form.fields.integrity}
                availability={form.fields.availability}
                onChange={(key, value) => form.setField(key, value)}
            />
        </>
    );
}
