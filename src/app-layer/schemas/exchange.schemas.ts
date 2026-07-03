import { z } from 'zod';
import { ExchangeSide } from '@prisma/client';

/**
 * Zod schemas for the Exchange write API. The usecase layer sanitizes all
 * free text (sanitizePlainText / sanitizeOptional) and derives
 * regionName/lat/lon from `regionCode` — these schemas only shape + bound
 * the input. Every schema `.strip()`s unknown keys (matches grain.schemas).
 */

// Decimal magnitudes arrive as number OR numeric string; the usecase passes
// them straight to Prisma's Decimal columns.
const Tonnes = z.union([z.number().finite().positive(), z.string().min(1)]);
const OptionalDecimal = z
    .union([z.number().finite().nonnegative(), z.string(), z.null()])
    .optional();

export const CreateListingSchema = z
    .object({
        side: z.nativeEnum(ExchangeSide),
        commodity: z.string().min(1).max(120),
        quantityTonnes: Tonnes,
        pricePerTonne: OptionalDecimal,
        priceCurrency: z.string().min(1).max(8).optional(),
        regionCode: z.string().min(1).max(16),
        description: z.union([z.string().max(2000), z.null()]).optional(),
        sellerDisplayName: z.union([z.string().max(120), z.null()]).optional(),
        expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    })
    .strip();
export type CreateListingBody = z.infer<typeof CreateListingSchema>;

export const CreateInquirySchema = z
    .object({
        listingId: z.string().min(1),
        message: z.string().min(1).max(2000),
        quantityTonnes: z
            .union([z.number().finite().positive(), z.string(), z.null()])
            .optional(),
    })
    .strip();
export type CreateInquiryBody = z.infer<typeof CreateInquirySchema>;

/** Seller responds to an inquiry. */
export const RespondToInquirySchema = z
    .object({ action: z.enum(['ACCEPTED', 'DECLINED']) })
    .strip();
export type RespondToInquiryBody = z.infer<typeof RespondToInquirySchema>;

/** Seller flips their own listing's lifecycle status. */
export const UpdateListingStatusSchema = z
    .object({ action: z.enum(['WITHDRAWN', 'FULFILLED']) })
    .strip();
export type UpdateListingStatusBody = z.infer<typeof UpdateListingStatusSchema>;
