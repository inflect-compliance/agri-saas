/**
 * RQ3-6 — "the loss-event register: forecasts meet reality" ratchet.
 *
 * Regression classes guarded:
 *
 *   - the LossEvent model losing its RLS pairing (schema column ↔
 *     migration ↔ policies — the rls-coverage suite catches policy
 *     absence; this pins the shape that makes it a tenant-scoped
 *     row in the first place);
 *   - the encryption manifest dropping LossEvent so a future
 *     decryptor reads plaintext narratives off disk (Epic B);
 *   - the usecase losing its sanitisation, audit-event provenance,
 *     or ADMIN-only delete (Epic D.2 + RQ2-1 patterns);
 *   - the predicted-vs-actual surface vanishing from the risks
 *     section (the whole point of the feature is that the
 *     forecasting stack is FALSIFIABLE — hiding the page collapses
 *     it back to theology).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const schema = read('prisma/schema/compliance.prisma');
const enums = read('prisma/schema/enums.prisma');
const migration = read('prisma/migrations/20260612040000_rq3_6_loss_event_register/migration.sql');
const usecase = read('src/app-layer/usecases/loss-event.ts');
const listRoute = read('src/app/api/t/[tenantSlug]/loss-events/route.ts');
const aggregateRoute = read('src/app/api/t/[tenantSlug]/loss-events/aggregate/route.ts');
const itemRoute = read('src/app/api/t/[tenantSlug]/loss-events/[id]/route.ts');
const page = read('src/app/t/[tenantSlug]/(app)/risks/loss-events/page.tsx');
const risksClient = read('src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx');
const encryptionManifest = read('src/lib/security/encrypted-fields.ts');

describe('RQ3-6 — schema + RLS + encryption', () => {
    test('LossEvent model carries tenantId, occurredAt, amount, source, soft-delete', () => {
        expect(schema).toMatch(/^model LossEvent \{/m);
        expect(schema).toMatch(/tenantId\s+String\b/);
        expect(schema).toMatch(/occurredAt\s+DateTime\b/);
        expect(schema).toMatch(/amount\s+Float\b/);
        expect(schema).toMatch(/source\s+LossEventSource\b/);
        expect(schema).toMatch(/deletedAt\s+DateTime\?/);
        expect(enums).toMatch(/enum LossEventSource \{[\s\S]*USER[\s\S]*FINDING[\s\S]*INCIDENT/);
    });

    test('migration creates the table, indexes, and the canonical RLS policies', () => {
        expect(migration).toMatch(/CREATE TABLE "LossEvent"/);
        expect(migration).toMatch(/ALTER TABLE "LossEvent" ENABLE ROW LEVEL SECURITY/);
        expect(migration).toMatch(/ALTER TABLE "LossEvent" FORCE ROW LEVEL SECURITY/);
        expect(migration).toMatch(/CREATE POLICY tenant_isolation ON "LossEvent"/);
        expect(migration).toMatch(/CREATE POLICY tenant_isolation_insert ON "LossEvent"[\s\S]*FOR INSERT WITH CHECK/);
        expect(migration).toMatch(/CREATE POLICY superuser_bypass ON "LossEvent"/);
        expect(migration).toMatch(/CREATE INDEX "LossEvent_tenantId_occurredAt_idx"/);
    });

    test('Epic B encryption manifest covers LossEvent narrative fields', () => {
        expect(encryptionManifest).toMatch(/LossEvent: \['description', 'justification'\]/);
    });
});

describe('RQ3-6 — usecase contract', () => {
    test('createLossEvent sanitises free-text + audits + writes the source/amount provenance', () => {
        expect(usecase).toMatch(/sanitizePlainText/);
        expect(usecase).toMatch(/sanitizeOptional\(input\.description\)/);
        expect(usecase).toMatch(/sanitizeOptional\(input\.justification\)/);
        expect(usecase).toMatch(/action: 'LOSS_EVENT_RECORDED'/);
        expect(usecase).toMatch(/event: 'loss_event_recorded'/);
        expect(usecase).toMatch(/source: created\.source/);
        expect(usecase).toMatch(/amount: created\.amount/);
    });

    test('aggregate emits per-year + per-risk roll-ups (the spine for the overlay)', () => {
        expect(usecase).toMatch(/byYear: Array<\{ year: number; total: number; count: number/);
        expect(usecase).toMatch(/byRisk: Array<\{ riskId: string \| null; total: number; count: number/);
        // The per-year bucket is the calendar year the actual fell into.
        expect(usecase).toMatch(/occurredAt\.getUTCFullYear/);
    });

    test('soft-delete is ADMIN-only — actuals are evidence', () => {
        expect(usecase).toMatch(/export async function deleteLossEvent[\s\S]*assertCanAdmin\(ctx\)/);
        expect(usecase).toMatch(/data: \{ deletedAt: new Date\(\) \}/);
        expect(usecase).toMatch(/action: 'LOSS_EVENT_REMOVED'/);
    });

    test('list + aggregate filter out the soft-deleted rows', () => {
        const occurrences = (usecase.match(/deletedAt: null/g) ?? []).length;
        expect(occurrences).toBeGreaterThanOrEqual(2);
    });
});

describe('RQ3-6 — API surface', () => {
    test('list route exposes GET (list) + POST (record) with the validated body', () => {
        expect(listRoute).toMatch(/export const GET = withApiErrorHandling/);
        expect(listRoute).toMatch(/export const POST = withApiErrorHandling/);
        expect(listRoute).toMatch(/withValidatedBody\(NewSchema/);
        expect(listRoute).toMatch(/occurredAt: z\.string\(\)\.refine/);
        expect(listRoute).toMatch(/amount: z\.number\(\)\.finite\(\)\.nonnegative\(\)/);
        expect(listRoute).toMatch(/source: z\.enum\(\['USER', 'FINDING', 'INCIDENT'\]/);
    });

    test('aggregate + item routes wire the usecase verbs', () => {
        expect(aggregateRoute).toMatch(/getLossEventAggregate/);
        expect(itemRoute).toMatch(/export const DELETE = withApiErrorHandling/);
        expect(itemRoute).toMatch(/deleteLossEvent/);
    });
});

describe('RQ3-6 — the register page surfaces the predicted-vs-actual overlay', () => {
    test('page renders the roll-up, empty-state explanation, the form, and the register', () => {
        expect(page).toMatch(/data-testid="loss-events-rollup"/);
        expect(page).toMatch(/loss-events-empty/);
        // i18n (T06): the empty-state explanation moved to messages.
        expect(page).toMatch(/tle\('noActuals'\)/);
        const en = JSON.parse(read('messages/en.json')) as { riskLossEvents: { noActuals: string } };
        expect(en.riskLossEvents.noActuals).toMatch(/forecasting stack is unfalsifiable/);
        expect(page).toMatch(/loss-events-form/);
        expect(page).toMatch(/loss-events-list/);
        expect(page).toMatch(/loss-events-by-year/);
        expect(page).toMatch(/loss-events-prediction-line/);
    });

    test('the risks header links the new page so people can find it', () => {
        expect(risksClient).toMatch(/href: '\/risks\/loss-events'/);
    });
});
