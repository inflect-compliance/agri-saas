import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { updateRiskFair } from '@/app-layer/usecases/risk';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-1 — FAIR quantification inputs. All optional + nullable (additive). */
const num = z.number().finite().nullable().optional();
/** RQ3-2 — a calibrated min/likely/max range. Ordering is NOT a hard
 *  gate (the UI validator is warn-only by contract); the usecase
 *  canonicalises by sorting before persisting. */
const triple = z
    .object({ min: z.number().finite(), mode: z.number().finite(), max: z.number().finite() })
    .nullable()
    .optional();
const FairInputSchema = z.object({
    threatEventFrequency: num,
    contactFrequency: num,
    probabilityOfAction: num,
    vulnerabilityProbability: num,
    threatCapability: num,
    controlStrength: num,
    primaryLossMagnitude: num,
    productivityLoss: num,
    responseCost: num,
    replacementCost: num,
    secondaryLossEventFrequency: num,
    secondaryLossMagnitude: num,
    regulatoryFineEstimate: num,
    reputationDamageEstimate: num,
    competitiveAdvantageLoss: num,
    fairConfidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
    fairInputsJson: z.record(z.string(), z.unknown()).nullable().optional(),
    /** RQ3-2 — the five calibrated ranges (range-first path). */
    distributions: z
        .object({ tef: triple, vulnerability: triple, plm: triple, slef: triple, slm: triple })
        .nullable()
        .optional(),
});

/** PUT — update a risk's FAIR inputs; server recomputes LEF + fairAle. */
export const PUT = withApiErrorHandling(
    withValidatedBody(
        FairInputSchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const risk = await updateRiskFair(ctx, params.id, body);
            return jsonResponse({ success: true, risk });
        },
    ),
);
