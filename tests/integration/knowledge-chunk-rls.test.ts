/**
 * feat/ai-rag — `KnowledgeChunk` RLS behavioural tests.
 *
 * The static guardrail (`tests/guardrails/rls-coverage.test.ts`) confirms
 * the policies + FORCE flag + asymmetric USING/WITH-CHECK shape exist on
 * the table. These tests exercise the actual semantics against a live
 * Postgres so a future migration that quietly weakens the rules breaks
 * here even if the static surface still looks correct.
 *
 * Coverage
 * --------
 *   1. A GLOBAL (tenantId NULL) chunk is readable by ANY tenant.
 *   2. A tenant-private chunk is readable ONLY by its owning tenant.
 *   3. A tenant CANNOT read another tenant's chunk.
 *   4. UPDATE under app_user cannot re-tenant a NULL GLOBAL row to a
 *      foreign tenant (asymmetric USING + strict WITH CHECK).
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

const SUFFIX = randomUUID();
let TENANT_A = '';
let TENANT_B = '';

// Tag every fixture row so cleanup is precise.
const TAG = `kc-rls-${SUFFIX}`;

async function makeTenant(name: string): Promise<string> {
    const t = await globalPrisma.tenant.create({
        data: { name, slug: `${name}-${SUFFIX}` },
        select: { id: true },
    });
    return t.id;
}

async function createChunk(tenantId: string | null, ref: string): Promise<string> {
    // Default Prisma client = postgres role = superuser_bypass fires, so
    // NULL-tenant GLOBAL rows can be minted (the ingestion-script path).
    const row = await globalPrisma.knowledgeChunk.create({
        data: {
            tenantId,
            source: TAG,
            sourceType: 'EXTERNAL',
            sourceRef: ref,
            text: `chunk ${ref}`,
        },
        select: { id: true },
    });
    return row.id;
}

async function cleanup() {
    // Only the tagged fixture chunks are removed. The two test tenants are
    // left in place: tenant creation leaves an AuditLog row, AuditLog is
    // append-only (an IMMUTABLE_AUDIT_LOG trigger forbids DELETE), and the
    // AuditLog_tenantId_fkey then blocks deleting the tenant. The CI test DB
    // is ephemeral and the tenant slugs are unique per run, so leaving them is
    // harmless — cleaner than fighting the immutable-audit invariant.
    await globalPrisma.knowledgeChunk.deleteMany({ where: { source: TAG } });
}

describeFn('feat/ai-rag — KnowledgeChunk RLS', () => {
    beforeAll(async () => {
        TENANT_A = await makeTenant('kcrls-a');
        TENANT_B = await makeTenant('kcrls-b');
    });

    afterAll(async () => {
        await cleanup();
        await globalPrisma.$disconnect();
    });

    it('a GLOBAL (NULL-tenant) chunk is readable by any tenant', async () => {
        const id = await createChunk(null, `global-${randomUUID()}`);

        const fromA = await withTenantDb(TENANT_A, (tx) =>
            tx.knowledgeChunk.findUnique({ where: { id }, select: { id: true } }),
        );
        const fromB = await withTenantDb(TENANT_B, (tx) =>
            tx.knowledgeChunk.findUnique({ where: { id }, select: { id: true } }),
        );
        expect(fromA?.id).toBe(id);
        expect(fromB?.id).toBe(id);
    });

    it('a tenant-private chunk is readable only by its owning tenant', async () => {
        const id = await createChunk(TENANT_A, `priv-${randomUUID()}`);

        const ownView = await withTenantDb(TENANT_A, (tx) =>
            tx.knowledgeChunk.findUnique({ where: { id }, select: { id: true } }),
        );
        expect(ownView?.id).toBe(id);
    });

    it('a tenant cannot read another tenant\'s chunk', async () => {
        const id = await createChunk(TENANT_A, `foreign-${randomUUID()}`);

        const fromB = await withTenantDb(TENANT_B, (tx) =>
            tx.knowledgeChunk.findUnique({ where: { id }, select: { id: true } }),
        );
        expect(fromB).toBeNull();
    });

    it('app_user cannot re-tenant a NULL GLOBAL row to a foreign tenant (WITH CHECK strict)', async () => {
        const id = await createChunk(null, `claim-${randomUUID()}`);

        // USING (NULL OR own) admits the GLOBAL row; WITH CHECK (own)
        // rejects writing a foreign tenantId onto it.
        await expect(
            withTenantDb(TENANT_A, async (tx) => {
                await tx.$executeRawUnsafe(
                    `UPDATE "KnowledgeChunk" SET "tenantId" = $1 WHERE "id" = $2`,
                    TENANT_B,
                    id,
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });
});
