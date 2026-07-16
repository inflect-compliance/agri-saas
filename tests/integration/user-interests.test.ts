/**
 * User interests — DB-backed integration. Verifies the PUT-replace semantics of
 * `setUserInterests` / `getUserInterests` and, crucially, that RLS + the
 * (tenantId, userId) filter isolate one user's interests from another
 * tenant/user. Auto-skips when no test DB is available.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { getUserInterests, setUserInterests } from '@/app-layer/usecases/user-interests';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `ui-${randomUUID().slice(0, 8)}`;
const T1 = `t1-${TAG}`;
const T2 = `t2-${TAG}`;
let u1 = '';
let u2 = '';

const ctx1 = () => makeRequestContext('OWNER', { userId: u1, tenantId: T1, tenantSlug: `${TAG}-a` });
const ctx2 = () => makeRequestContext('OWNER', { userId: u2, tenantId: T2, tenantSlug: `${TAG}-b` });

async function seedTenantUser(tenantId: string, slug: string): Promise<string> {
    await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: tenantId, slug } });
    const email = `${slug}@example.test`;
    const u = await prisma.user.create({ data: { email, emailHash: hashForLookup(email) } });
    await prisma.tenantMembership.create({
        data: { tenantId, userId: u.id, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });
    return u.id;
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    u1 = await seedTenantUser(T1, `${TAG}-a`);
    u2 = await seedTenantUser(T2, `${TAG}-b`);
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('user interests (integration — real DB + RLS)', () => {
    test('setUserInterests stores the normalized set; getUserInterests reads it back sorted', async () => {
        const stored = await setUserInterests(ctx1(), ['  Wheat ', 'SUBSIDY', 'wheat', '']);
        expect(stored).toEqual(['subsidy', 'wheat']);
        expect(await getUserInterests(ctx1())).toEqual(['subsidy', 'wheat']);
    });

    test('PUT-replace clears the previous set', async () => {
        await setUserInterests(ctx1(), ['wheat', 'subsidy']);
        await setUserInterests(ctx1(), ['maize']);
        expect(await getUserInterests(ctx1())).toEqual(['maize']);
    });

    test('interests are isolated per (tenant, user) — RLS', async () => {
        await setUserInterests(ctx1(), ['wheat', 'export']);
        // A different tenant/user sees NONE of tenant 1's interests.
        expect(await getUserInterests(ctx2())).toEqual([]);
        // And setting their own does not disturb tenant 1's.
        await setUserInterests(ctx2(), ['barley']);
        expect(await getUserInterests(ctx2())).toEqual(['barley']);
        expect(await getUserInterests(ctx1())).toEqual(['export', 'wheat']);
    });
});
