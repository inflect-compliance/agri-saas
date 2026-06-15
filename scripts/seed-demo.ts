#!/usr/bin/env tsx
/**
 * End-to-end DEMO seed — the two product personas in one coherent dataset.
 *
 *   1. A STARTUP FARM (simple mode): a single tenant whose
 *      TenantModuleSettings enables only the core ag modules
 *      (JOURNAL / INVENTORY / PLANNING). On login this operator sees a
 *      focused workspace — no certification / risk / vendor chrome.
 *      BillingAccount.plan = FREE (the per-user / per-location caps bite
 *      in SAAS mode; in dev SELFHOSTED everything resolves to ENTERPRISE).
 *
 *   2. A LARGE GRAIN PRODUCER (enterprise): one Organization with several
 *      child farm tenants (hub-and-spoke), each with the full module
 *      surface and BillingAccount.plan = ENTERPRISE. An org admin sees the
 *      portfolio of farms.
 *
 * Both personas get real ag data (location, input stock lot, a journal
 * entry, a farm task, CC0 growing guides) so the core flows work
 * immediately. Idempotent: re-running upserts by slug + skips present rows.
 *
 * Usage:  tsx scripts/seed-demo.ts   (or `npm run seed:demo`)
 */
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithOwner } from '@/app-layer/usecases/tenant-lifecycle';
import { setEnabledModules } from '@/app-layer/usecases/modules';
import { createLocation } from '@/app-layer/usecases/location';
import { createLot } from '@/app-layer/usecases/inventory';
import { hashForLookup } from '@/lib/security/encryption';
import { SIMPLE_MODE_MODULES, ALL_MODULES } from '@/lib/modules';
import type { ModuleKey } from '@prisma/client';
import { importUnits } from './import-units';
import { importKnowledge } from './import-knowledge';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }) });

function ownerCtx(tenantId: string, userId: string): RequestContext {
    return {
        requestId: randomUUID(),
        userId,
        tenantId,
        tenantSlug: undefined,
        role: 'OWNER' as Role,
        permissions: { canRead: true, canWrite: true, canAdmin: true, canAudit: false, canExport: true },
        appPermissions: getPermissionsForRole('OWNER' as Role),
    };
}

async function upsertOwner(email: string, name: string, pwd: string) {
    return prisma.user.upsert({
        where: { emailHash: hashForLookup(email) },
        update: {},
        create: { email, emailHash: hashForLookup(email), passwordHash: pwd, name },
    });
}

interface FarmSpec {
    slug: string;
    name: string;
    ownerEmail: string;
    ownerName: string;
    modules: readonly ModuleKey[];
    plan: 'FREE' | 'ENTERPRISE';
    organizationId?: string;
    cropProduct: string;
}

