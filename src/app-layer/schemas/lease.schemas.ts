import { z } from 'zod';

/**
 * Parcel-lease (аренда/наем) create/update payload. Dates are accepted as loose
 * strings (date-only or ISO) and parsed server-side; the usecase sanitises every
 * free-text field.
 */
export const ParcelLeaseSchema = z.object({
    lessorName: z.string().min(1).max(200),
    lessorEik: z.string().max(20).nullable().optional(),
    kind: z.enum(['ARENDA', 'NAEM']),
    rentAmount: z.number().nonnegative().max(1_000_000_000).nullable().optional(),
    rentUnit: z.string().max(20).nullable().optional(),
    startDate: z.string().max(40).nullable().optional(),
    endDate: z.string().max(40).nullable().optional(),
    documentRef: z.string().max(120).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
});

export type ParcelLeaseBody = z.infer<typeof ParcelLeaseSchema>;
