import { Prisma } from '@prisma/client';
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { createTask, addTaskLink } from './task';
import { notFound, badRequest } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { cachedListRead, bumpEntityCacheVersion } from '@/lib/cache/list-cache';
import {
    generateSuccessions,
    mergeTiming,
    mergeSpacing,
    type CropTiming,
    type CropSpacing,
    type SuccessionConfig,
    type AllocationConfig,
    type ComputedPlanting,
    type PlantingMethod,
} from '@/lib/planning/succession';

/**
 * Crop-planning usecases — the INTEGRATION layer over the pure
 * succession engine (`src/lib/planning/succession.ts`).
 *
 * Shape mirrors every other usecase in the codebase:
 *   - authorize via assertCanRead/Write BEFORE data access,
 *   - sanitize user free text at the boundary (name / notes →
 *     sanitizePlainText),
 *   - emit a hash-chained audit event on EVERY mutation
 *     (entity_lifecycle detailsJson),
 *   - all DB access through runInTenantContext (RLS-bound transaction)
 *     — every read is tenant-scoped and bounded with `take:`.
 *
 * The succession MATH is not here. `generatePlantings` maps the
 * CropPlan + CropVariety rows onto the engine's plain inputs, runs
 * `generateSuccessions`, persists the `ComputedPlanting[]` as Planting
 * rows, and fans out auto-generated field Tasks (sow / transplant /
 * harvest) linked back to each Planting.
 */

// ─── List bound ──────────────────────────────────────────────────────
//
// A single cap for the catalog + plan list reads. Kept well below the
// repository backfill cap; pages that need true pagination can add a
// cursor path later. Bounded so the query-shape guardrail (D2) is
// satisfied without `// guardrail-allow`.
const LIST_TAKE = 500;

// ─── Decimal helpers (Prisma Decimal ↔ engine number) ────────────────
//
// CropVariety carries spacing/seed parameters as Prisma Decimal; the
// engine speaks plain `number`. Convert on the way in. Decimal | null
// | undefined → number | null.
function dec(v: Prisma.Decimal | null | undefined): number | null {
    if (v == null) return null;
    return typeof v === 'number' ? v : Number(v.toString());
}

// ═════════════════════════════════════════════════════════════════════
//  Season
// ═════════════════════════════════════════════════════════════════════

export interface CreateSeasonInput {
    name: string;
    year?: number | null;
    startDate: string;
    endDate: string;
    status?: 'PLANNING' | 'ACTIVE' | 'CLOSED';
    notes?: string | null;
}

export interface UpdateSeasonInput {
    name?: string;
    year?: number | null;
    startDate?: string;
    endDate?: string;
    status?: 'PLANNING' | 'ACTIVE' | 'CLOSED';
    notes?: string | null;
}

export async function listSeasons(ctx: RequestContext, opts: { take?: number } = {}) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        db.season.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null },
            orderBy: [{ startDate: 'desc' }],
            take: opts.take ?? LIST_TAKE,
        }),
    );
}

export async function getSeason(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const season = await db.season.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            include: { _count: { select: { cropPlans: true } } },
        });
        if (!season) throw notFound('Season not found');
        return season;
    });
}

