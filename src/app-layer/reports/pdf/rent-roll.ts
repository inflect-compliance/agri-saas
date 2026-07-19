/**
 * Rent-roll PDF (roadmap 3/3) — a Cyrillic land-obligations report: leased
 * area + rent per lessor, and contracts expiring within 90 days. Built on the
 * shared PDFKit factory with `fontFamily: 'unicode'` (DejaVu Sans) so Cyrillic
 * renders; every `.font(...)` uses UNICODE_FONT[_BOLD]. Returns the doc WITHOUT
 * calling `.end()` — the route's `collectPdfBuffer` finalises it.
 */
import { createPdfDocument, UNICODE_FONT, UNICODE_FONT_BOLD } from '@/lib/pdf/pdfKitFactory';
import type { ReportMeta } from '@/lib/pdf/types';
import type { RequestContext } from '../../types';
import { runInTenantContext } from '@/lib/db-context';
import { getRentRoll } from '../../usecases/rent-roll';
import { REPORT_DAYS } from '@/lib/agro/lease-expiry';
import { rentTotalSuffix } from '@/lib/agro/rent-units';

const INK = '#0f172a';
const MUTED = '#64748b';
const RULE = '#cbd5e1';

function num(n: number): string {
    return new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 2 }).format(n);
}

interface Col {
    header: string;
    width: number;
    align?: 'left' | 'right';
}

/** Minimal ruled table with a bold header row + hairline row rules + paging. */
function drawTable(doc: PDFKit.PDFDocument, cols: Col[], rows: string[][]): void {
    const m = doc.page.margins;
    const rowH = 18;
    let y = doc.y;
    const row = (cells: string[], bold: boolean) => {
        if (y + rowH > doc.page.height - m.bottom) {
            doc.addPage();
            y = doc.page.margins.top;
        }
        let x = m.left;
        doc.font(bold ? UNICODE_FONT_BOLD : UNICODE_FONT).fontSize(9).fillColor(INK);
        cols.forEach((c, i) => {
            doc.text(cells[i] ?? '', x + 3, y + 5, {
                width: c.width - 6,
                align: c.align ?? 'left',
                ellipsis: true,
                lineBreak: false,
            });
            x += c.width;
        });
        doc.moveTo(m.left, y + rowH).lineTo(x, y + rowH).strokeColor(RULE).lineWidth(0.5).stroke();
        y += rowH;
    };
    row(cols.map((c) => c.header), true);
    rows.forEach((r) => row(r, false));
    doc.y = y + 8;
    doc.x = m.left;
}

export async function generateRentRollPdf(
    ctx: RequestContext,
    opts: { locationId?: string } = {},
): Promise<PDFKit.PDFDocument> {
    const data = await getRentRoll(ctx, { expiringWithinDays: REPORT_DAYS, locationId: opts.locationId });
    const tenantName = await runInTenantContext(ctx, (db) =>
        db.tenant
            .findFirst({ where: { id: ctx.tenantId }, select: { name: true } })
            .then((tn) => tn?.name ?? 'Farm'),
    );

    const generatedAt = new Date().toISOString();
    const meta: ReportMeta = {
        tenantName,
        reportTitle: 'Ведомост за наеми и задължения',
        reportSubtitle: tenantName,
        generatedAt,
        watermark: 'NONE',
        fontFamily: 'unicode',
    };
    const doc = createPdfDocument(meta);
    const m = doc.page.margins;
    const contentW = doc.page.width - m.left - m.right;

    // Title + generated date.
    doc.font(UNICODE_FONT_BOLD).fontSize(16).fillColor(INK).text(meta.reportTitle, m.left, m.top, { width: contentW });
    doc.font(UNICODE_FONT).fontSize(9).fillColor(MUTED).text(
        `${tenantName} · ${generatedAt.slice(0, 10)}`,
        m.left,
        doc.y + 2,
        { width: contentW },
    );
    doc.moveDown(1);

    // Summary line.
    // Season totals are rendered PER UNIT — money and produce are never summed.
    const totalsLabel =
        data.totals.length > 0
            ? data.totals.map((s) => `${num(s.total)} ${rentTotalSuffix(s.unit)}`.trim()).join(' · ')
            : '—';
    const outstandingLabel =
        data.totals.length > 0
            ? data.totals.map((s) => `${num(s.outstanding)} ${rentTotalSuffix(s.unit)}`.trim()).join(' · ')
            : '—';
    doc.font(UNICODE_FONT).fontSize(10).fillColor(INK).text(
        `Наета площ: ${num(data.totalLeasedDca)} дка   ·   Собственици: ${data.lessorCount}   ·   ` +
            `Договори: ${data.activeLeaseCount}   ·   Рента/сезон: ${totalsLabel}   ·   ` +
            `Оставащо (${data.seasonYear}): ${outstandingLabel}`,
        m.left,
        doc.y,
        { width: contentW },
    );
    doc.moveDown(1);

    // Rent by lessor.
    doc.font(UNICODE_FONT_BOLD).fontSize(11).fillColor(INK).text('Наеми по собственик', m.left, doc.y);
    doc.moveDown(0.4);
    if (data.byLessor.length === 0) {
        doc.font(UNICODE_FONT).fontSize(9).fillColor(MUTED).text('Няма регистрирани наеми.', m.left, doc.y, { width: contentW });
    } else {
        drawTable(
            doc,
            [
                { header: 'Собственик', width: contentW * 0.26 },
                { header: 'ЕИК', width: contentW * 0.12 },
                { header: 'Дог.', width: contentW * 0.07, align: 'right' },
                { header: 'Площ (дка)', width: contentW * 0.13, align: 'right' },
                { header: 'Рента/сезон', width: contentW * 0.15, align: 'right' },
                { header: 'Ед.', width: contentW * 0.09 },
                { header: 'Платено', width: contentW * 0.09, align: 'right' },
                { header: 'Оставащо', width: contentW * 0.09, align: 'right' },
            ],
            // A row is one (lessor × unit) pair, so its unit labels its own
            // figures — no лв is asserted over a кг/дка obligation.
            data.byLessor.map((l) => [
                l.lessorName,
                l.lessorEik ?? '—',
                String(l.leaseCount),
                num(l.leasedDca),
                l.rentTotal != null ? num(l.rentTotal) : '—',
                l.rentUnit ?? '—',
                num(l.paid),
                num(l.outstanding),
            ]),
        );
    }
    doc.moveDown(0.6);

    // Expiring contracts.
    doc.font(UNICODE_FONT_BOLD).fontSize(11).fillColor(INK).text('Изтичащи договори (90 дни)', m.left, doc.y);
    doc.moveDown(0.4);
    if (data.expiringSoon.length === 0) {
        doc.font(UNICODE_FONT).fontSize(9).fillColor(MUTED).text('Няма изтичащи договори в следващите 90 дни.', m.left, doc.y, { width: contentW });
    } else {
        drawTable(
            doc,
            [
                { header: 'Парцел', width: contentW * 0.3 },
                { header: 'Собственик', width: contentW * 0.34 },
                { header: 'Вид', width: contentW * 0.14 },
                { header: 'Изтича', width: contentW * 0.14 },
                { header: 'Дни', width: contentW * 0.08, align: 'right' },
            ],
            data.expiringSoon.map((e) => [
                e.parcelName,
                e.lessorName,
                e.kind === 'ARENDA' ? 'Аренда' : 'Наем',
                e.endDate,
                String(e.daysLeft),
            ]),
        );
    }

    // NOTE: do NOT call doc.end() — the route's collectPdfBuffer finalises.
    return doc;
}
