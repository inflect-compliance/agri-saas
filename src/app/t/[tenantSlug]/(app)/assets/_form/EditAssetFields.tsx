'use client';

/**
 * Controlled field markup for the asset-edit form (agricultural assets
 * — machines, buildings, equipment).
 *
 * The detail page renders this inline; the P2 `<EditAssetModal>` renders
 * it inside Modal.Body. State + submit live in `useEditAssetForm`.
 */
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { UserCombobox } from '@/components/ui/user-combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { ASSET_CRITICALITY_OPTIONS, ASSET_STATUS_OPTIONS } from './asset-options';
import { ASSET_TYPE_LABELS } from '../filter-defs';
import type { EditAssetFormReturn } from './useEditAssetForm';

const TYPE_OPTIONS: ComboboxOption[] = Object.entries(ASSET_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
);

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
                        form.setField('type', opt?.value ?? 'TRACTOR')
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
                        ASSET_STATUS_OPTIONS.find(
                            (o) => o.value === form.fields.status,
                        ) ?? null
                    }
                    setSelected={(opt) =>
                        form.setField('status', opt?.value ?? 'ACTIVE')
                    }
                    options={ASSET_STATUS_OPTIONS}
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
            <div>
                <label className="input-label">Criticality</label>
                <Combobox
                    hideSearch
                    selected={
                        ASSET_CRITICALITY_OPTIONS.find(
                            (o) => o.value === form.fields.criticality,
                        ) ?? null
                    }
                    setSelected={(opt) =>
                        form.setField('criticality', opt?.value ?? '')
                    }
                    options={ASSET_CRITICALITY_OPTIONS}
                    placeholder="Select criticality…"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-full' }}
                    caret
                />
            </div>
            <div>
                <label className="input-label">Manufacturer</label>
                <input
                    className="input"
                    value={form.fields.manufacturer}
                    onChange={(e) => form.setField('manufacturer', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Model</label>
                <input
                    className="input"
                    value={form.fields.model}
                    onChange={(e) => form.setField('model', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Serial number</label>
                <input
                    className="input"
                    value={form.fields.serialNumber}
                    onChange={(e) => form.setField('serialNumber', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Year</label>
                <input
                    className="input"
                    inputMode="numeric"
                    value={form.fields.year}
                    onChange={(e) => form.setField('year', e.target.value)}
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
                <label className="input-label">Location</label>
                <input
                    className="input"
                    value={form.fields.location}
                    onChange={(e) => form.setField('location', e.target.value)}
                />
            </div>
            <div>
                <label className="input-label">Purchase date</label>
                <DatePicker
                    id="asset-edit-purchase-date"
                    placeholder="Select date"
                    clearable
                    align="start"
                    value={parseYMD(form.fields.purchaseDate)}
                    onChange={(next) =>
                        form.setField('purchaseDate', toYMD(next) ?? '')
                    }
                />
            </div>
            <div>
                <label className="input-label">Purchase cost</label>
                <input
                    className="input"
                    inputMode="decimal"
                    value={form.fields.purchaseCost}
                    onChange={(e) => form.setField('purchaseCost', e.target.value)}
                />
            </div>
        </div>
        </>
    );
}