export async function createSeason(ctx: RequestContext, input: CreateSeasonInput) {
    assertCanWrite(ctx);
    const name = sanitizePlainText(input.name);
    if (!name) throw badRequest('Season name is required');
    const notes = input.notes != null ? sanitizePlainText(input.notes) : null;

    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw badRequest('Season start and end must be valid dates');
    }
    if (end < start) throw badRequest('Season end date must be on or after the start date');

    return runInTenantContext(ctx, async (db) => {
        const season = await db.season.create({
            data: {
                tenantId: ctx.tenantId,
                name,
                year: input.year ?? null,
                startDate: start,
                endDate: end,
                status: input.status ?? 'PLANNING',
                notes,
            },
        });
        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'Season',
            entityId: season.id,
            details: `Created season: ${season.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Season',
                operation: 'created',
                after: { name: season.name, status: season.status },
                summary: `Created season: ${season.name}`,
            },
        });
        return season;
    });
}

export async function updateSeason(ctx: RequestContext, id: string, input: UpdateSeasonInput) {
    assertCanWrite(ctx);
    const data: Prisma.SeasonUncheckedUpdateInput = {};
    if (input.name !== undefined) {
        const name = sanitizePlainText(input.name);
        if (!name) throw badRequest('Season name is required');
        data.name = name;
    }
    if (input.year !== undefined) data.year = input.year;
    if (input.startDate !== undefined) data.startDate = new Date(input.startDate);
    if (input.endDate !== undefined) data.endDate = new Date(input.endDate);
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes != null ? sanitizePlainText(input.notes) : null;

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.season.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!existing) throw notFound('Season not found');

        const season = await db.season.update({ where: { id }, data });
        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'Season',
            entityId: id,
            details: 'Season updated',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Season',
                operation: 'updated',
                changedFields: Object.keys(input).filter(
                    (k) => (input as Record<string, unknown>)[k] !== undefined,
                ),
                after: { name: season.name, status: season.status },
                summary: 'Season updated',
            },
        });
        return season;
    });
}

// ═════════════════════════════════════════════════════════════════════
//  CropType + CropVariety (catalog)
// ═════════════════════════════════════════════════════════════════════

export async function listCropTypes(ctx: RequestContext, opts: { take?: number } = {}) {
    assertCanRead(ctx);
    // Crop types are a slow-changing catalog — cache for a day. Writes
    // (`createCropType`) bump the per-tenant version to invalidate.
    return cachedListRead({
        ctx,
        entity: 'crop-type',
        operation: 'list',
        params: { take: opts.take ?? null },
        ttlSeconds: 86400,
        loader: () =>
            runInTenantContext(ctx, (db) =>
                db.cropType.findMany({
                    where: { tenantId: ctx.tenantId, deletedAt: null },
                    orderBy: [{ name: 'asc' }],
                    include: { _count: { select: { varieties: true } } },
                    take: opts.take ?? LIST_TAKE,
                }),
            ),
    });
}

export interface CreateCropTypeInput {
    name: string;
    key?: string | null;
    family?: string | null;
    category?: string | null;
    notes?: string | null;
}

export async function createCropType(ctx: RequestContext, input: CreateCropTypeInput) {
    assertCanWrite(ctx);
    const name = sanitizePlainText(input.name);
    if (!name) throw badRequest('Crop type name is required');

    const created = await runInTenantContext(ctx, async (db) => {
        const cropType = await db.cropType.create({
            data: {
                tenantId: ctx.tenantId,
                name,
                key: input.key ?? null,
                family: input.family != null ? sanitizePlainText(input.family) : null,
                category: input.category != null ? sanitizePlainText(input.category) : null,
                notes: input.notes != null ? sanitizePlainText(input.notes) : null,
            },
        });
        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'CropType',
            entityId: cropType.id,
            details: `Created crop type: ${cropType.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'CropType',
                operation: 'created',
                after: { name: cropType.name },
                summary: `Created crop type: ${cropType.name}`,
            },
        });
        return cropType;
    });
    await bumpEntityCacheVersion(ctx, 'crop-type');
    return created;
}

export async function listCropVarieties(
    ctx: RequestContext,
    filters: { cropTypeId?: string } = {},
    opts: { take?: number } = {},
) {
    assertCanRead(ctx);
    // Crop varieties are a slow-changing catalog — cache for a day.
    // Writes (`createCropVariety`) bump the per-tenant version.
    return cachedListRead({
        ctx,
        entity: 'crop-variety',
        operation: 'list',
        params: { cropTypeId: filters.cropTypeId ?? null, take: opts.take ?? null },
        ttlSeconds: 86400,
        loader: () =>
            runInTenantContext(ctx, (db) =>
                db.cropVariety.findMany({
                    where: {
                        tenantId: ctx.tenantId,
                        deletedAt: null,
                        ...(filters.cropTypeId ? { cropTypeId: filters.cropTypeId } : {}),
                    },
                    orderBy: [{ name: 'asc' }],
                    include: { cropType: { select: { id: true, name: true } } },
                    take: opts.take ?? LIST_TAKE,
                }),
            ),
    });
}

