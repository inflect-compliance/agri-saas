import { z } from 'zod';

/**
 * "Ask for offer" insurance lead from the per-parcel Risk page (#13). Captures
 * the parcel context + an optional snapshot of the satellite risk at request
 * time. Lead-gen only.
 */
export const CreateInsuranceLeadSchema = z
    .object({
        parcelId: z.string().min(1),
        locationId: z.string().min(1).nullable().optional(),
        message: z.string().min(1).max(2000),
        // Free-form snapshot (overall level + ndvi/ndmi) for the sales record.
        risk: z
            .object({
                overall: z.string().max(20).optional(),
                ndvi: z.number().nullable().optional(),
                ndmi: z.number().nullable().optional(),
            })
            .strip()
            .nullable()
            .optional(),
    })
    .strip();
export type CreateInsuranceLeadBody = z.infer<typeof CreateInsuranceLeadSchema>;
