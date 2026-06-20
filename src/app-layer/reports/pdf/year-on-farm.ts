/**
 * "Year on the farm" PDF Generator
 *
 * A celebratory season-recap report for a farm tenant:
 *   Cover → recap metrics → top-fields table → certification line →
 *   activity-story line.
 *
 * All data is pulled INSIDE this usecase (via `getSeasonRecap` + a thin
 * tenant-name lookup + the same certification derivation the ag-dashboard
 * uses). The route only buffers + ships the returned document — this
 * generator does NOT call `doc.end()` (the route's `collectPdfBuffer`
 * owns finalisation, mirroring the other PDF generators).
 */
import type { RequestContext } from '@/app-layer/types';
import { getSeasonRecap } from '@/app-layer/usecases/season-recap';
import { getEnabledModules } from '@/app-layer/usecases/modules';
import { listSchemes } from '@/app-layer/usecases/certification-scheme';
import { generateReadinessReport } from '@/app-layer/usecases/framework/coverage';
import { createPdfDocument } from '@/lib/pdf/pdfKitFactory';
import { addCoverPage, applyHeadersAndFooters } from '@/lib/pdf/layout';
import { renderTable, autoColumnWidths } from '@/lib/pdf/table';
import { addSectionTitle, addSummaryMetrics, addSpacer, addParagraph } from '@/lib/pdf/sections';
import type { ReportMeta, TableColumn } from '@/lib/pdf/types';
import prisma from '@/lib/prisma';

function fmtNum(n: number | null, suffix = ''): string {
    if (n == null) return '—';
    // Trim trailing zeros for a clean recap display.
    const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
    return `${s}${suffix}`;
}

export async function generateYearOnFarmPdf(
    ctx: RequestContext,
    opts?: { seasonId?: string },
): Promise<PDFKit.PDFDocument> {
    // ─── Pull data (inside the usecase) ──────────────────────────────
    const recap = await getSeasonRecap(ctx, opts?.seasonId);

    const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { name: true },
    });
    const tenantName = tenant?.name || 'Tenant';

    // Certification readiness — reuse the ag-dashboard derivation: top
    // AG_SCHEME by key (listSchemes orders asc), gated on the module so a
    // non-certified tenant pays no readiness query.
    let certification: { schemeName: string; score: number } | null = null;
    const enabledModules = await getEnabledModules(ctx);
    if (enabledModules.includes('CERTIFICATION')) {
        const schemes = await listSchemes(ctx);
        const top = schemes[0];
        if (top) {
            const report = await generateReadinessReport(ctx, top.key);
            certification = { schemeName: top.name, score: report.summary.readinessScore };
        }
    }

    // ─── Meta ─────────────────────────────────────────────────────────
    const yearLabel = recap.year != null ? String(recap.year) : 'All time';
    const meta: ReportMeta = {
        tenantName,
        reportTitle: `Year on the farm — ${tenantName} ${yearLabel}`,
        reportSubtitle: recap.seasonName ?? 'Season recap',
        generatedAt: new Date().toISOString(),
        watermark: 'NONE',
    };

    // ─── Build PDF ──────────────────────────────────────────────────
    const doc = createPdfDocument(meta);

    addCoverPage(doc, meta);
    doc.addPage();

    // Recap metrics
    addSectionTitle(doc, 'Season recap');
    addSummaryMetrics(doc, [
        { label: 'Total area (ha)', value: fmtNum(recap.totalAreaHa) },
        { label: 'Total yield (t)', value: fmtNum(recap.totalYieldTonnes) },
        { label: 'Avg yield (t/ha)', value: fmtNum(recap.avgYieldTPerHa) },
        { label: 'Cost per ha', value: fmtNum(recap.costPerHa) },
    ]);
    addSpacer(doc);

    // Top fields table
    addSectionTitle(doc, 'Top fields');
    if (recap.topFields.length > 0) {
        const widths = autoColumnWidths([3, 1.4, 1.4, 1.4]);
        const columns: TableColumn[] = [
            { key: 'name', header: 'Field', width: widths[0] },
            { key: 'yieldTonnes', header: 'Yield (t)', width: widths[1], align: 'right' },
            { key: 'areaHa', header: 'Area (ha)', width: widths[2], align: 'right' },
            { key: 'tPerHa', header: 't/ha', width: widths[3], align: 'right' },
        ];
        const rows = recap.topFields.map((f) => ({
            name: f.name,
            yieldTonnes: fmtNum(f.yieldTonnes),
            areaHa: fmtNum(f.areaHa),
            tPerHa: fmtNum(f.tPerHa),
        }));
        renderTable(doc, columns, rows);
    } else {
        addParagraph(doc, 'No harvest yet recorded for this scope.');
    }
    addSpacer(doc);

    // Certification line
    addSectionTitle(doc, 'Certification');
    if (certification) {
        addParagraph(
            doc,
            `${certification.schemeName} readiness: ${certification.score}%.`,
        );
    } else {
        addParagraph(doc, 'No certification scheme tracked.');
    }
    addSpacer(doc);

    // Activity story line
    addSectionTitle(doc, 'Your story');
    const scopeLabel = recap.seasonName ? `the ${recap.seasonName} season` : 'your time on the farm';
    addParagraph(
        doc,
        recap.activityCount > 0
            ? `You logged ${recap.activityCount} field ${recap.activityCount === 1 ? 'activity' : 'activities'} across ${scopeLabel} — every one a step in the story of this farm.`
            : `No field activities logged yet for ${scopeLabel} — the story starts with your first log entry.`,
    );

    applyHeadersAndFooters(doc, meta);

    // NOTE: do NOT call doc.end() — the route's collectPdfBuffer finalises.
    return doc;
}
