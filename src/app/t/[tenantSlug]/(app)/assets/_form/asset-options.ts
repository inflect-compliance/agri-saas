import type { ComboboxOption } from '@/components/ui/combobox';

/**
 * Shared dropdown option sets for the asset create + edit forms.
 *
 * Classification uses the standard four-tier data-classification scheme;
 * data residency is a fixed jurisdiction set. Both are stored as plain
 * strings on the Asset (`classification` / `dataResidency`) — the options
 * just constrain the UI to the canonical values.
 */
export const ASSET_CLASSIFICATION_OPTIONS: ComboboxOption[] = [
    { value: 'Public', label: 'Public' },
    { value: 'Internal', label: 'Internal' },
    { value: 'Confidential', label: 'Confidential' },
    { value: 'Restricted', label: 'Restricted' },
];

export const ASSET_DATA_RESIDENCY_OPTIONS: ComboboxOption[] = [
    { value: 'EU', label: 'EU' },
    { value: 'UK', label: 'UK' },
    { value: 'US', label: 'US' },
    { value: 'Other', label: 'Other' },
];

export const ASSET_STATUS_OPTIONS: ComboboxOption[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'RETIRED', label: 'Retired' },
];
