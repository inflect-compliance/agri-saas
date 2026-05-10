/**
 * Roadmap-7 PR-1 — Primary action budget ratchet.
 *
 * Premium products (Linear, Stripe, Vercel) consistently render ONE
 * primary button per visible region. IC's audit found pages with 4
 * primaries on the same screen — when "primary" is used wherever
 * someone wanted a button to look "important," the page loses its
 * center of gravity and the primary tone reads as "active button,"
 * not "the action."
 *
 * The rule cannot be "max 1 primary per file" because a file with a
 * page-header CTA AND an inline create form legitimately has TWO
 * regions, each with their own submit. So we lock the per-file count
 * at the current production value with a one-way ratchet: counts may
 * decrease over time, never increase. New primary buttons must be
 * paired with demotions of equivalent emphasis elsewhere in the file
 * — or the contributor must justify the file's place in BUDGET via
 * an explicit raise of the cap with a written reason.
 *
 * Pairs with R5-PR7 (inline-form action ordering — locks the
 * `secondary` Cancel + `primary` submit pattern in inline forms) and
 * R6-PR8 (Cancel button variant — Cancel is always `secondary`,
 * never ghost).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["src/app", "src/components"];

const EXEMPT_DIR_NAMES = new Set<string>([
    "node_modules",
    "__tests__",
    "__mocks__",
]);
const EXEMPT_FILE_PATTERNS: RegExp[] = [
    /\.test\.tsx?$/,
    /\.spec\.tsx?$/,
    /\.stories\.tsx?$/,
];

/**
 * BUDGET — per-file ceiling on `<Button variant="primary">`. Values
 * are baselined at the count after Roadmap-7 PR-1 demoted obvious
 * status-change / row-action primaries to secondary. Any file not
 * listed has an implicit budget of 1 (the canonical "one primary
 * per page action zone" rule).
 *
 * Future PRs may LOWER any number in this map — that's the
 * direction of travel. RAISING a number requires a comment
 * documenting which new region was introduced and why it qualifies
 * as a separate visual zone.
 */
const PRIMARY_BUDGET: Record<string, number> = {
    // Heavy detail pages — page-header CTA + multiple modal CTAs
    "src/app/t/[tenantSlug]/(app)/controls/[controlId]/page.tsx": 10,
    "src/app/t/[tenantSlug]/(app)/vendors/[vendorId]/page.tsx": 9,

    // Cross-entity link/unlink panel — multiple pairwise actions
    "src/components/TraceabilityPanel.tsx": 6,

    // Multi-step wizard — each step has its own region/submit
    "src/components/onboarding/OnboardingWizard.tsx": 6,

    // Org-level list with multiple modal CTAs (invite/edit/remove)
    "src/app/org/[orgSlug]/(app)/members/MembersTable.tsx": 5,

    // Detail pages with edit/save flows + child modals
    "src/app/t/[tenantSlug]/(app)/policies/[policyId]/page.tsx": 4,
    "src/app/t/[tenantSlug]/(app)/admin/vendor-templates/[templateId]/VendorTemplateBuilderClient.tsx": 4,

    // 3-primary tier — page CTA + inline form + 1 contextual region
    "src/app/t/[tenantSlug]/(app)/tests/runs/[runId]/page.tsx": 3,
    "src/app/t/[tenantSlug]/(app)/tasks/[taskId]/page.tsx": 3,
    "src/app/t/[tenantSlug]/(app)/risks/ai/page.tsx": 3,
    "src/app/t/[tenantSlug]/(app)/controls/[controlId]/tests/[planId]/page.tsx": 3,
    "src/app/t/[tenantSlug]/(app)/admin/members/page.tsx": 3,
    "src/app/t/[tenantSlug]/(app)/admin/api-keys/page.tsx": 3,

    // 2-primary tier — page CTA + inline form (R5-PR7 pattern)
    "src/components/ui/HeroMetric.tsx": 2,
    "src/components/TestPlansPanel.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/vendors/[vendorId]/assessment/[assessmentId]/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/tests/due/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/security/mfa/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/reports/soa/SoAClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/frameworks/[frameworkKey]/templates/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/findings/FindingsClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/evidence/EvidenceClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/audits/packs/[packId]/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/audits/cycles/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/audits/AuditsClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/assets/AssetsClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/admin/scim/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/admin/roles/page.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/admin/risk-matrix/RiskMatrixAdminClient.tsx": 2,
    "src/app/t/[tenantSlug]/(app)/admin/integrations/page.tsx": 2,

    // R9-PR6 migrated the `+ Control` button-shape buttonVariants()
    // to <Button>, which makes the existing primary visible to this
    // ratchet. Plus the templates-install Link in the same row (also
    // primary). Two header CTAs side-by-side is the controls list
    // page's canonical shape.
    "src/app/t/[tenantSlug]/(app)/controls/ControlsClient.tsx": 2,
};

const DEFAULT_BUDGET = 1;

function isExempt(rel: string): boolean {
    const segments = rel.split(path.sep);
    if (segments.some((s) => EXEMPT_DIR_NAMES.has(s))) return true;
    if (EXEMPT_FILE_PATTERNS.some((rx) => rx.test(rel))) return true;
    return false;
}

function walk(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(ROOT, full);
        if (isExempt(rel)) continue;
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.tsx$/.test(entry.name)) out.push(full);
    }
    return out;
}

function countPrimaries(content: string): number {
    // Match <Button variant="primary"> or variant='primary'.
    // Single-line and JSX-multi-line attribute splits both caught.
    // `[\s\S]` instead of `.` so newlines match without needing the
    // `s` (dotAll) regex flag — that flag requires the regex engine
    // target to be ES2018+ which our tsconfig does not enable.
    const matches = content.match(
        /<Button\b[\s\S]*?\bvariant=["']primary["']/g,
    );
    return matches ? matches.length : 0;
}

interface Violation {
    file: string;
    actual: number;
    budget: number;
}

describe("primary action budget", () => {
    it("no file exceeds its primary-button budget", () => {
        const violations: Violation[] = [];
        for (const dir of SCAN_DIRS) {
            for (const file of walk(path.join(ROOT, dir))) {
                const content = fs.readFileSync(file, "utf8");
                const count = countPrimaries(content);
                if (count === 0) continue;
                const rel = path.relative(ROOT, file);
                const budget = PRIMARY_BUDGET[rel] ?? DEFAULT_BUDGET;
                if (count > budget) {
                    violations.push({ file: rel, actual: count, budget });
                }
            }
        }
        if (violations.length > 0) {
            const sample = violations
                .slice(0, 15)
                .map(
                    (v) =>
                        `  ${v.file}\n    actual: ${v.actual}, budget: ${v.budget}`,
                )
                .join("\n");
            throw new Error(
                `Found ${violations.length} file(s) over the primary-button budget. Demote duplicate primaries to secondary, or — if a new visual region was added that legitimately needs its own primary — raise the budget in PRIMARY_BUDGET with a comment explaining the new region.\n\n${sample}`,
            );
        }
        expect(violations).toHaveLength(0);
    });

    it("budget map is sorted and self-consistent", () => {
        // Every entry must have a budget >= 2; a budget of 1 IS the
        // default and entries don't need to be listed.
        for (const [file, budget] of Object.entries(PRIMARY_BUDGET)) {
            expect(budget).toBeGreaterThanOrEqual(2);
            // Path uses forward slashes (POSIX style).
            expect(file).not.toMatch(/\\\\/);
        }
    });
});