export interface CreateCropVarietyInput {
    cropTypeId: string;
    name: string;
    key?: string | null;
    defaultMethod?: PlantingMethod | null;
    daysToGermination?: number | null;
    daysToTransplant?: number | null;
    daysToMaturity?: number | null;
    harvestWindowDays?: number | null;
    inRowSpacingCm?: number | null;
    betweenRowSpacingCm?: number | null;
    seedsPerGram?: number | null;
    germinationRate?: number | null;
    seedsPerCell?: number | null;
    sourceUrn?: string | null;
    notes?: string | null;
}

export async function createCropVariety(ctx: RequestContext, input: CreateCropVarietyInput) {
    assertCanWrite(ctx);
    const name = sanitizePlainText(input.name);
    if (!name) throw badRequest('Variety name is required');

    const created = await runInTenantContext(ctx, async (db) => {
        // Tenant-scope the parent crop type via the RLS-bound session.
        const cropType = await db.cropType.findFirst({
            where: { id: input.cropTypeId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!cropType) throw badRequest('INVALID_CROP_TYPE', 'Crop type not found or belongs to a different tenant');

        const variety = await db.cropVariety.create({
            data: {
                tenantId: ctx.tenantId,
                cropTypeId: input.cropTypeId,
                name,
                key: input.key ?? null,
                defaultMethod: input.defaultMethod ?? null,
                daysToGermination: input.daysToGermination ?? null,
                daysToTransplant: input.daysToTransplant ?? null,
                daysToMaturity: input.daysToMaturity ?? null,
                harvestWindowDays: input.harvestWindowDays ?? null,
                inRowSpacingCm: input.inRowSpacingCm ?? null,
                betweenRowSpacingCm: input.betweenRowSpacingCm ?? null,
                seedsPerGram: input.seedsPerGram ?? null,
                germinationRate: input.germinationRate ?? null,
                seedsPerCell: input.seedsPerCell ?? null,
                sourceUrn: input.sourceUrn ?? null,
                notes: input.notes != null ? sanitizePlainText(input.notes) : null,
            },
        });
        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'CropVariety',
            entityId: variety.id,
            details: `Created crop variety: ${variety.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'CropVariety',
                operation: 'created',
                after: { name: variety.name, cropTypeId: variety.cropTypeId },
                summary: `Created crop variety: ${variety.name}`,
            },
        });
        return variety;
    });
    await bumpEntityCacheVersion(ctx, 'crop-variety');
    return created;
}

// ═════════════════════════════════════════════════════════════════════
//  CropPlan
// ═════════════════════════════════════════════════════════════════════

const CROP_PLAN_INCLUDE = {
    season: { select: { id: true, name: true, status: true } },
    cropType: { select: { id: true, name: true } },
    variety: { select: { id: true, name: true, defaultMethod: true } },
    _count: { select: { plantings: true } },
} satisfies Prisma.CropPlanInclude;

export interface CreateCropPlanInput {
    seasonId: string;
    cropTypeId: string;
    cropVarietyId?: string | null;
    locationId?: string | null;
    name: string;
    method?: PlantingMethod;
    firstSowDate: string;
    successions?: number;
    intervalDays?: number;
    plantsPerSuccession?: number | null;
    bedLengthM?: number | null;
    rowsPerBed?: number | null;
    targetAreaM2?: number | null;
    status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    notes?: string | null;
}

export interface UpdateCropPlanInput {
    name?: string;
    cropVarietyId?: string | null;
    locationId?: string | null;
    method?: PlantingMethod;
    firstSowDate?: string;
    successions?: number;
    intervalDays?: number;
    plantsPerSuccession?: number | null;
    bedLengthM?: number | null;
    rowsPerBed?: number | null;
    targetAreaM2?: number | null;
    status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    notes?: string | null;
}

export async function listCropPlans(
    ctx: RequestContext,
    filters: { seasonId?: string; status?: string } = {},
    opts: { take?: number } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        db.cropPlan.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
                ...(filters.status ? { status: filters.status as Prisma.EnumCropPlanStatusFilter['equals'] } : {}),
            },
            orderBy: [{ createdAt: 'desc' }],
            include: CROP_PLAN_INCLUDE,
            take: opts.take ?? LIST_TAKE,
        }),
    );
}

export async function getCropPlan(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const plan = await db.cropPlan.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            include: CROP_PLAN_INCLUDE,
        });
        if (!plan) throw notFound('Crop plan not found');
        return plan;
    });
}

export async function createCropPlan(ctx: RequestContext, input: CreateCropPlanInput) {
    assertCanWrite(ctx);
    const name = sanitizePlainText(input.name);
    if (!name) throw badRequest('Crop plan name is required');
    const firstSow = new Date(input.firstSowDate);
    if (Number.isNaN(firstSow.getTime())) throw badRequest('First sow date must be a valid date');
    const notes = input.notes != null ? sanitizePlainText(input.notes) : null;

    return runInTenantContext(ctx, async (db) => {
        // Validate the season + crop type (+ optional variety/location)
        // belong to the tenant before writing the plan.
        const season = await db.season.findFirst({
            where: { id: input.seasonId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!season) throw badRequest('INVALID_SEASON', 'Season not found or belongs to a different tenant');
        const cropType = await db.cropType.findFirst({
            where: { id: input.cropTypeId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!cropType) throw badRequest('INVALID_CROP_TYPE', 'Crop type not found or belongs to a different tenant');
        if (input.cropVarietyId) {
            const variety = await db.cropVariety.findFirst({
                where: { id: input.cropVarietyId, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!variety) throw badRequest('INVALID_VARIETY', 'Variety not found or belongs to a different tenant');
        }

        const plan = await db.cropPlan.create({
            data: {
                tenantId: ctx.tenantId,
                seasonId: input.seasonId,
                cropTypeId: input.cropTypeId,
                cropVarietyId: input.cropVarietyId ?? null,
                locationId: input.locationId ?? null,
                name,
                method: input.method ?? 'DIRECT_SOW',
                firstSowDate: firstSow,
                successions: input.successions ?? 1,
                intervalDays: input.intervalDays ?? 0,
                plantsPerSuccession: input.plantsPerSuccession ?? null,
                bedLengthM: input.bedLengthM ?? null,
                rowsPerBed: input.rowsPerBed ?? null,
                targetAreaM2: input.targetAreaM2 ?? null,
                status: input.status ?? 'DRAFT',
                notes,
            },
            include: CROP_PLAN_INCLUDE,
        });
        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'CropPlan',
            entityId: plan.id,
            details: `Created crop plan: ${plan.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'CropPlan',
                operation: 'created',
                after: { name: plan.name, successions: plan.successions, status: plan.status },
                summary: `Created crop plan: ${plan.name}`,
            },
        });
        return plan;
    });
}

