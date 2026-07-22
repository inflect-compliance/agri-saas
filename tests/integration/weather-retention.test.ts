/**
 * Integration — WeatherObservation retention prune.
 *
 * `pruneOldObservations` hard-deletes a location's rows older than the rolling
 * WEATHER_RETENTION_DAYS window (weather is reproducible), keeping per-location
 * growth bounded. Proves: old rows go, recent rows stay, scoped to the location.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { runInTenantContext } from '@/lib/db-context';
import { pruneOldObservations, WEATHER_RETENTION_DAYS } from '@/app-layer/jobs/weather-pull';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `wret-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

const NOW = new Date('2026-06-15T00:00:00Z');
const daysAgo = (n: number) => {
    const d = new Date(NOW.getTime() - n * 86_400_000);
    return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`); // UTC midnight (@db.Date)
};

async function obs(date: Date) {
    await prisma.weatherObservation.create({
        data: { tenantId: TENANT_ID, locationId, obsDate: date, source: 'open-meteo', tempMeanC: 15 },
    });
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: {}, create: { id: TENANT_ID, name: TENANT_ID, slug: TAG } });
    const u = await prisma.user.create({ data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({ data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    const loc = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Field ${TAG}` } });
    locationId = loc.id;

    await obs(daysAgo(WEATHER_RETENTION_DAYS + 60)); // well past the window → prune
    await obs(daysAgo(WEATHER_RETENTION_DAYS + 1)); // just past the window → prune
    await obs(daysAgo(5)); // recent → keep
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('weather retention prune', () => {
    test('prunes rows older than the window, keeps recent, scoped to the location', async () => {
        const before = await prisma.weatherObservation.count({ where: { tenantId: TENANT_ID, locationId } });
        expect(before).toBe(3);

        const removed = await runInTenantContext(ctx(), (db) =>
            pruneOldObservations(db, TENANT_ID, locationId, NOW),
        );
        expect(removed).toBe(2);

        const remaining = await prisma.weatherObservation.findMany({
            where: { tenantId: TENANT_ID, locationId },
            select: { obsDate: true },
        });
        expect(remaining).toHaveLength(1);
        // The survivor is the recent (5-day-old) row.
        expect(remaining[0].obsDate.getTime()).toBe(daysAgo(5).getTime());
    });
});
