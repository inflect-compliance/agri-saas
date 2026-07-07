/**
 * Seed a few GLOBAL company promotions (#12). Idempotent — keyed by a fixed
 * id per demo row, so re-running updates rather than duplicating. validTo is
 * relative to "now" so the feed always shows active offers.
 *
 *   npx tsx scripts/seed-promotions.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function inDays(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

const PROMOTIONS = [
    {
        id: 'demo-promo-fertilizer-spring',
        company: 'Agropolychim',
        title: 'Spring NPK — 10% off bulk orders',
        body: 'Volume discount on NPK 15-15-15 for orders above 24 tonnes. Delivery included in Northern Bulgaria.',
        category: 'fertilizer',
        ctaUrl: 'https://www.agropolychim.bg',
        validFrom: inDays(-3),
        validTo: inDays(40),
    },
    {
        id: 'demo-promo-seeds-sunflower',
        company: 'Limagrain',
        title: 'Sunflower hybrids — early-booking offer',
        body: 'High-oleic hybrids with agronomy support. Book before the campaign for preferential pricing.',
        category: 'seeds',
        ctaUrl: null,
        validFrom: inDays(-10),
        validTo: inDays(25),
    },
    {
        id: 'demo-promo-products-fungicide',
        company: 'Syngenta',
        title: 'Cereal fungicide programme — bundle deal',
        body: 'T1 + T2 protection bundle for wheat and barley, with resistance-management guidance.',
        category: 'products',
        ctaUrl: null,
        validFrom: null,
        validTo: inDays(30),
    },
    {
        id: 'demo-promo-service-soil',
        company: 'AgroLab',
        title: 'Soil sampling & analysis — field-day rate',
        body: 'Grid soil sampling with full nutrient panel and variable-rate fertilisation maps.',
        category: 'service',
        ctaUrl: null,
        validFrom: null,
        validTo: null,
    },
];

async function main() {
    for (const p of PROMOTIONS) {
        const { id, ...data } = p;
        await prisma.promotion.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${PROMOTIONS.length} promotions.`);
}

main()
    .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
