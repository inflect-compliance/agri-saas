/**
 * Epic 54 — Create Risk modal migration.
 *
 * Node-env jest can't render .tsx, so this suite source-inspects the
 * migrated surface:
 *
 *   1. `NewRiskModal` exists, uses the shared <Modal> primitives, and
 *      composes Body / Actions via <Modal.Form>.
 *   2. The legacy wizard's business contract is preserved byte-for-byte
 *      (POST payload shape, templateId pass-through, sequential control
 *      linking, cache invalidation).
 *   3. Scoring UX invariants — range inputs, computed score, risk badge.
 *   4. `/risks/new` is now a server redirect shim to `/risks?create=1`.
 *   5. `RisksClient` wires the trigger + auto-opens on `?create=1`.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');
function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

const MODAL_SRC = read(
    'src/app/t/[tenantSlug]/(app)/risks/NewRiskModal.tsx',
);
const SHARED_SRC = read(
    'src/app/t/[tenantSlug]/(app)/risks/_shared/RiskEvaluationFields.tsx',
);
const CLIENT_SRC = read(
    'src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx',
);
const NEW_PAGE_SRC = read(
    'src/app/t/[tenantSlug]/(app)/risks/new/page.tsx',
);

// ─── 1. Modal composition ────────────────────────────────────────

describe('NewRiskModal — shared Modal composition', () => {
    it('is a client component', () => {
        expect(MODAL_SRC).toMatch(/^'use client'/);
    });

    it('imports the shared Modal primitive', () => {
        expect(MODAL_SRC).toMatch(/from ['"]@\/components\/ui\/modal['"]/);
        expect(MODAL_SRC).not.toMatch(/fixed inset-0 bg-black/);
    });

    it('renders <Modal.Form> + <Modal.Body> + <Modal.Actions>', () => {
        expect(MODAL_SRC).toMatch(/<Modal\.Form\b/);
        expect(MODAL_SRC).toMatch(/<Modal\.Body\b/);
        expect(MODAL_SRC).toMatch(/<Modal\.Actions\b/);
    });

    it('uses size="lg" so the form breathes', () => {
        expect(MODAL_SRC).toMatch(/size=["']lg["']/);
    });

    it('passes title + description for a11y naming', () => {
        // i18n (T06): title + description now resolve through next-intl.
        expect(MODAL_SRC).toMatch(/title=\{tn\('title'\)\}/);
        expect(MODAL_SRC).toMatch(/description=\{tn\('(description|headerDescription)'\)\}/);
    });

    it('guards close-during-save via preventDefaultClose={submitting}', () => {
        expect(MODAL_SRC).toMatch(/preventDefaultClose=\{submitting\}/);
    });
});

// ─── 2. Preserved form IDs (legacy wizard continuity) ────────────

describe('NewRiskModal — preserved form IDs', () => {
    const REQUIRED_IDS = [
        'risk-title',
        'risk-category',
        'risk-description',
        'risk-owner',
        'risk-review-date',
        'submit-risk',
    ];

    it.each(REQUIRED_IDS)('preserves id="%s"', (id) => {
        expect(MODAL_SRC).toMatch(new RegExp(`id=["']${id}["']`));
    });

    it('adds an explicit cancel affordance', () => {
        expect(MODAL_SRC).toMatch(/id=["']new-risk-cancel-btn["']/);
    });
});

// ─── 3. Business contract preserved ──────────────────────────────

describe('NewRiskModal — business contract preserved', () => {
    it('POSTs to /risks with the documented payload shape', () => {
        expect(MODAL_SRC).toMatch(/apiUrl\(['"]\/risks['"]\)/);
        expect(MODAL_SRC).toMatch(/method:\s*['"]POST['"]/);
        for (const field of [
            'title',
            'description',
            'category',
            'likelihood',
            'impact',
            'ownerUserId',
            'treatment',
            'treatmentNotes',
        ]) {
            expect(MODAL_SRC).toMatch(new RegExp(`${field}:`));
        }
    });

    it('passes templateId through when a template is selected', () => {
        expect(MODAL_SRC).toMatch(/selectedTemplate/);
        expect(MODAL_SRC).toMatch(
            /payload\.templateId\s*=\s*selectedTemplate\.id/,
        );
    });

    it('serialises nextReviewAt to ISO when supplied', () => {
        expect(MODAL_SRC).toMatch(
            /new Date\([\s\S]*?form\.nextReviewAt[\s\S]*?\)\.toISOString\(\)/,
        );
    });

    it('links selected controls via sequential POST /risks/:id/controls', () => {
        expect(MODAL_SRC).toMatch(
            /apiUrl\(`\/risks\/\$\{risk\.id\}\/controls`\)/,
        );
        expect(MODAL_SRC).toMatch(/for \(const controlId of selectedControlIds/);
    });

    it('invalidates queryKeys.risks.all(tenantSlug) on success', () => {
        expect(MODAL_SRC).toMatch(/queryKeys\.risks\.all\(tenantSlug\)/);
        expect(MODAL_SRC).toMatch(/invalidateQueries/);
    });

    it('closes the modal on success (no full-page redirect)', () => {
        // The legacy wizard did `router.push(href('/risks'))`. The modal
        // is already layered over the list, so close() is enough.
        expect(MODAL_SRC).toMatch(/close\(\);/);
        expect(MODAL_SRC).not.toMatch(/router\.push\(/);
    });
});

// ─── 4. Scoring UX invariants ────────────────────────────────────

describe('NewRiskModal — scoring UX (shared RiskEvaluationFields)', () => {
    it('mounts the shared <RiskEvaluationFields> evaluation box', () => {
        expect(MODAL_SRC).toMatch(/<RiskEvaluationFields\b/);
        // Titled "Risk Evaluation" (R5) — the title lives in the shared box.
        // i18n (T06): the literal moved to messages; the box renders t('title').
        expect(SHARED_SRC).toMatch(/useTranslations\('riskEvaluation'\)/);
        expect(SHARED_SRC).toMatch(/\{t\('title'\)\}/);
    });

    it('the shared box exposes likelihood + impact as 1–5 range inputs', () => {
        expect(SHARED_SRC).toMatch(
            /id=\{`\$\{idPrefix\}-likelihood`\}[\s\S]{0,200}type=["']range["']/,
        );
        expect(SHARED_SRC).toMatch(
            /id=\{`\$\{idPrefix\}-impact`\}[\s\S]{0,200}type=["']range["']/,
        );
        expect(SHARED_SRC).toMatch(/min=\{1\}\s+max=\{5\}/);
    });

    it('computes the score as likelihood × impact and drives the badge', () => {
        expect(SHARED_SRC).toMatch(
            /const score\s*=\s*likelihood\s*\*\s*impact/,
        );
        expect(SHARED_SRC).toMatch(/getRiskBadge\(score\)/);
        expect(SHARED_SRC).toMatch(/data-testid=\{`\$\{idPrefix\}-score-preview`\}/);
    });

    it('gates submit behind non-empty title + not submitting', () => {
        expect(MODAL_SRC).toMatch(
            /form\.title\.trim\(\)\.length\s*>\s*0[\s\S]{0,60}!submitting/,
        );
    });

    it('disables the whole fieldset during an in-flight create', () => {
        expect(MODAL_SRC).toMatch(
            /<fieldset[\s\S]{0,120}disabled=\{submitting\}/,
        );
    });
});

// ─── 5. Legacy /risks/new → redirect shim ───────────────────────

describe('/risks/new — redirect compat shim', () => {
    it('is no longer a client page', () => {
        expect(NEW_PAGE_SRC).not.toMatch(/^'use client'/m);
    });

    it('performs a server redirect to /risks?create=1 for the tenant', () => {
        expect(NEW_PAGE_SRC).toMatch(/from ['"]next\/navigation['"]/);
        expect(NEW_PAGE_SRC).toMatch(/redirect\(/);
        expect(NEW_PAGE_SRC).toMatch(/\/risks\?create=1/);
    });

    it('awaits the async params promise (Next.js 15 convention)', () => {
        expect(NEW_PAGE_SRC).toMatch(
            /params:\s*Promise<\{\s*tenantSlug:\s*string\s*\}>/,
        );
        expect(NEW_PAGE_SRC).toMatch(/await params/);
    });
});

// ─── 6. RisksClient wiring ──────────────────────────────────────

describe('RisksClient — modal entry + auto-open', () => {
    it('imports NewRiskModal', () => {
        // Accept both static and dynamic imports (lazy-loading via next/dynamic)
        const hasImport = /from ['"]\.\/NewRiskModal['"]/.test(CLIENT_SRC) ||
            /import\(['"]\.\/NewRiskModal['"]\)/.test(CLIENT_SRC);
        expect(hasImport).toBe(true);
    });

    it('turned #new-risk-btn into a modal trigger (no more Link)', () => {
        expect(CLIENT_SRC).toMatch(
            /onClick=\{\(\)\s*=>\s*setIsCreateOpen\(true\)\}/,
        );
        expect(CLIENT_SRC).toMatch(/id=["']new-risk-btn["']/);
        // Drift sentinel — Link-to-/risks/new must not come back.
        expect(CLIENT_SRC).not.toMatch(
            /href=\{tenantHref\(['"]\/risks\/new['"]\)\}/,
        );
    });

    it('mounts <NewRiskModal> with controlled state + tenant helpers', () => {
        expect(CLIENT_SRC).toMatch(/<NewRiskModal\b/);
        expect(CLIENT_SRC).toMatch(/open=\{isCreateOpen\}/);
        expect(CLIENT_SRC).toMatch(/setOpen=\{setIsCreateOpen\}/);
        expect(CLIENT_SRC).toMatch(/tenantSlug=\{tenantSlug\}/);
        expect(CLIENT_SRC).toMatch(/apiUrl=\{apiUrl\}/);
    });

    it('auto-opens when the URL carries ?create=1 and strips the flag', () => {
        expect(CLIENT_SRC).toMatch(/useSearchParams/);
        expect(CLIENT_SRC).toMatch(
            /searchParams\?\.get\(['"]create['"]\)\s*===\s*['"]1['"]/,
        );
        expect(CLIENT_SRC).toMatch(/router\.replace/);
        expect(CLIENT_SRC).toMatch(/next\.delete\(['"]create['"]\)/);
    });
});
