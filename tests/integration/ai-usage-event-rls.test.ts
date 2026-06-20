/**
 * AiUsageEvent RLS behavioural tests (feat/ai-guardrails).
 *
 * The static guardrail (`tests/guardrails/rls-coverage.test.ts`) confirms
 * the policies + FORCE flag exist; this suite exercises the semantics
 * against a live Postgres so a future migration that weakens isolation
 * breaks here. Standard tenant-scoped table (tenantId NON-null):
 *
 *   1. app_user INSERT with own tenantId          → succeeds.
 *   2. app_user INSERT with a different tenantId   → blocked (WITH CHECK).
 *   3. app_user SELECT sees only own-tenant rows   → tenant A cannot read
 *      tenant B's usage rows.
 *   4. Superuser (global Prisma) reads every row   → migrations / admin.
 *
 * Cleans up only its own tagged rows (the unique tenant ids it creates).
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

const TENANT_A = `t-aiu-a-${randomUUID()}`;
const TENANT_B = `t-aiu-b-${randomUUID()}`;

function row(tenantId: string) {
    return {
        id: `aiu-${randomUUID()}`,
        tenantId,
        task: 'copilot-chat',
        model: 'claude-sonnet-4-6',
        backend: 'claude',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costMicros: 100,
        cacheHit: false,
        promptHash: 'a'.repeat(64),
    };
}

async function cleanup() {
    // Only the tagged usage rows are removed. The two test tenants are left
    // in place: tenant creation leaves an AuditLog row, AuditLog is
    // append-only (an IMMUTABLE_AUDIT_LOG trigger forbids DELETE), and the
    // AuditLog_tenantId_fkey then blocks deleting the tenant. The CI test DB
    // is ephemeral and the tenant ids/slugs are unique per run, so leaving
    // them is harmless — cleaner than fighting the immutable-audit invariant.
    await globalPrisma.aiUsageEvent.deleteMany({
        where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
}

describeFn('AiUsageEvent RLS', () => {
    beforeAll(async () => {
        await globalPrisma.tenant.create({
            data: { id: TENANT_A, name: 'AIU A', slug: TENANT_A },
        });
        await globalPrisma.tenant.create({
            data: { id: TENANT_B, name: 'AIU B', slug: TENANT_B },
        });
    });

    afterAll(async () => {
        await cleanup();
        await globalPrisma.$disconnect();
    });

    it('app_user can INSERT a row with its own tenantId', async () => {
        const r = row(TENANT_A);
        await expect(
            withTenantDb(TENANT_A, async (tx) => {
                await tx.aiUsageEvent.create({ data: r });
            }),
        ).resolves.toBeUndefined();
    });

    it('app_user CANNOT INSERT a row for a different tenant', async () => {
        await expect(
            withTenantDb(TENANT_A, async (tx) => {
                // Try to write a row tagged for tenant B while in A's context.
                await tx.aiUsageEvent.create({ data: row(TENANT_B) });
            }),
        ).rejects.toThrow();
    });

    it('tenant A cannot read tenant B usage rows', async () => {
        // Seed one row for each tenant via the superuser client.
        await globalPrisma.aiUsageEvent.create({ data: row(TENANT_A) });
        await globalPrisma.aiUsageEvent.create({ data: row(TENANT_B) });

        const visibleToA = await withTenantDb(TENANT_A, async (tx) =>
            tx.aiUsageEvent.findMany({ select: { tenantId: true } }),
        );
        // Every visible row belongs to A; none belong to B.
        expect(visibleToA.length).toBeGreaterThan(0);
        expect(visibleToA.every((x) => x.tenantId === TENANT_A)).toBe(true);
        expect(visibleToA.some((x) => x.tenantId === TENANT_B)).toBe(false);
    });

    it('superuser (global Prisma) sees rows across tenants', async () => {
        const all = await globalPrisma.aiUsageEvent.findMany({
            where: { tenantId: { in: [TENANT_A, TENANT_B] } },
            select: { tenantId: true },
        });
        const tenants = new Set(all.map((x) => x.tenantId));
        expect(tenants.has(TENANT_A)).toBe(true);
        expect(tenants.has(TENANT_B)).toBe(true);
    });
});
