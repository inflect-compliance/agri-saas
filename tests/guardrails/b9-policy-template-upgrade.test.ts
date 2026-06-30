/**
 * B9 — Policy template upgrade ratchet.
 *
 *   1. The PDF helper module `src/lib/pdf/policyLayout.ts` exists
 *      and exports the contract the report module depends on:
 *      cover-page helper, TOC helper, section-title helper, body-
 *      paragraph helper, the classification type + label map.
 *
 *   2. The classification chip is rendered via PDFKit's
 *      `roundedRect(...).fill(...)` and the chip text is stamped
 *      with the `height:` cell-lock that prevents the documented
 *      pdfkit auto-paginate trap (see `STAMP_TEXT_HEIGHT` in
 *      layout.ts).
 *
 *   3. The clickable TOC wires each row through
 *      `addNamedDestination` + the `goTo:` text option, NOT a raw
 *      external URL — internal-document links are the supported
 *      shape.
 *
 *   4. The generator at
 *      `src/app-layer/reports/pdf/policyDocument.ts` composes
 *      cover → TOC → body in that order, forces a page break
 *      between sections, and runs the shared
 *      `applyHeadersAndFooters` stamping pass at the end.
 *
 *   5. The API route `GET /api/t/<slug>/policies/<id>/export`
 *      streams the PDF + `Content-Type: application/pdf` + a
 *      `Content-Disposition: attachment` and emits a
 *      `POLICY_EXPORTED` audit-log event.
 *
 *   6. The policy detail page surfaces an `Export PDF` action in
 *      the page-header actions slot.
 *
 *   7. The PDF stamping helpers in policyLayout pass `height:` on
 *      every multi-write line — the load-bearing
 *      `pdf-stamp-height-pinning` invariant generalised to the
 *      new module.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B9 — policy template upgrade', () => {
    describe('policyLayout primitive', () => {
        const src = read('src/lib/pdf/policyLayout.ts');

        it('exports the four helper entry points', () => {
            expect(src).toMatch(/export function addPolicyCoverPage/);
            expect(src).toMatch(/export function addPolicyToc/);
            expect(src).toMatch(/export function addPolicySectionTitle/);
            expect(src).toMatch(/export function addPolicyBodyParagraph/);
        });

        it('exports the PolicyClassification union + label map', () => {
            expect(src).toMatch(/export type PolicyClassification/);
            expect(src).toMatch(/CLASSIFICATION_LABEL/);
            // Four canonical levels — PUBLIC / INTERNAL /
            // CONFIDENTIAL / RESTRICTED — must all be present.
            expect(src).toMatch(/PUBLIC/);
            expect(src).toMatch(/INTERNAL/);
            expect(src).toMatch(/CONFIDENTIAL/);
            expect(src).toMatch(/RESTRICTED/);
        });

        it('cover page renders a classification chip + brand wordmark', () => {
            expect(src).toMatch(/Agrent/);
            expect(src).toMatch(/roundedRect/);
            expect(src).toMatch(/CLASSIFICATION_COLOUR/);
        });

        it('cover stamps the chip label with the height: pdfkit cell-lock', () => {
            // The chip label is a second text() write on the same
            // page; without `height:` it would re-trigger the
            // auto-paginate trap (cf. STAMP_TEXT_HEIGHT in
            // layout.ts).
            expect(src).toMatch(/chipLabel[\s\S]{0,400}height:\s*16/);
        });

        it('cover ends with addPage so the TOC starts on a fresh page', () => {
            // Anchor on the trailing `addPage()` so future refactors
            // can't drop the page break and bleed the cover into the
            // TOC.
            expect(src).toMatch(/addPolicyCoverPage[\s\S]{0,4000}doc\.addPage\(\)/);
        });

        it('TOC routes each row through goTo (internal link)', () => {
            // `goTo:` is the supported internal-link option on
            // PDFKit's TextOptions. A raw `link:` URL would not
            // resolve inside the PDF.
            expect(src).toMatch(/goTo:\s*entry\.destName/);
            expect(src).not.toMatch(/link:\s*\{\s*goTo/);
        });

        it('section helper registers a named destination', () => {
            // Without `addNamedDestination` the goTo link annotations
            // emitted by the TOC have no target — the link clicks
            // silently no-op.
            expect(src).toMatch(/addNamedDestination\(destName\)/);
        });
    });

    describe('policyDocument generator', () => {
        const src = read('src/app-layer/reports/pdf/policyDocument.ts');

        it('exports a single async generator function', () => {
            expect(src).toMatch(/export async function generatePolicyDocumentPdf/);
        });

        it('composes cover → TOC → body, in that order', () => {
            // Anchor on the call-site shape (`(doc, ...)`) so import
            // statements at the top of the file don't false-match.
            const cover = src.indexOf('addPolicyCoverPage(doc');
            const toc = src.indexOf('addPolicyToc(doc');
            const sectionTitle = src.indexOf('addPolicySectionTitle(doc');
            expect(cover).toBeGreaterThan(0);
            expect(toc).toBeGreaterThan(cover);
            expect(sectionTitle).toBeGreaterThan(toc);
        });

        it('forces a page break between sections', () => {
            // `if (i > 0) doc.addPage()` is the canonical shape.
            expect(src).toMatch(/if\s*\(\s*i\s*>\s*0\s*\)\s*doc\.addPage\(\)/);
        });

        it('runs the shared header/footer stamping pass at the end', () => {
            // The chrome stamping has to happen AFTER every page is
            // written or the `bufferedPageRange()` count is wrong.
            expect(src).toMatch(/applyHeadersAndFooters\(doc/);
        });

        it('asserts read permission before fetching the policy', () => {
            expect(src).toMatch(/assertCanRead\(ctx\)/);
        });
    });

    describe('export API route', () => {
        const route = read(
            'src/app/api/t/[tenantSlug]/policies/[id]/export/route.ts',
        );

        it('is a GET handler running on the Node runtime', () => {
            expect(route).toMatch(/export const GET/);
            expect(route).toMatch(/export const runtime = ['"]nodejs['"]/);
        });

        it('gates on the PDF_EXPORTS feature flag', () => {
            expect(route).toMatch(
                /requireFeature\(ctx\.tenantId,\s*FEATURES\.PDF_EXPORTS\)/,
            );
        });

        it('streams the PDF with the expected response headers', () => {
            expect(route).toMatch(/['"]Content-Type['"]:\s*['"]application\/pdf['"]/);
            expect(route).toMatch(/Content-Disposition/);
            expect(route).toMatch(/attachment/);
        });

        it('audit logging is delegated to the usecase, not inline in the route', () => {
            // `policy-routes-guardrail.test.ts` forbids `logEvent`
            // inside policy routes; the POLICY_EXPORTED audit row
            // is written by `generatePolicyDocumentPdf` itself.
            expect(route).not.toMatch(/logEvent\s*\(/);
        });

        it('usecase writes the POLICY_EXPORTED audit-trail event', () => {
            const usecase = read(
                'src/app-layer/reports/pdf/policyDocument.ts',
            );
            expect(usecase).toMatch(/action:\s*['"]POLICY_EXPORTED['"]/);
        });

        it('accepts the classification query string', () => {
            expect(route).toMatch(/searchParams\.get\(['"]classification['"]\)/);
        });
    });

    describe('Export button on the policy detail page', () => {
        const page = read(
            'src/app/t/[tenantSlug]/(app)/policies/[policyId]/page.tsx',
        );

        it('renders the Export PDF anchor with a stable testid', () => {
            expect(page).toMatch(/data-testid="export-policy-pdf-btn"/);
        });

        it('Export anchor points at the export API route', () => {
            expect(page).toMatch(
                /apiUrl\(`\/policies\/\$\{policyId\}\/export`\)/,
            );
        });
    });
});