/** Create (idempotently) one farm tenant with module settings + ag data. */
async function seedFarm(spec: FarmSpec, pwd: string) {
    const owner = await upsertOwner(spec.ownerEmail, spec.ownerName, pwd);

    let tenant = await prisma.tenant.findUnique({ where: { slug: spec.slug } });
    if (!tenant) {
        const r = await createTenantWithOwner({
            name: spec.name,
            slug: spec.slug,
            ownerEmail: spec.ownerEmail,
            requestId: `seed-demo-${randomUUID()}`,
        });
        tenant = await prisma.tenant.findUnique({ where: { id: r.tenant.id } });
    }
    if (!tenant) throw new Error(`seed-demo: failed to create tenant ${spec.slug}`);

    if (spec.organizationId) {
        await prisma.tenant.update({ where: { id: tenant.id }, data: { organizationId: spec.organizationId } });
    }

    const ctx = ownerCtx(tenant.id, owner.id);

    // Persona differentiator #1 — module settings (drives the visible nav).
    await setEnabledModules(ctx, [...spec.modules]);

    // Persona differentiator #2 — billing plan (caps bite in SAAS mode).
    try {
        await prisma.billingAccount.upsert({
            where: { tenantId: tenant.id },
            update: { plan: spec.plan },
            create: { tenantId: tenant.id, plan: spec.plan },
        });
    } catch {
        /* BillingAccount shape varies by deployment; non-fatal for the demo. */
    }

    // ── Ag data so the core flows work immediately ──
    const litre = await prisma.unit.findUnique({ where: { key: 'l' } });
    const kg = await prisma.unit.findUnique({ where: { key: 'kg' } });

    // Two input items + one harvested-produce item.
    async function ensureItem(name: string, category: 'SEED' | 'FERTILIZER' | 'PESTICIDE' | 'HARVESTED_PRODUCE', unitId?: string) {
        if (!unitId) return null;
        const existing = await prisma.item.findFirst({ where: { tenantId: tenant!.id, name } });
        if (existing) return existing;
        return prisma.item.create({ data: { tenantId: tenant!.id, name, category, defaultUnitId: unitId, createdByUserId: owner.id } });
    }
    const fert = await ensureItem('Liquid Nitrogen 28%', 'FERTILIZER', litre?.id);
    await ensureItem(spec.cropProduct, 'HARVESTED_PRODUCE', kg?.id);

    // Location (a field) — reuses the entitlement-gated usecase.
    let locationId: string | null = null;
    const existingLoc = await prisma.location.findFirst({ where: { tenantId: tenant.id, name: 'Home Field' } });
    if (existingLoc) {
        locationId = existingLoc.id;
    } else {
        try {
            const loc = await createLocation(ctx, { name: 'Home Field', description: 'Demo field block.' });
            locationId = loc.id;
        } catch (e) {
            console.warn(`  ⚠️  ${spec.slug}: location seed skipped:`, e instanceof Error ? e.message : e);
        }
    }

    // An inventory lot with stock (a fertiliser delivery).
    if (fert) {
        const existingLot = await prisma.inventoryLot.findFirst({ where: { tenantId: tenant.id, itemId: fert.id } });
        if (!existingLot) {
            try {
                await createLot(ctx, { itemId: fert.id, lotCode: `N28-${spec.slug}`, locationId, initialQuantity: 1000 });
            } catch (e) {
                console.warn(`  ⚠️  ${spec.slug}: lot seed skipped:`, e instanceof Error ? e.message : e);
            }
        }
    }

    // A journal observation. Direct-prisma (the seed convention) — the
    // createLogEntry usecase is exercised by the integration tests; here we
    // just want the row so the journal list isn't empty.
    const existingEntry = await prisma.logEntry.findFirst({ where: { tenantId: tenant.id } });
    if (!existingEntry) {
        const entry = await prisma.logEntry.create({
            data: {
                tenantId: tenant.id,
                type: 'OBSERVATION',
                status: 'DONE',
                occurredAt: new Date(),
                title: 'Crop emergence looking even across the field',
                notes: '<p>Good establishment after last week\'s rain.</p>',
                createdByUserId: owner.id,
            },
            select: { id: true },
        });
        if (locationId) {
            await prisma.logLocation.create({ data: { tenantId: tenant.id, logEntryId: entry.id, locationId } }).catch(() => {});
        }
    }

    // A farm task assigned to the owner. Direct-prisma (mirrors how the
    // main seed creates tasks) to avoid the createTask side effects
    // (BullMQ assignment-notification enqueue) that hang without Redis.
    const existingTask = await prisma.task.findFirst({ where: { tenantId: tenant.id, type: 'FARM_TASK' } });
    if (!existingTask) {
        const task = await prisma.task.create({
            data: {
                tenantId: tenant.id,
                type: 'FARM_TASK',
                title: 'Scout north field for aphids',
                priority: 'P2',
                status: 'OPEN',
                dueAt: new Date(Date.now() + 3 * 86_400_000),
                createdByUserId: owner.id,
                assigneeUserId: owner.id,
                metadataJson: { farmTaskType: 'SCOUTING', farmTaskCategory: 'PEST_DISEASE' },
            },
            select: { id: true },
        });
        if (locationId) {
            await prisma.taskLink.create({
                data: { tenantId: tenant.id, taskId: task.id, entityType: 'LOCATION', entityId: locationId },
            }).catch(() => {});
        }
    }

    // CC0 growing guides.
    try {
        await importKnowledge(prisma, { tenantSlug: spec.slug });
    } catch (e) {
        console.warn(`  ⚠️  ${spec.slug}: knowledge seed skipped:`, e instanceof Error ? e.message : e);
    }

    console.log(`✅ ${spec.name} (${spec.slug}) — modules: [${spec.modules.join(', ')}], plan: ${spec.plan}, owner: ${spec.ownerEmail}`);
    return { tenant, owner };
}

