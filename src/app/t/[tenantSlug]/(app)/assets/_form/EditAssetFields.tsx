'use client';

/**
 * Controlled field markup for the asset-edit form.
 *
 * Composes the same six fields the legacy inline-edit panel exposed.
 * The detail page renders this inline (existing behaviour); the P2
 * `<EditAssetModal>` renders it inside Modal.Body. State + submit
 * live in `useEditAssetForm`.
 */
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { UserCombobox } from '@/components/ui/user-combobox';
import { AssetCriticalityFields } from './AssetCriticalityFields';
import {
    ASSET_CLASSIFICATION_OPTIONS,
    ASSET_DATA_RESIDENCY_OPTIONS,
} from './asset-options';
import type { EditAssetFormReturn } from './useEditAssetForm';

const TYPES = [
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
const TYPE_OPTIONS: ComboboxOption[] = TYPES.map((t) => ({
    value: t,
    label: t.replace(/_/g, ' '),
}));
const STATUS_OPTIONS: ComboboxOption[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'RETIRED', label: 'Retired' },
];

export function EditAssetFields({
    form,
    tenantSlug,
}: {
    form: EditAssetFormReturn;
    tenantSlug: string;
}) {
    return (
        <>
        <div className="grid grid-cols-2 gap-default">
            <div>
                <label className="input-label">Name *</label>
                <input
                    className="input"
                    value={form.fields.name}
                    onChange={(e) => form.setField('name', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Type</label>
                <Combobox
                    hideSearch
                    selected={
                        TYPE_OPTIONS.find((o) => o.value === form.fields.type) ??
                        null
                    }
                    setSelected={(opt) =>
                        form.setField('type', opt?.value ?? 'SYSTEM')
                    }
                    options={TYPE_OPTIONS}
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
            <div>
                <label className="input-label">Status</label>
                <Combobox
                    hideSearch
                    selected={
                        STATUS_OPTIONS.find(
                            (o) => o.value === form.fields.status,
                        ) ?? null
                    }
                    setSelected={(opt) =>
                        form.setField('status', opt?.value ?? 'ACTIVE')
                    }
                    options={STATUS_OPTIONS}
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
            <div>
                <label className="input-label">Owner</label>
                <UserCombobox
                    tenantSlug={tenantSlug}
                    selectedId={form.fields.ownerUserId || null}
                    onChange={(userId) =>
                        form.setField('ownerUserId', userId ?? '')
                    }
                    forceDropdown
                    matchTriggerWidth
                    id="asset-assignee"
                    placeholder="Unassigned"
                />
            </div>
            <div>
                <label className="input-label">Classification</label>
                <Combobox
                    hideSearch
                    selected={
                        ASSET_CLASSIFICATION_OPTIONS.find(
                            (o) => o.value === form.fields.classification,
                        ) ?? null
                    }
                    setSelected={(opt) =>
                        form.setField('classification', opt?.value ?? '')
                    }
                    options={ASSET_CLASSIFICATION_OPTIONS}
                    placeholder="Select classification…"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
            <div>
                <label className="input-label">Location</label>
                <input
                    className="input"
                    value={form.fields.location}
                    onChange={(e) => form.setField('location', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Data Residency</label>
                <Combobox
                    hideSearch
                    selected={
                        ASSET_DATA_RESIDENCY_OPTIONS.find(
                            (o) => o.value === form.fields.dataResidency,
                        ) ?? null
                    }
                    setSelected={(opt) =>
                        form.setField('dataResidency', opt?.value ?? '')
                    }
                    options={ASSET_DATA_RESIDENCY_OPTIONS}
                    placeholder="Select residency…"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
        </div>
        <AssetCriticalityFields
            idPrefix="asset-edit"
            confidentiality={form.fields.confidentiality}
            integrity={form.fields.integrity}
            availability={form.fields.availability}
            onChange={(key, value) => form.setField(key, value)}
        />
        </>
    );
}
