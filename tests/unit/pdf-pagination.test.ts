/**
 * Regression guards for the PDF pagination + numbering fix.
 *
 * Pre-fix bug: `addFooter` rendered two text strings at
 * `y = PAGE_HEIGHT - 30 = 811.89`, which is below the bottom margin
 * (`PAGE_HEIGHT - MARGINS.bottom = 791.89`). PDFKit's `text()`
 * auto-paginates if `doc.y` ends past the bottom margin after a
 * write. The first footer text put `doc.y` past the margin; the
 * second text write triggered auto-paginate. The
 * `applyHeadersAndFooters` loop ran once per page → N pages → N
 * blank trailing pages.
 *
 * These tests build minimal pdfkit documents that mirror the
 * stamping pass and assert:
 *   • the final page count equals the input page count
 *   • the page-number range stamped on numbered pages is contiguous
 *   • the "X of N" labels match the actual numbered-page total
 *   • the cover page (index 0) is NOT stamped with a page number
 *
 * The library is pdfkit directly — not `generateAuditReadinessPdf`
 * — so the test doesn't need Prisma / SoA fixtures. The pagination
 * primitive is what the bug lives in; both Audit Readiness and SoA
 * PDFs flow through this same `applyHeadersAndFooters` helper.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- pdfkit lacks types for some internal probes. */

import PDFDocument from 'pdfkit';
import { applyHeadersAndFooters } from '@/lib/pdf/layout';
import type { ReportMeta } from '@/lib/pdf/types';

function buildDoc(contentPages: number): PDFKit.PDFDocument {
    // contentPages includes the cover. e.g., contentPages=3 means
    // cover + metadata + 1 SoA page.
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
    });
    // pdfkit emits 'data' events as soon as it has a flushed page;
    // drain them so the doc doesn't hold an internal stream open.
    doc.on('data', () => {});

    // First page is created by the constructor.
    doc.fontSize(20).text('Cover', 50, 100);
    for (let i = 1; i < contentPages; i++) {
        doc.addPage();
        doc.fontSize(14).text(`Content page ${i}`, 50, 100);
    }
    return doc;
}

function countPageMarkers(doc: PDFKit.PDFDocument): Promise<number> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => {
            const buf = Buffer.concat(chunks);
            const ms = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
            resolve(ms.length);
        });
        doc.on('error', reject);
        doc.end();
    });
}

function makeMeta(overrides: Partial<ReportMeta> = {}): ReportMeta {
    return {
        tenantName: 'Test Tenant',
        reportTitle: 'Test Report',
        reportSubtitle: 'Test Subtitle',
        generatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
        framework: 'ISO27001',
        watermark: 'NONE',
        ...overrides,
    };
}

