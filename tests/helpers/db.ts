/**
 * Enhanced test database helpers.
 *
 * Extends the existing db-helper.ts with:
 * - migrateTestDb(): run prisma migrate deploy against test DB
 * - resetDatabase(): truncate all tables for clean state
 * - prismaTestClient(): get a connected PrismaClient for tests
 * - getTestDatabaseUrl(): resolve the test database URL
 *
 * Usage (integration tests):
 *   import { DB_AVAILABLE } from './db-helper';
 *   import { prismaTestClient, resetDatabase } from '../helpers/db';
 *   if (!DB_AVAILABLE) { test.skip('DB not available', () => {}); return; }
 *   const prisma = prismaTestClient();
 *   afterAll(() => prisma.$disconnect());
 *   beforeEach(() => resetDatabase(prisma));
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Get the test database URL.
 * Priority: DATABASE_URL_TEST env > .env.test > test container default > .env > fallback.
 */
export function getTestDatabaseUrl(): string {
    // 1. Explicit test env var (set by CI scripts or jest.setup.js)
    if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;

    // 2. .env.test file
    const envTestPath = path.resolve(__dirname, '../../.env.test');
    try {
        const content = fs.readFileSync(envTestPath, 'utf8');
        const match = content.match(/^DATABASE_URL_TEST=["']?([^"'\n]*)["']?$/m)
            || content.match(/^DATABASE_URL=["']?([^"'\n]*)["']?$/m);
        if (match?.[1]) return match[1];
    } catch { /* no .env.test */ }

    // 3. Test container default (docker-compose.test.yml → port 5434)
    const testContainerUrl = 'postgresql://test:test@127.0.0.1:5434/inflect_test?schema=public';

    // 4. Parse from .env (dev database)
    const envPath = path.resolve(__dirname, '../../.env');
    try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^DATABASE_URL="(.*)"/m);
        if (match?.[1]) return match[1];
    } catch { /* no .env */ }

    // Return test container URL as preferred fallback over hard-coded dummy
    return testContainerUrl;
}

/**
 * Run prisma migrate deploy against the test database.
 * Should be called in globalSetup or once before all integration tests.
 */
export function migrateTestDb(): void {
    const url = getTestDatabaseUrl();
    try {
        execSync('npx prisma migrate deploy', {
            cwd: path.resolve(__dirname, '../..'),
            env: { ...process.env, DATABASE_URL: url },
            stdio: 'pipe',
            timeout: 60_000,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[test-db] Migration failed (DB may not be running): ${msg.slice(0, 200)}`);
    }
}

/**
 * Create and return a PrismaClient connected to the test database.
 *
 * Prisma 7 — connections go through the adapter pattern instead of
 * `datasources: { db: { url } }`. The PII encryption middleware is
 * wired via `$extends` (was `$use` in v5). Both adapters take the
 * same env-derived URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prismaTestClient(): any {
    if (!_client) {
        const url = getTestDatabaseUrl();
        const adapter = new PrismaPg({ connectionString: url });
        const base = new PrismaClient({ adapter });
        // GAP-21: wire the same PII middleware production uses so
        // integration tests that write to encrypted-only models
        // (User, AuditorAccount, UserIdentityLink) auto-populate the
        // *Hash columns. Tests that need to bypass the middleware
        // (e.g. rls-isolation.test.ts) construct their own raw
        // PrismaClient and provide emailHash explicitly.
        //
        // Lazy require keeps this file importable from jest's
        // globalSetup context (which doesn't apply the moduleNameMapper
        // for the `@/` alias).

        const { withPiiEncryptionExtension } = require('../../src/lib/security/pii-middleware');
        _client = withPiiEncryptionExtension(base);
    }
    return _client;
}

/**
 * Truncate all application tables in the test database.
 * Preserves system tables (_prisma_migrations, etc).
 * Uses TRUNCATE CASCADE for PostgreSQL.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
    const tables = [
        'AuditLog', 'TaskLink', 'TaskComment', 'TaskWatcher', 'Task',
        'EvidenceReview', 'Evidence', 'FileRecord',
        'ControlRequirementLink', 'ControlRiskLink', 'ControlAssetLink',
        'Control', 'Risk', 'Asset',
        'AuditPackItem', 'AuditPack', 'AuditCycle',
        'PolicyVersion', 'Policy',
        'TestRunEvidence', 'TestRun', 'TestPlan',
        'VendorDocument', 'VendorAssessment', 'VendorContact', 'Vendor',
        'Membership', 'Framework', 'FrameworkRequirement',
    ];

    // Use raw SQL for speed — TRUNCATE CASCADE handles FK constraints
    for (const table of tables) {
        try {
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
        } catch {
            // Table may not exist in schema — skip silently
        }
    }
}

/**
 * Disconnect the singleton test client.
 */
export async function disconnectTestClient(): Promise<void> {
    if (_client) {
        await _client.$disconnect();
        _client = null;
    }
}