export async function updateCropPlan(ctx: RequestContext, id: string, input: UpdateCropPlanInput) {
    assertCanWrite(ctx);
    const data: Prisma.CropPlanUncheckedUpdateInput = {};
    if (input.name !== undefined) {
        const name = sanitizePlainText(input.name);
        if (!name) throw badRequest('Crop plan name is required');
        data.name = name;
    }
    if (input.cropVarietyId !== undefined) data.cropVarietyId = input.cropVarietyId;
    if (input.locationId !== undefined) data.locationId = input.locationId;
    if (input.method !== undefined) data.method = input.method;
    if (input.firstSowDate !== undefined) {
        const d = new Date(input.firstSowDate);
        if (Number.isNaN(d.getTime())) throw badRequest('First sow date must be a valid date');
        data.firstSowDate = d;
    }
    if (input.successions !== undefined) data.successions = input.successions;
    if (input.intervalDays !== undefined) data.intervalDays = input.intervalDays;
    if (input.plantsPerSuccession !== undefined) data.plantsPerSuccession = input.plantsPerSuccession;
    if (input.bedLengthM !== undefined) data.bedLengthM = input.bedLengthM;
    if (input.rowsPerBed !== undefined) data.rowsPerBed = input.rowsPerBed;
    if (input.targetAreaM2 !== undefined) data.targetAreaM2 = input.targetAreaM2;
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes != null ? sanitizePlainText(input.notes) : null;

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.cropPlan.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!existing) throw notFound('Crop plan not found');
        if (input.cropVarietyId) {
            const variety = await db.cropVariety.findFirst({
                where: { id: input.cropVarietyId, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!variety) throw badRequest('INVALID_VARIETY', 'Variety not found or belongs to a different tenant');
        }

        const plan = await db.cropPlan.update({ where: { id }, data, include: CROP_PLAN_INCLUDE });
        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'CropPlan',
            entityId: id,
            details: 'Crop plan updated',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'CropPlan',
                operation: 'updated',
                changedFields: Object.keys(input).filter(
                    (k) => (input as Record<string, unknown>)[k] !== undefined,
                ),
                after: { name: plan.name, status: plan.status },
                summary: 'Crop plan updated',
            },
        });
        return plan;
    });
}

