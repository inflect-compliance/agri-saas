import { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { logEvent } from '../events/audit';
import { badRequest } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { cachedListRead } from '@/lib/cache/list-cache';
import { Prisma, ItemCategory, QuantityMeasure } from '@prisma/client';

/**
 * Read-only catalog endpoints backing the prescription form:
 *   • Items — the tenant's input-product catalog (spray products),
 *   • Units — the global unit-of-measure catalog (dose RATE units).
 */
export async function listItems(ctx: RequestContext, filters?: { category?: string; q?: string }) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => {
        const where: Prisma.ItemWhereInput = { tenantId: ctx.tenantId, deletedAt: null };
        if (filters?.category) where.category = filters.category as ItemCategory;
        if (filters?.q) where.name = { contains: filters.q, mode: 'insensitive' };
        return db.item.findMany({
            where,
            include: { defaultUnit: { select: { id: true, key: true, symbol: true, measure: true } } },
            orderBy: { name: 'asc' },
        });
    });
}

export interface CreateItemInput {
    name: string;
    category:
        | 'SEED'
        | 'PESTICIDE'
        | 'FERTILIZER'
        | 'AMENDMENT'
        | 'FUEL'
        | 'HARVESTED_PRODUCE'
        | 'OTHER';
    defaultUnitId: string;
    sku?: string | null;
    reorderLevel?: number | null;
}

/**
 * Create an input-product catalog entry (the thing lots are batches of).
 * Part of the inventory module — the POST /items route gates on
 * INVENTORY; the read path stays open (the spray form needs it).
 */
export async function createItem(ctx: RequestContext, input: CreateItemInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const name = sanitizePlainText(input.name.trim());
        if (!name) throw badRequest('Product name is required.');
        const unit = await db.unit.findUnique({ where: { id: input.defaultUnitId }, select: { id: true } });
        if (!unit) throw badRequest('Default unit not found.');

        const item = await db.item.create({
            data: {
                tenantId: ctx.tenantId,
                name,
                category: input.category as ItemCategory,
                defaultUnitId: input.defaultUnitId,
                sku: input.sku ? sanitizePlainText(input.sku.trim()) : null,
                reorderLevel: input.reorderLevel ?? null,
                createdByUserId: ctx.userId ?? null,
            },
            select: { id: true, name: true, category: true },
        });

        await logEvent(db, ctx, {
            action: 'INVENTORY_ITEM_CREATED',
            entityType: 'Item',
            entityId: item.id,
            details: `Created product ${item.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Item',
                operation: 'created',
                after: { name: item.name, category: item.category },
                summary: `Created product ${item.name}`,
            },
        });

        return item;
    });
}

export async function listUnits(ctx: RequestContext, measure?: string) {
    assertCanRead(ctx);
    // Units are a static, seeded catalog — cache for a day. NOTE: there
    // is NO Unit write path (the catalog is seeded), so there is nothing
    // to `bumpEntityCacheVersion` — the entry is TTL-only.
    //
    // NOTE: Unit is a GLOBAL catalog (no tenantId / no RLS), but
    // `cachedListRead` keys by `ctx.tenantId`. That means every tenant
    // gets its OWN cached copy of the same global list — a harmless
    // per-tenant duplication (correct, just slightly redundant). We
    // accept it rather than add a separate global-key cache path.
    return cachedListRead({
        ctx,
        entity: 'unit',
        operation: 'list',
        params: { measure: measure ?? null },
        ttlSeconds: 86400,
        loader: () =>
            // Read inside the tenant context for a single, consistent
            // connection path.
            runInTenantContext(ctx, (db) =>
                db.unit.findMany({
                    where: measure ? { measure: measure as QuantityMeasure } : {},
                    orderBy: [{ measure: 'asc' }, { name: 'asc' }],
                }),
            ),
    });
}
