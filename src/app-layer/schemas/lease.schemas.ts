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

/**
 * Tenant-wide create payload for the Rent page — a lease is parcel-bound, so the
 * parcel is chosen in the modal (a Combobox) and travels in the body rather than
 * the URL path (the parcel-scoped route carries it as a path param instead).
 */
export const TenantLeaseCreateSchema = ParcelLeaseSchema.extend({
    parcelId: z.string().min(1).max(60),
});

export type TenantLeaseCreateBody = z.infer<typeof TenantLeaseCreateSchema>;

/**
 * Rent PAID against a lease for one season. The unit is optional and defaults
 * to the lease's own canonical rent unit — rent settled in grain („кг/дка")
 * must never be booked against a money obligation.
 */
export const LeasePaymentSchema = z.object({
    seasonYear: z.number().int().min(1900).max(2200),
    amountPaid: z.number().nonnegative().max(1_000_000_000),
    unit: z.string().max(20).nullable().optional(),
    paidAt: z.string().max(40).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
});

export type LeasePaymentBody = z.infer<typeof LeasePaymentSchema>;