// ═════════════════════════════════════════════════════════════════════
//  generatePlantings — the core integration (engine → plantings → tasks)
// ═════════════════════════════════════════════════════════════════════

/** A row of the plan the variety defaults are read off (engine inputs). */
interface VarietyDefaults {
    defaultMethod: PlantingMethod | null;
    daysToTransplant: number | null;
    daysToMaturity: number | null;
    harvestWindowDays: number | null;
    inRowSpacingCm: Prisma.Decimal | null;
    betweenRowSpacingCm: Prisma.Decimal | null;
    seedsPerGram: Prisma.Decimal | null;
    germinationRate: Prisma.Decimal | null;
    seedsPerCell: number | null;
}

/**
 * Build the engine's merged timing + spacing from the plan's variety.
 *
 * CropType carries NO agronomic numbers in the schema, so the crop-type
 * side of the merge is always null — timing/spacing come from the
 * VARIETY. We still route through `mergeTiming(null, …)` /
 * `mergeSpacing(null, …)` so the typed, fully-defaulted shape the engine
 * expects is produced in exactly one place. The plan's `method`
 * overrides the variety's `defaultMethod`.
 */
function buildEngineInputs(
    plan: { method: PlantingMethod },
    variety: VarietyDefaults | null,
): { timing: CropTiming; spacing: CropSpacing } {
    const varietyTiming: Partial<CropTiming> | null = variety
        ? {
              method: variety.defaultMethod ?? undefined,
              daysToTransplant: variety.daysToTransplant,
              daysToMaturity: variety.daysToMaturity ?? undefined,
              harvestWindowDays: variety.harvestWindowDays,
          }
        : null;
    const varietySpacing: Partial<CropSpacing> | null = variety
        ? {
              inRowSpacingCm: dec(variety.inRowSpacingCm),
              betweenRowSpacingCm: dec(variety.betweenRowSpacingCm),
              seedsPerGram: dec(variety.seedsPerGram),
              germinationRate: dec(variety.germinationRate),
              seedsPerCell: variety.seedsPerCell,
          }
        : null;

    // CropType has no timing/spacing of its own → null crop side.
    const merged = mergeTiming(null, varietyTiming);
    // The PLAN's method is authoritative — it overrides the variety's.
    merged.method = plan.method;
    const spacing = mergeSpacing(null, varietySpacing);
    return { timing: merged, spacing };
}

/** The stage→title verb for an auto-generated field task. */
const STAGE_VERB: Record<'SOW' | 'TRANSPLANT' | 'HARVEST', string> = {
    SOW: 'Sow',
    TRANSPLANT: 'Transplant',
    HARVEST: 'Harvest',
};

