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
        /**
         * Explicit consent to share the request with the supplier.
         *
         * `z.literal(true)` rather than `z.boolean()` on purpose: the only
         * acceptable value is an affirmative one, so an omitted or `false`
         * consent is a SCHEMA error (400) at the edge rather than something
         * the usecase has to remember to check. Absent consent is not a
         * variation of the request — it is not a request we may act on.
         */
        consent: z.literal(true),
    })
    .strip();
export type CreatePromotionLeadBody = z.infer<typeof CreatePromotionLeadSchema>;
