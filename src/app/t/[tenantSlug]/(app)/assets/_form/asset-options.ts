import type { ComboboxOption } from '@/components/ui/combobox';

/**
 * Shared dropdown option sets for the asset create + edit forms
 * (agricultural assets — machines, buildings, equipment).
 *
 * `criticality` (LOW/MEDIUM/HIGH) and `status` are stored on the Asset
 * directly; the options constrain the UI to the canonical enum values.
 */
export const ASSET_CRITICALITY_OPTIONS: ComboboxOption[] = [
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
];

export const ASSET_STATUS_OPTIONS: ComboboxOption[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'IN_MAINTENANCE', label: 'In maintenance' },
    { value: 'RETIRED', label: 'Retired' },
];
