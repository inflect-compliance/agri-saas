import { z } from 'zod';

/**
 * "Ask for offer" lead — a user expresses interest in a company promotion.
 * Mirrors the Exchange inquiry contract: a required free-text message plus an
 * optional parcel/context reference. Lead-gen only; no quantity/payment.
 */
export const CreatePromotionLeadSchema = z
    .object({
        promotionId: z.string().min(1),
        message: z.string().min(1).max(2000),
        contextParcelId: z.string().min(1).nullable().optional(),
    })
    .strip();
export type CreatePromotionLeadBody = z.infer<typeof CreatePromotionLeadSchema>;
