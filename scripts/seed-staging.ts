/**
 * Staging Seed — Deterministic, idempotent seed for staging environments.
 *
 * Runs the base seed (prisma/seed.ts) first, then adds staging-specific
 * demo data: tasks, evidence placeholders, an audit cycle, and more.
 *
 * Usage:
 *   npx tsx scripts/seed-staging.ts
 *   npm run seed:staging
 *
 * Idempotent: safe to run multiple times without duplicating data.
 */

const { PrismaClient: StagingPrismaClient } = require('@prisma/client');
const path = require('path');

const stagingPrisma = new StagingPrismaClient();

// ── Config (override via env vars) ──
const STAGING_TENANT_SLUG = process.env.STAGING_TENANT_SLUG || 'acme-corp';
const STAGING_ADMIN_EMAIL = process.env.STAGING_ADMIN_EMAIL || 'admin@acme.com';
const STAGING_ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD || 'password123';

async function seedStaging() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Staging Seed — Inflect Compliance       ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  Tenant: ${STAGING_TENANT_SLUG}`);
    console.log(`  Admin:  ${STAGING_ADMIN_EMAIL}\n`);

    // ── Step 1: Run base seed ──
    console.log('── Step 1: Running base seed ──────────────');
    require(path.resolve(__dirname, '../prisma/seed.ts'));
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ── Step 2: Resolve tenant and admin ──
    console.log('\n── Step 2: Staging-specific demo data ─────');
    const tenant = await stagingPrisma.tenant.findUnique({ where: { slug: STAGING_TENANT_SLUG } });
    if (!tenant) {
        console.error(`❌ Tenant "${STAGING_TENANT_SLUG}" not found. Did the base seed run?`);
        process.exit(1);
    }
    const admin = await stagingPrisma.user.findUnique({ where: { emailHash: hashForLookup(STAGING_ADMIN_EMAIL) } });
    if (!admin) {
        console.error(`❌ Admin user "${STAGING_ADMIN_EMAIL}" not found.`);
        process.exit(1);
    }

    // ── Step 3: Create demo tasks ──
    const demoTasks = [
        { title: 'Complete annual risk assessment', description: 'Perform the ISO 27001 annual risk assessment for all business units.', priority: 'HIGH', status: 'OPEN' },
        { title: 'Update access control policy', description: 'Review and update the access control policy to reflect new cloud services.', priority: 'MEDIUM', status: 'IN_PROGRESS' },
        { title: 'Schedule penetration test', description: 'Engage external vendor for Q2 penetration testing of production systems.', priority: 'HIGH', status: 'OPEN' },
        { title: 'Employee security awareness training', description: 'Deploy phishing simulation and security awareness module to all staff.', priority: 'MEDIUM', status: 'DONE' },
        { title: 'Review vendor SLAs', description: 'Audit all critical vendor SLAs for security and compliance clauses.', priority: 'LOW', status: 'OPEN' },
    ];
    for (const t of demoTasks) {
        const existing = await stagingPrisma.task.findFirst({
            where: { tenantId: tenant.id, title: t.title },
        });
        if (!existing) {
            await stagingPrisma.task.create({
                data: {
                    tenantId: tenant.id,
                    title: t.title,
                    description: t.description,
                    priority: t.priority,
                    status: t.status,
                    createdByUserId: admin.id,
                    assigneeId: admin.id,
                },
            });
        }
    }
    console.log(`✅ ${demoTasks.length} demo tasks seeded`);

    // ── Step 4: Create evidence placeholders ──
    const demoEvidence = [
        { name: 'Access Review Log Q1', type: 'DOCUMENT', status: 'CURRENT' },
        { name: 'Penetration Test Report 2024', type: 'DOCUMENT', status: 'CURRENT' },
        { name: 'Security Training Completion Cert', type: 'CERTIFICATE', status: 'CURRENT' },
        { name: 'Firewall Configuration Snapshot', type: 'SCREENSHOT', status: 'DRAFT' },
    ];
    for (const e of demoEvidence) {
        const existing = await stagingPrisma.evidence.findFirst({
            where: { tenantId: tenant.id, name: e.name },
        });
        if (!existing) {
            await stagingPrisma.evidence.create({
                data: { tenantId: tenant.id, name: e.name, type: e.type, status: e.status },
            });
        }
    }
    console.log(`✅ ${demoEvidence.length} evidence placeholders seeded`);

    // ── Step 5: Create an audit cycle ──
    const auditCycleTitle = 'ISO 27001 Annual Audit 2024';
    const existingCycle = await stagingPrisma.auditCycle.findFirst({
        where: { tenantId: tenant.id, title: auditCycleTitle },
    });
    if (!existingCycle) {
        await stagingPrisma.auditCycle.create({
            data: {
                tenantId: tenant.id,
                title: auditCycleTitle,
                scope: 'Full ISO 27001:2022 Annex A compliance audit',
                status: 'OPEN',
                createdByUserId: admin.id,
            },
        });
        console.log('✅ Demo audit cycle created');
    } else {
        console.log('✅ Demo audit cycle already exists');
    }

    // ── Step 6: Link controls to ISO 27001 requirements ──
    const controls = await stagingPrisma.control.findMany({ where: { tenantId: tenant.id }, take: 4 });
    const iso27001 = await stagingPrisma.framework.findUnique({ where: { key: 'ISO27001' } });
    if (iso27001 && controls.length > 0) {
        const requirements = await stagingPrisma.frameworkRequirement.findMany({
            where: { frameworkId: iso27001.id }, take: 4, orderBy: { sortOrder: 'asc' },
        });
        for (let i = 0; i < Math.min(controls.length, requirements.length); i++) {
            await stagingPrisma.controlRequirementLink.upsert({
                where: { controlId_requirementId: { controlId: controls[i].id, requirementId: requirements[i].id } },
                create: { controlId: controls[i].id, requirementId: requirements[i].id },
                update: {},
            });
        }
        console.log(`✅ ${Math.min(controls.length, requirements.length)} control→requirement links seeded`);
    }

    // ── Summary ──
    const counts = {
        tenants: await stagingPrisma.tenant.count(),
        users: await stagingPrisma.user.count(),
        controls: await stagingPrisma.control.count({ where: { tenantId: tenant.id } }),
        risks: await stagingPrisma.risk.count({ where: { tenantId: tenant.id } }),
        tasks: await stagingPrisma.task.count({ where: { tenantId: tenant.id } }),
        evidence: await stagingPrisma.evidence.count({ where: { tenantId: tenant.id } }),
        frameworks: await stagingPrisma.framework.count(),
        auditCycles: await stagingPrisma.auditCycle.count({ where: { tenantId: tenant.id } }),
    };

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  Staging Seed Complete                   ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Tenants:      ${String(counts.tenants).padStart(4)}                     ║`);
    console.log(`║  Users:        ${String(counts.users).padStart(4)}                     ║`);
    console.log(`║  Controls:     ${String(counts.controls).padStart(4)}                     ║`);
    console.log(`║  Risks:        ${String(counts.risks).padStart(4)}                     ║`);
    console.log(`║  Tasks:        ${String(counts.tasks).padStart(4)}                     ║`);
    console.log(`║  Evidence:     ${String(counts.evidence).padStart(4)}                     ║`);
    console.log(`║  Frameworks:   ${String(counts.frameworks).padStart(4)}                     ║`);
    console.log(`║  Audit Cycles: ${String(counts.auditCycles).padStart(4)}                     ║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Login: ${STAGING_ADMIN_EMAIL} / ${STAGING_ADMIN_PASSWORD}    ║`);
    console.log('╚══════════════════════════════════════════╝');
}

seedStaging()
    .catch((err) => {
        console.error('❌ Staging seed failed:', err);
        process.exit(1);
    })
    .finally(() => stagingPrisma.$disconnect());
