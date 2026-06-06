/**
 * B6 — frontend-safe Zod schema for the new-asset modal form.
 *
 * Mirrors `<NewAssetFields>`:
 *   - name — required.
 *   - type — one of the AssetType values.
 *   - classification — optional (standard four-tier dropdown).
 *   - ownerUserId — optional tenant-member reference (people picker).
 *   - location — optional free text.
 *   - dataResidency — optional (EU/UK/US/Other dropdown).
 *   - confidentiality / integrity / availability — 1..5 ISO 27005 scale.
 */
import { z } from 'zod';

const cia = z
    .number()
    .int('Must be a whole number')
    .min(1, 'Must be 1 or higher')
    .max(5, 'Must be 5 or lower');

export const ASSET_TYPE_VALUES = [
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
] as const;

export const NewAssetFormSchema = z.object({
    name: z.string().trim().min(1, 'Asset name is required').max(255),
    type: z.enum(ASSET_TYPE_VALUES),
    status: z.enum(['ACTIVE', 'RETIRED']).default('ACTIVE'),
    classification: z.string().trim().max(255).default(''),
    ownerUserId: z.string().trim().max(255).default(''),
    location: z.string().trim().max(255).default(''),
    dataResidency: z.string().trim().max(255).default(''),
    confidentiality: cia,
    integrity: cia,
    availability: cia,
});

export type NewAssetFormValues = z.input<typeof NewAssetFormSchema>;
