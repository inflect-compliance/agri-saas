/**
 * `PromotionLead` RLS — cross-tenant isolation on `inquirerTenantId`.
 *
 * Why this table needed its own suite: `PromotionLead` holds one tenant's
 * contact PII (the farmer's name is reachable through `inquirerUserId`, and
 * `message` is free text they wrote) but it keys on `inquirerTenantId` — a
 * plain FK that is deliberately NOT a `tenantId` RLS column. The rls-coverage
 * ratchet builds its inventory from models WITH a `tenantId`, so this table sat
 * outside it: unprotected, and invisible to the guard whose job is to catch
 * exactly that. Any tenant's session could read every other tenant's requests.
 *
 * The policy is symmetric (USING = WITH CHECK = own-tenant) because
 * `inquirerTenantId` is NOT NULL — there is no nullable-row case needing a
 * permissive read, so unlike `UserSession` this one does not want the
 * asymmetric shape.
 *
 * Covered here:
 *   1. app_user reads only its OWN tenant's leads.
 *   2. app_user cannot read another tenant's lead by id (the direct-lookup
 *      leak — a filtered list hides it, RLS must make it unreachable).
 *   3. app_user cannot INSERT a lead attributed to another tenant.
 *   4. app_user cannot re-attribute its own lead to another tenant (UPDATE).
 *   5. Superuser (no SET LOCAL ROLE) still sees everything — the privileged
 *      paths (platform-admin curation, the future lead digest, seeds) depend
 *      on the bypass, so a policy that broke them would be a false pass.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { withTenantDb } from '@/lib/db-context';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';

const globalPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DB_URL }),
});

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TENANT_A = `t-plead-a-${randomUUID()}`;
const TENANT_B = `t-plead-b-${randomUUID()}`;
const COMPANY_ID = `co-plead-${randomUUID()}`;
const PROMO_PREFIX = `promo-plead-${randomUUID()}`;
const createdPromotions: string[] = [];
let USER_ID = '';

/**
 * Seed one lead, minting its OWN promotion.
 *
 * `PromotionLead` carries `@@unique([promotionId, inquirerTenantId])` — one
 * lead per tenant per promotion — so reusing a fixed promotion across cases
 * collides on the second seed. A promotion per lead keeps every case
 * independent, which also means no test depends on another's rows surviving.
 *
 * Inserted as superuser so the fixture itself is never subject to the policy
 * under test.
 */
async function seedLead(tenantId: string) {
    const promotionId = `${PROMO_PREFIX}-${randomUUID()}`;
    await globalPrisma.promotion.create({
        data: {
            id: promotionId,
            companyId: COMPANY_ID,
            title: `fixture ${promotionId}`,
            category: 'PRODUCTS',
            publishedAt: new Date(),
        },
    });
    createdPromotions.push(promotionId);

    const id = `lead-${randomUUID()}`;
    await globalPrisma.promotionLead.create({
        data: {
            id,
            promotionId,
            inquirerTenantId: tenantId,
            inquirerUserId: USER_ID,
            requestMessage: `request from ${tenantId}`,
            consentedAt: new Date(),
        },
    });
    return { id, promotionId };
}

describeFn('PromotionLead RLS — cross-tenant isolation', () => {
    beforeAll(async () => {
        const user = await globalPrisma.user.findFirst();
        if (!user) throw new Error('No seeded user — run the test seed first.');
        USER_ID = user.id;

        await globalPrisma.company.create({
            data: { id: COMPANY_ID, name: `RLS Fixture ${COMPANY_ID}`, nameKey: COMPANY_ID },
        });
    });

    afterAll(async () => {
        await globalPrisma.promotionLead.deleteMany({
            where: { promotionId: { in: createdPromotions } },
        });
        await globalPrisma.promotion.deleteMany({ where: { id: { in: createdPromotions } } });
        await globalPrisma.company.deleteMany({ where: { id: COMPANY_ID } });
        await globalPrisma.$disconnect();
    });

    it('app_user sees only its own tenant leads', async () => {
        const mine = await seedLead(TENANT_A);
        const theirs = await seedLead(TENANT_B);

        const rows = await withTenantDb(TENANT_A, async (tx) =>
            tx.$queryRawUnsafe<Array<{ inquirerTenantId: string }>>(
                `SELECT "inquirerTenantId" FROM "PromotionLead"
                 WHERE "promotionId" = ANY($1::text[])`,
                [mine.promotionId, theirs.promotionId],
            ),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.inquirerTenantId === TENANT_A)).toBe(true);
    });

    it("app_user cannot read another tenant's lead by direct id lookup", async () => {
        const { id: foreignId } = await seedLead(TENANT_B);
        const rows = await withTenantDb(TENANT_A, async (tx) =>
            tx.$queryRawUnsafe<Array<{ id: string }>>(
                `SELECT id FROM "PromotionLead" WHERE id = $1`,
                foreignId,
            ),
        );
        expect(rows).toHaveLength(0);
    });

    it('app_user cannot INSERT a lead attributed to another tenant', async () => {
        const { promotionId } = await seedLead(TENANT_A);
        await expect(
            withTenantDb(TENANT_A, async (tx) => {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "PromotionLead"
                       ("id","promotionId","inquirerTenantId","inquirerUserId","message","consentedAt")
                     VALUES ($1,$2,$3,$4,$5,NOW())`,
                    `lead-${randomUUID()}`,
                    promotionId,
                    TENANT_B,
                    USER_ID,
                    'attributed to a tenant we are not',
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });

    it('app_user cannot re-attribute its own lead to another tenant', async () => {
        const { id: own } = await seedLead(TENANT_A);
        // WITH CHECK is what stops this; a USING-only policy would allow it.
        await withTenantDb(TENANT_A, async (tx) => {
            await expect(
                tx.$executeRawUnsafe(
                    `UPDATE "PromotionLead" SET "inquirerTenantId" = $1 WHERE id = $2`,
                    TENANT_B,
                    own,
                ),
            ).rejects.toThrow(/row-level security|new row violates/i);
        });
    });

    it('superuser (no SET LOCAL ROLE) still sees every tenant — the bypass works', async () => {
        const a = await seedLead(TENANT_A);
        const b = await seedLead(TENANT_B);
        const tenants = await globalPrisma.promotionLead.findMany({
            where: { promotionId: { in: [a.promotionId, b.promotionId] } },
            select: { inquirerTenantId: true },
        });
        const distinct = new Set(tenants.map((t) => t.inquirerTenantId));
        expect(distinct.has(TENANT_A)).toBe(true);
        expect(distinct.has(TENANT_B)).toBe(true);
    });
});