/**
 * Regenerate the Planting rows for a crop plan from the succession
 * engine, then fan out the auto-generated field tasks.
 *
 * Idempotent + safe-to-re-run:
 *   1. (tx) Load the plan + its variety defaults (RLS-bound).
 *   2.      Build engine inputs (mergeTiming/mergeSpacing) + run
 *           `generateSuccessions` → ComputedPlanting[].
 *   3. (tx) DELETE existing `PLANNED` plantings for the plan, then
 *           `createMany` the new ones — SOWN+ plantings are NEVER
 *           touched (a farmer who has already sown succession 1 keeps
 *           it; regenerating only replaces the not-yet-started rows).
 *   4.      AFTER the tx commits, loop the freshly-created plantings and
 *           create SOW / TRANSPLANT / HARVEST tasks via createTask +
 *           addTaskLink('PLANTING', …). createTask + addTaskLink each
 *           open their OWN tenant context (and createTask enqueues
 *           notifications), so they MUST run at the usecase level, not
 *           inside a raw db tx. The idempotency check is BATCHED (one
 *           taskLink query resolves whether a stage task already
 *           exists) — no read-in-loop.
 */
export async function generatePlantings(ctx: RequestContext, cropPlanId: string) {
    assertCanWrite(ctx);

    // ── Step 1 + 2 + 3: load, compute, persist plantings (one tx) ──
    const { plan, created } = await runInTenantContext(ctx, async (db) => {
        const plan = await db.cropPlan.findFirst({
            where: { id: cropPlanId, tenantId: ctx.tenantId, deletedAt: null },
            include: {
                cropType: { select: { id: true, name: true } },
                variety: {
                    select: {
                        id: true,
                        name: true,
                        defaultMethod: true,
                        daysToTransplant: true,
                        daysToMaturity: true,
                        harvestWindowDays: true,
                        inRowSpacingCm: true,
                        betweenRowSpacingCm: true,
                        seedsPerGram: true,
                        germinationRate: true,
                        seedsPerCell: true,
                    },
                },
            },
        });
        if (!plan) throw notFound('Crop plan not found');

        // A maturity figure is required for any meaningful schedule. It
        // lives on the variety; a plan with no variety (or a variety
        // with no daysToMaturity) cannot produce dated plantings.
        const maturity = plan.variety?.daysToMaturity ?? null;
        if (maturity == null || maturity <= 0) {
            throw badRequest(
                'CROP_PLAN_NOT_READY',
                'This plan needs a variety with daysToMaturity set before plantings can be generated.',
            );
        }

        const { timing, spacing } = buildEngineInputs(
            { method: plan.method },
            plan.variety as VarietyDefaults | null,
        );
        const config: SuccessionConfig = {
            firstSowDate: plan.firstSowDate,
            successions: plan.successions,
            intervalDays: plan.intervalDays,
        };
        const alloc: AllocationConfig = {
            plantsPerSuccession: plan.plantsPerSuccession,
            bedLengthM: dec(plan.bedLengthM),
            rowsPerBed: plan.rowsPerBed,
            areaM2: dec(plan.targetAreaM2),
        };

        const computed: ComputedPlanting[] = generateSuccessions(config, timing, alloc, spacing);

        // Idempotent regenerate: drop only the not-yet-started plantings.
        // SOWN/TRANSPLANTED/HARVESTING/HARVESTED/TERMINATED rows survive.
        await db.planting.deleteMany({
            where: { tenantId: ctx.tenantId, cropPlanId: plan.id, status: 'PLANNED' },
        });

        await db.planting.createMany({
            data: computed.map((c) => ({
                tenantId: ctx.tenantId,
                cropPlanId: plan.id,
                cropVarietyId: plan.cropVarietyId ?? null,
                locationId: plan.locationId ?? null,
                successionNumber: c.successionNumber,
                method: timing.method,
                sowDate: c.sowDate,
                transplantDate: c.transplantDate,
                harvestStartDate: c.harvestStartDate,
                harvestEndDate: c.harvestEndDate,
                seedQuantityGrams: c.seedQuantityGrams,
                plantCount: c.plantCount,
                areaM2: c.areaM2,
                status: 'PLANNED' as const,
            })),
        });

        // Re-read the rows we just created (need their ids for task links).
        // Bounded by the plan's succession count.
        const created = await db.planting.findMany({
            where: { tenantId: ctx.tenantId, cropPlanId: plan.id, status: 'PLANNED' },
            orderBy: [{ successionNumber: 'asc' }],
            take: LIST_TAKE,
        });

        await logEvent(db, ctx, {
            action: 'CROP_PLAN_PLANTINGS_GENERATED',
            entityType: 'CropPlan',
            entityId: plan.id,
            details: `Generated ${created.length} plantings`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'CropPlan',
                operation: 'updated',
                after: { plantingsGenerated: created.length, successions: plan.successions },
                summary: `Generated ${created.length} plantings for crop plan ${plan.name}`,
            },
        });

        return { plan, created };
    });

    // ── Step 4: auto-generate field tasks (outside the db tx) ──
    //
    // createTask + addTaskLink manage their own tenant context and
    // createTask enqueues an assignment notification — neither can run
    // inside the raw db tx above. Idempotency is BATCHED: pull every
    // existing PLANTING task link for this plan's plantings in one read,
    // build a Set of `${plantingId}:${stage}`, and skip any already
    // present. This survives a re-run (regenerate) without duplicating
    // tasks for plantings that kept their ids (SOWN rows) or for a prior
    // partial fan-out.
    const cropLabel = plan.variety?.name ?? plan.cropType?.name ?? plan.name;
    const existingStageKeys = await collectExistingStageTaskKeys(
        ctx,
        created.map((p) => p.id),
    );

    let tasksCreated = 0;
    for (const planting of created) {
        // The stages a planting needs: always SOW + HARVEST; TRANSPLANT
        // only for a transplanted planting.
        const stages: Array<{ stage: 'SOW' | 'TRANSPLANT' | 'HARVEST'; due: Date | null }> = [
            { stage: 'SOW', due: planting.sowDate },
        ];
        if (planting.method === 'TRANSPLANT') {
            stages.push({ stage: 'TRANSPLANT', due: planting.transplantDate });
        }
        stages.push({ stage: 'HARVEST', due: planting.harvestStartDate });

        for (const { stage, due } of stages) {
            if (existingStageKeys.has(`${planting.id}:${stage}`)) continue;
            const title = `${STAGE_VERB[stage]} ${cropLabel} (succession ${planting.successionNumber})`;
            const task = await createTask(ctx, {
                type: 'FARM_TASK',
                title,
                dueAt: due ? due.toISOString() : null,
                // Tag the stage so the idempotency batch + any future
                // reconciliation can identify the task by planting+stage
                // without re-deriving it from the title.
                metadataJson: { plantingStage: stage, cropPlanId },
            });
            await addTaskLink(ctx, task.id, 'PLANTING', planting.id);
            tasksCreated++;
        }
    }

    return {
        cropPlanId: plan.id,
        plantingsGenerated: created.length,
        tasksCreated,
    };
}