describe('PDF pagination — applyHeadersAndFooters', () => {
    it('a 1-page document (cover only) stays 1 page', async () => {
        // Edge case — only a cover, no content. The loop should
        // skip the cover (no footer) and produce no extra pages.
        const doc = buildDoc(1);
        applyHeadersAndFooters(doc, makeMeta());
        expect(await countPageMarkers(doc)).toBe(1);
    });

    it('a 3-page document (cover + 2 content) stays 3 pages', async () => {
        // Pre-fix this produced 6 pages (3 + 3 trailing blanks).
        const doc = buildDoc(3);
        applyHeadersAndFooters(doc, makeMeta());
        expect(await countPageMarkers(doc)).toBe(3);
    });

    it('a 10-page document stays 10 pages (long-report regression)', async () => {
        // Mimics a fully-populated Audit Readiness Report (93 SoA
        // rows spread across ~7 content pages + cover + metadata).
        // Pre-fix: 20 pages (10 trailing blanks).
        const doc = buildDoc(10);
        applyHeadersAndFooters(doc, makeMeta());
        expect(await countPageMarkers(doc)).toBe(10);
    });

    it('count is stable under repeated invocation (idempotent stamp)', async () => {
        // Edge case — calling the stamper twice (e.g., a future
        // refactor accidentally double-wires it). Even if the
        // count grows, the second pass must not explode it
        // further by triggering the same auto-paginate cascade.
        const doc = buildDoc(3);
        applyHeadersAndFooters(doc, makeMeta());
        // Second invocation — the buffered range now reflects
        // the post-first-pass state (still 3). It should stay 3.
        applyHeadersAndFooters(doc, makeMeta());
        expect(await countPageMarkers(doc)).toBe(3);
    });

    it('runs cleanly when meta carries a contentHash (long footer string)', async () => {
        // The contentHash appends `| Hash: <12 chars>…` to the
        // CONFIDENTIAL string. A longer footer line is more likely
        // to push doc.y past the bottom margin if `height:` is
        // omitted — this guard catches a future regression that
        // strips the option.
        const doc = buildDoc(5);
        applyHeadersAndFooters(doc, makeMeta({
            contentHash: 'a'.repeat(64),
        }));
        expect(await countPageMarkers(doc)).toBe(5);
    });

    it('runs cleanly with a DRAFT watermark (watermark adds an extra text call per page)', async () => {
        // The watermark write is a 60pt text rotated 35°. Without
        // `height:` it could also auto-paginate. The fix applies
        // to addWatermark too.
        const doc = buildDoc(4);
        applyHeadersAndFooters(doc, makeMeta({ watermark: 'DRAFT' }));
        expect(await countPageMarkers(doc)).toBe(4);
    });

    it('runs cleanly with a FINAL watermark + contentHash combined', async () => {
        const doc = buildDoc(5);
        applyHeadersAndFooters(doc, makeMeta({
            watermark: 'FINAL',
            contentHash: 'b'.repeat(64),
        }));
        expect(await countPageMarkers(doc)).toBe(5);
    });
});

describe('PDF pagination — page number convention', () => {
    /**
     * Probe the page-number convention by capturing every text
     * write into a synthetic doc. The cover (index 0) must get NO
     * page-number text. Numbered pages must show "Page i of M"
     * where M = total - 1 (cover excluded from numbering).
     */
    function probeFooters(contentPages: number): { covers: string[]; numberStrings: string[] } {
        const doc = buildDoc(contentPages);
        // Spy on text() — record every call's `text` argument plus
        // the index of the page we're currently switched-to.
        const numberStrings: string[] = [];
        const covers: string[] = [];
        const originalText = doc.text.bind(doc);
        let currentPage = 0;
        const originalSwitch = doc.switchToPage.bind(doc);
        (doc as any).switchToPage = (i: number) => {
            currentPage = i;
            return originalSwitch(i);
        };
        (doc as any).text = (str: string, ...rest: any[]): any => {
            if (typeof str === 'string' && /^Page \d+ of \d+$/.test(str)) {
                if (currentPage === 0) covers.push(str);
                else numberStrings.push(str);
            }
            return originalText(str, ...rest);
        };
        applyHeadersAndFooters(doc, makeMeta());
        doc.end();
        return { covers, numberStrings };
    }

    it('the cover page never receives a "Page X of N" footer', () => {
        const { covers } = probeFooters(5);
        // Compliance contract: the cover is a title page; numbering
        // starts on the first content page so the SoA reader sees
        // "Page 1 of 4" on the metadata page, not "Page 2 of 5".
        expect(covers).toHaveLength(0);
    });

    it('numbered pages count from 1 up through total-minus-cover, with consistent N', () => {
        // 5 pages total = 1 cover + 4 numbered. Footers should
        // read "Page 1 of 4", "Page 2 of 4", "Page 3 of 4", "Page 4 of 4".
        const { numberStrings } = probeFooters(5);
        expect(numberStrings).toEqual([
            'Page 1 of 4',
            'Page 2 of 4',
            'Page 3 of 4',
            'Page 4 of 4',
        ]);
    });

    it('a tiny document (cover + 1 numbered page) reads "Page 1 of 1"', () => {
        const { numberStrings } = probeFooters(2);
        expect(numberStrings).toEqual(['Page 1 of 1']);
    });

    it('a cover-only document produces no page-number footers at all', () => {
        const { covers, numberStrings } = probeFooters(1);
        expect(covers).toHaveLength(0);
        expect(numberStrings).toHaveLength(0);
    });
});
