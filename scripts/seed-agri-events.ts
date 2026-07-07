/**
 * Seed a few GLOBAL agriculture events (#15). Idempotent — keyed by a fixed
 * id per demo row, so re-running updates rather than duplicating. Dates are
 * relative to "now" so the feed always shows upcoming items.
 *
 *   npx tsx scripts/seed-agri-events.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function inDays(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

const EVENTS = [
    {
        id: 'demo-agri-event-agra',
        title: 'AGRA — International Agricultural Exhibition (Plovdiv)',
        description: 'The largest agricultural fair in Bulgaria — machinery, inputs, and services.',
        category: 'fair',
        startsAt: inDays(20),
        endsAt: inDays(24),
        place: 'International Fair Plovdiv',
        url: 'https://www.fair.bg/en/agra',
    },
    {
        id: 'demo-agri-event-ipm-webinar',
        title: 'Integrated Pest Management — online training',
        description: 'Practical IPM for arable crops: scouting, thresholds, and spray windows.',
        category: 'webinar',
        startsAt: inDays(7),
        endsAt: null,
        place: 'Online',
        url: null,
    },
    {
        id: 'demo-agri-event-capsubsidy',
        title: 'CAP direct payments — application deadline',
        description: 'Final day to submit the campaign direct-payment application.',
        category: 'subsidy-deadline',
        startsAt: inDays(35),
        endsAt: null,
        place: null,
        url: null,
    },
    {
        id: 'demo-agri-event-soil-training',
        title: 'Soil health & precision fertilisation — field day',
        description: 'Hands-on session on soil sampling, interpretation, and variable-rate fertilisation.',
        category: 'training',
        startsAt: inDays(12),
        endsAt: null,
        place: 'Dobrich region',
        url: null,
    },
];

async function main() {
    for (const e of EVENTS) {
        const { id, ...data } = e;
        await prisma.agriEvent.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${EVENTS.length} agriculture events.`);
}

main()
    .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