/**
 * Batch the task-idempotency check: for the given plantings, return the
 * set of `${plantingId}:${stage}` keys that ALREADY have a PLANTING-
 * linked task. One TaskLink lookup per planting would be a
 * read-in-loop (D1) — instead we read the TaskLink rows for all the
 * plantings in a single tenant-scoped query and join to the tasks'
 * `metadataJson.plantingStage` in memory.
 */
async function collectExistingStageTaskKeys(
    ctx: RequestContext,
    plantingIds: string[],
): Promise<Set<string>> {
    if (plantingIds.length === 0) return new Set();
    return runInTenantContext(ctx, async (db) => {
        const links = await db.taskLink.findMany({
            where: {
                tenantId: ctx.tenantId,
                entityType: 'PLANTING',
                entityId: { in: plantingIds },
            },
            select: {
                entityId: true,
                task: { select: { metadataJson: true } },
            },
            take: LIST_TAKE,
        });
        const keys = new Set<string>();
        for (const link of links) {
            const meta = link.task?.metadataJson as { plantingStage?: string } | null;
            const stage = meta?.plantingStage;
            if (stage) keys.add(`${link.entityId}:${stage}`);
        }
        return keys;
    });
}

// ═════════════════════════════════════════════════════════════════════
//  Plantings list + plan-vs-actual
// ═════════════════════════════════════════════════════════════════════

