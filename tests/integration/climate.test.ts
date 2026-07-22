/**
 * Integration — the /climate read usecase over real WeatherObservation rows.
 *
 * Proves: listWeatherLocations returns the tenant's fields; getLocationClimate
 * builds the daily series (ascending), picks location-local "today" as the
 * current conditions, derives today's spray window from the hourly series, and
 * flags a forecast tail. Foreign / empty cases degrade cleanly.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { listWeatherLocations, getLocationClimate } from '@/app-layer/usecases/climate';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `clim-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

// A fixed "now" at 04:00 UTC on 2026-06-15 so the morning spray hours (06–09)
// are still ahead and don't get clipped. utcOffsetSeconds = 0 → local == UTC.
const NOW = new Date('2026-06-15T04:00:00Z');
const dayUTC = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Calm morning (wind low, dry, mild) → hours 6–9 suitable ⇒ a window 06–10.
const HOURLY_TODAY = [4, 5, 6, 7, 8, 9, 10].map((hour) => ({
    hour,
    windKmh: hour >= 6 && hour <= 9 ? 5 : 25,
    precipMm: 0,
    tempC: 18,
}));

async function obs(dateIso: string, opts: { hourly?: unknown } = {}) {
    await prisma.weatherObservation.create({
        data: {
            tenantId: TENANT_ID,
            locationId,
            obsDate: dayUTC(dateIso),
            source: 'open-meteo',
            tempMaxC: 24,
            tempMinC: 12,
            tempMeanC: 18,
            precipMm: 0,
            windMaxKmh: 10,
            humidityMean: 55,
            utcOffsetSeconds: 0,
            hourlyJson: (opts.hourly ?? null) as never,
        },
    });
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: TENANT_ID, slug: TAG },
    });
    const u = await prisma.user.create({
        data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) },
    });
    ownerId = u.id;
    await prisma.tenantMembership.create({
        data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });
    const loc = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Field ${TAG}` } });
    locationId = loc.id;

    await obs('2026-06-14'); // yesterday
    await obs('2026-06-15', { hourly: HOURLY_TODAY }); // today (with hourly)
    await obs('2026-06-16'); // tomorrow (forecast tail)
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('climate read usecase', () => {
    test('listWeatherLocations returns the tenant field', async () => {
        const locs = await listWeatherLocations(ctx());
        expect(locs.some((l) => l.id === locationId && l.name === `Field ${TAG}`)).toBe(true);
    });

    test('getLocationClimate builds the series, picks today, derives the spray window', async () => {
        const c = await getLocationClimate(ctx(), locationId, { now: NOW });
        expect(c).not.toBeNull();
        // Daily series ascending, all three days.
        expect(c!.daily.map((d) => d.date)).toEqual(['2026-06-14', '2026-06-15', '2026-06-16']);
        // "Today" (local) is the current conditions.
        expect(c!.current?.date).toBe('2026-06-15');
        expect(c!.hasForecast).toBe(true); // 06-16 is after today
        expect(c!.source).toBe('open-meteo');
        // Spray window derived from the calm 06–09 hours (endHour exclusive).
        expect(c!.sprayWindow).not.toBeNull();
        expect(c!.sprayWindow!.windows.length).toBeGreaterThanOrEqual(1);
        const w = c!.sprayWindow!.windows[0];
        expect(w.startHour).toBe(6);
        expect(w.endHour).toBe(10);
    });

    test('a foreign / missing location returns null', async () => {
        const c = await getLocationClimate(ctx(), 'nonexistent-id', { now: NOW });
        expect(c).toBeNull();
    });
});