async function main() {
    console.log('🌱 Seeding the two-persona demo dataset…\n');
    const pwd = await bcrypt.hash(process.env.SEED_PASSWORD || 'password123', 10);

    // Global unit catalog (shared) — needed before any item/lot.
    await importUnits(prisma);

    // ── Persona 1: the startup farmer (simple mode, FREE) ──
    await seedFarm(
        {
            slug: 'green-acres',
            name: 'Green Acres',
            ownerEmail: 'farmer@greenacres.demo',
            ownerName: 'Sam Smallholder',
            modules: SIMPLE_MODE_MODULES,
            plan: 'FREE',
            cropProduct: 'Wheat (grain)',
        },
        pwd,
    );

    // ── Persona 2: the large grain producer (enterprise, hub-and-spoke) ──
    const org = await prisma.organization.upsert({
        where: { slug: 'bigfarm-co' },
        update: {},
        create: { name: 'BigFarm Co', slug: 'bigfarm-co' },
    });
    console.log(`✅ Organization: ${org.name} (${org.slug})`);

    const childFarms: Array<Pick<FarmSpec, 'slug' | 'name' | 'ownerEmail' | 'ownerName' | 'cropProduct'>> = [
        { slug: 'bigfarm-north', name: 'BigFarm — North Estate', ownerEmail: 'north@bigfarm.demo', ownerName: 'Nadia North', cropProduct: 'Wheat (grain)' },
        { slug: 'bigfarm-south', name: 'BigFarm — South Estate', ownerEmail: 'south@bigfarm.demo', ownerName: 'Sven South', cropProduct: 'Barley (grain)' },
        { slug: 'bigfarm-east', name: 'BigFarm — East Estate', ownerEmail: 'east@bigfarm.demo', ownerName: 'Elena East', cropProduct: 'Oilseed Rape' },
    ];
    for (const farm of childFarms) {
        await seedFarm(
            { ...farm, modules: ALL_MODULES, plan: 'ENTERPRISE', organizationId: org.id },
            pwd,
        );
    }

    // ── Demo certification scheme (global AG_SCHEME framework) ──
    // A certification scheme is a GLOBAL Framework (no tenantId) with
    // kind = 'AG_SCHEME'; its requirements are ordinary
    // FrameworkRequirement rows. The enterprise farms (ENTERPRISE plan +
    // ALL_MODULES) can map practices to it. Direct prisma writes (not the
    // usecases) to avoid the BullMQ/Redis enqueue hang in dev. Idempotent
    // via upsert on the unique `key`. Concept-only requirement text — no
    // proprietary scheme wording (LICENSE hygiene).
    const SCHEME_KEY = 'ORGANIC-DEMO';
    const scheme = await prisma.framework.upsert({
        where: { key: SCHEME_KEY },
        update: {},
        create: {
            key: SCHEME_KEY,
            name: 'Organic Certification (demo)',
            description: 'Illustrative organic-production scheme for the demo — concept content only.',
            kind: 'AG_SCHEME',
        },
    });
    const schemeRequirements = [
        { code: 'OC-1', title: 'No prohibited synthetic inputs applied within the conversion window', sortOrder: 0 },
        { code: 'OC-2', title: 'Input applications recorded with date, product, rate, and location', sortOrder: 1 },
        { code: 'OC-3', title: 'Buffer zones maintained between organic and conventional parcels', sortOrder: 2 },
        { code: 'OC-4', title: 'Harvest lots traceable to the field of origin', sortOrder: 3 },
    ];
    for (const r of schemeRequirements) {
        await prisma.frameworkRequirement.upsert({
            where: { frameworkId_code: { frameworkId: scheme.id, code: r.code } },
            update: {},
            create: { frameworkId: scheme.id, code: r.code, title: r.title, sortOrder: r.sortOrder },
        });
    }
    console.log(`✅ Certification scheme: ${scheme.name} (${SCHEME_KEY}) with ${schemeRequirements.length} requirements`);

    // Org admin who sees the whole portfolio.
    const orgAdmin = await upsertOwner('admin@bigfarm.demo', 'Olivia OrgAdmin', pwd);
    await prisma.orgMembership.upsert({
        where: { organizationId_userId: { organizationId: org.id, userId: orgAdmin.id } },
        update: {},
        create: { organizationId: org.id, userId: orgAdmin.id, role: 'ORG_ADMIN' },
    });
    // Auto-provision the org admin into each child farm as AUDITOR (portfolio read).
    const orgTenants = await prisma.tenant.findMany({ where: { organizationId: org.id }, select: { id: true } });
    for (const t of orgTenants) {
        await prisma.tenantMembership.upsert({
            where: { tenantId_userId: { tenantId: t.id, userId: orgAdmin.id } },
            update: {},
            create: { tenantId: t.id, userId: orgAdmin.id, role: 'AUDITOR', provisionedByOrgId: org.id },
        });
    }
    console.log(`✅ Org admin admin@bigfarm.demo provisioned across ${orgTenants.length} child farms`);

    console.log('\n🎉 Demo seed complete.');
    console.log('   Startup farmer : farmer@greenacres.demo  → /t/green-acres   (simple mode)');
    console.log('   Enterprise org : admin@bigfarm.demo       → /org/bigfarm-co  (portfolio)');
    console.log('   (password set via SEED_PASSWORD; default "password123")');
}

main()
    .catch((err) => {
        console.error('Demo seed failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        // Force exit — a lazily-opened BullMQ/Redis handle from a usecase
        // can keep the event loop alive after the work is done (Redis is
        // absent in dev). The data is committed; exit deterministically.
        process.exit(process.exitCode ?? 0);
    });