export async function listPlantings(
    ctx: RequestContext,
    filters: { cropPlanId?: string; status?: string } = {},
    opts: { take?: number } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) =>
        db.planting.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                ...(filters.cropPlanId ? { cropPlanId: filters.cropPlanId } : {}),
                ...(filters.status ? { status: filters.status as Prisma.EnumPlantingStatusFilter['equals'] } : {}),
            },
            orderBy: [{ successionNumber: 'asc' }],
            include: {
                variety: { select: { id: true, name: true } },
                location: { select: { id: true, name: true } },
            },
            take: opts.take ?? LIST_TAKE,
        }),
    );
}

/** Actual dates realised against a planting, grouped by lifecycle stage. */
export interface PlantingActuals {
    SOW: string | null;
    TRANSPLANT: string | null;
    HARVEST: string | null;
}

export interface PlantingProgressRow {
    plantingId: string;
    successionNumber: number;
    method: PlantingMethod;
    status: string;
    planned: {
        sowDate: string | null;
        transplantDate: string | null;
        harvestStartDate: string | null;
        harvestEndDate: string | null;
    };
    actual: PlantingActuals;
}

/**
 * Plan-vs-actual for a crop plan: every Planting's PLANNED dates beside
 * the ACTUAL dates realised by linked journal LogEntries.
 *
 * The actuals are resolved in ONE query — `LogPlanting` rows for all the
 * plan's plantings, joined to their `LogEntry.occurredAt` — then grouped
 * by stage in memory. No N+1: a single `findMany` over LogPlanting (with
 * the plantingId `in` the plan's set) backs the whole table. When two
 * LogEntries realise the same stage of the same planting, the EARLIEST
 * occurredAt wins (the first time the work was actually done).
 */
export async function getCropPlanProgress(ctx: RequestContext, cropPlanId: string): Promise<PlantingProgressRow[]> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const plan = await db.cropPlan.findFirst({
            where: { id: cropPlanId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!plan) throw notFound('Crop plan not found');

        const plantings = await db.planting.findMany({
            where: { tenantId: ctx.tenantId, cropPlanId, deletedAt: null },
            orderBy: [{ successionNumber: 'asc' }],
            select: {
                id: true,
                successionNumber: true,
                method: true,
                status: true,
                sowDate: true,
                transplantDate: true,
                harvestStartDate: true,
                harvestEndDate: true,
            },
            take: LIST_TAKE,
        });
        const plantingIds = plantings.map((p) => p.id);

        // ── ONE query for every actual across every planting ──
        const logLinks = plantingIds.length
            ? await db.logPlanting.findMany({
                  where: { tenantId: ctx.tenantId, plantingId: { in: plantingIds } },
                  select: {
                      plantingId: true,
                      stage: true,
                      logEntry: { select: { occurredAt: true } },
                  },
                  take: LIST_TAKE,
              })
            : [];

        // Group: plantingId → stage → earliest actual occurredAt.
        const actualsByPlanting = new Map<string, PlantingActuals>();
        for (const link of logLinks) {
            const occurred = link.logEntry?.occurredAt ?? null;
            if (!occurred) continue;
            let row = actualsByPlanting.get(link.plantingId);
            if (!row) {
                row = { SOW: null, TRANSPLANT: null, HARVEST: null };
                actualsByPlanting.set(link.plantingId, row);
            }
            const stage = link.stage as 'SOW' | 'TRANSPLANT' | 'HARVEST';
            const iso = occurred.toISOString();
            // Earliest realisation wins.
            if (row[stage] == null || iso < row[stage]!) {
                row[stage] = iso;
            }
        }

        return plantings.map((p) => ({
            plantingId: p.id,
            successionNumber: p.successionNumber,
            method: p.method,
            status: p.status,
            planned: {
                sowDate: p.sowDate?.toISOString() ?? null,
                transplantDate: p.transplantDate?.toISOString() ?? null,
                harvestStartDate: p.harvestStartDate?.toISOString() ?? null,
                harvestEndDate: p.harvestEndDate?.toISOString() ?? null,
            },
            actual: actualsByPlanting.get(p.id) ?? { SOW: null, TRANSPLANT: null, HARVEST: null },
        }));
    });
}
