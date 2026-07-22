/**
 * Prompt B — a promotion lead is contact PII bound for a third party.
 *
 * Three properties, asserted where they are cheap and deterministic (the RLS
 * behaviour itself needs a database and lives in
 * tests/integration/promotion-lead-rls.test.ts):
 *
 *   B1  no lead may exist without recorded consent
 *   B2  the farmer's message is ciphertext at rest
 *   B3  the table is inside the RLS ratchet rather than silently outside it
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CreatePromotionLeadSchema } from '@/app-layer/schemas/promotions.schemas';
import { ENCRYPTED_FIELDS } from '@/lib/security/encrypted-fields';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SCHEMA_PRISMA = read('prisma/schema/promotions.prisma');
const USECASE_SRC = read('src/app-layer/usecases/promotions.ts');
const MIGRATION = read(
    'prisma/migrations/20260721090000_promotion_lead_consent_rls/migration.sql',
);

describe('B1 — no lead without recorded consent', () => {
    const valid = { promotionId: 'p1', message: 'need urea', consent: true } as const;

    it('accepts a request carrying affirmative consent', () => {
        expect(CreatePromotionLeadSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects a request with consent omitted', () => {
        const { consent: _omit, ...withoutConsent } = valid;
        expect(CreatePromotionLeadSchema.safeParse(withoutConsent).success).toBe(false);
    });

    it('rejects consent: false — declining is not a variation of the request', () => {
        expect(CreatePromotionLeadSchema.safeParse({ ...valid, consent: false }).success).toBe(
            false,
        );
    });

    it('the usecase re-checks consent, not just the HTTP edge', () => {
        // The usecase is reachable from jobs and future callers that never pass
        // through the zod schema, so the edge check alone is not the guarantee.
        expect(USECASE_SRC).toMatch(/if \(input\.consent !== true\)/);
        expect(USECASE_SRC).toMatch(/consentedAt/);
    });

    it('consentedAt is NOT NULL — the column is the enforcement point', () => {
        // `consentedAt DateTime?` would let a caller that forgets to set it
        // write a lead with no provable consent.
        expect(SCHEMA_PRISMA).toMatch(/consentedAt\s+DateTime(?!\?)/);
    });

    it('the migration backfills before tightening, so it survives a populated DB', () => {
        const addIdx = MIGRATION.indexOf('ADD COLUMN IF NOT EXISTS "consentedAt"');
        const backfillIdx = MIGRATION.indexOf('SET "consentedAt" = "createdAt"');
        const notNullIdx = MIGRATION.indexOf('ALTER COLUMN "consentedAt" SET NOT NULL');
        expect(addIdx).toBeGreaterThan(-1);
        expect(backfillIdx).toBeGreaterThan(addIdx);
        expect(notNullIdx).toBeGreaterThan(backfillIdx);
    });
});

describe('B2 — the message is encrypted at rest', () => {
    it('the farmer message field is in the Epic B manifest', () => {
        expect(ENCRYPTED_FIELDS.PromotionLead).toContain('requestMessage');
    });

    it('the encrypted field name is MODEL-UNIQUE, not the shared `message`', () => {
        // The middleware's fan-out encrypt path matches a FLAT set of field
        // names across the whole manifest — it cannot tell which model a key
        // belongs to. `message` is shared by Notification / ExchangeInquiry /
        // InsuranceLead, so putting that name in the manifest silently
        // encrypted their columns too (a Notification came back as `v1:…`).
        expect(ENCRYPTED_FIELDS.PromotionLead).not.toContain('message');
        expect(SCHEMA_PRISMA).toMatch(/requestMessage\s+String\s+@map\("message"\)/);
    });

    it('no manifest entry claims the shared `message` name', () => {
        // Guards the specific regression: `message` is carried by Notification,
        // ExchangeInquiry and InsuranceLead, none of which are encrypted. If any
        // model ever adds it to the manifest, the fan-out encrypt path will
        // start writing ciphertext into those three columns.
        for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
            expect(`${model}:${fields.join(',')}`).not.toMatch(/(^|,)message(,|$)/);
        }
    });

    it('is NOT on the global KEK — it keeps per-tenant key isolation', () => {
        // `Company` contacts are global-KEK because support writes them inside
        // the platform tenant. A lead is the opposite: the farmer's own words,
        // written in the farmer's tenant context, so it belongs under that
        // tenant's DEK. Adding it to GLOBAL_KEK_MODELS would bind one tenant's
        // PII to a key the whole platform can read.
        const middleware = read('src/lib/db/encryption-middleware.ts');
        const globalModels = middleware.match(/GLOBAL_KEK_MODELS[^;]+;/)?.[0] ?? '';
        expect(globalModels).not.toContain('PromotionLead');
    });

    it('carries deletedAt so contact PII can be retired', () => {
        expect(SCHEMA_PRISMA).toMatch(/deletedAt\s+DateTime\?/);
    });
});

describe('B3 — the table is inside the RLS ratchet', () => {
    it('the migration enables + FORCEs RLS and adds both policies', () => {
        expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
        expect(MIGRATION).toMatch(/FORCE\s+ROW LEVEL SECURITY/);
        expect(MIGRATION).toMatch(/CREATE POLICY promotion_lead_inquirer_isolation/);
        expect(MIGRATION).toMatch(/CREATE POLICY superuser_bypass/);
    });

    it('the policy is symmetric — USING and WITH CHECK both constrain the tenant', () => {
        // USING alone would block reads but still permit writing/moving a row
        // into another tenant.
        expect(MIGRATION).toMatch(/USING\s+\("inquirerTenantId" = current_setting/);
        expect(MIGRATION).toMatch(/WITH CHECK \("inquirerTenantId" = current_setting/);
    });

    it('is registered in the rls-coverage guardrail, not silently outside it', () => {
        const guard = read('tests/guardrails/rls-coverage.test.ts');
        expect(guard).toMatch(/CROSS_TENANT_SCOPED_MODELS/);
        expect(guard).toMatch(/'PromotionLead',\s*'promotion_lead_inquirer_isolation'/);
    });
});
