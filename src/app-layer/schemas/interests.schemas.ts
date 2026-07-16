/**
 * Zod schema for the self-service interests API (PUT-replace).
 *
 * @module app-layer/schemas/interests.schemas
 */
import { z } from 'zod';

/**
 * Body for PUT /api/t/[tenantSlug]/me/interests. A bounded array of raw
 * keyword strings — the usecase (`normalizeInterests`) trims / lowercases /
 * dedupes / caps to the real limits, so this outer bound is just an abuse
 * guard, deliberately looser than the stored cap.
 */
export const InterestsPutSchema = z.object({
    keywords: z.array(z.string().max(200)).max(100),
});
export type InterestsPut = z.infer<typeof InterestsPutSchema>;
