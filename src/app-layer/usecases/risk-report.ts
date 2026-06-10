/**
 * RQ-10 — executive risk reporting (capstone).
 *
 * Assembles data from across the risk-quantification surfaces (portfolio
 * ALE + top risks + Monte Carlo VaR + appetite + BIA) and renders a
 * board-ready PDF/CSV, stored via the file provider with a ReportRun
 * lifecycle row. Plus template + schedule management.
 *
 * @module usecases/risk-report
 */
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { Prisma } from '@prisma/client';
import { notFound, badRequest } from '@/lib/errors/types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { resolveALE } from './fair-calculator';
import { getLatestSimulation } from './monte-carlo';
import { getAppetiteStatus } from './risk-appetite';
import { renderCsv, renderPdf, type ReportData } from '../reports/risk-report-render';
import { getStorageProvider, generatePathKey } from '@/lib/storage';

export type ReportFormat = 'PDF' | 'CSV';

export interface ReportParameters {
    confidenceLevel?: number;
    riskId?: string;
}

// ── Data assembly ─────────────────────────────────────────────────────

export async function assembleReportData(ctx: RequestContext, title: string): Promise<ReportData> {
    const [risks, latestSim, appetite, tenant] = await Promise.all([
        runInTenantContext(ctx, (db) =>
            db.risk.findMany({
                where: { tenantId: ctx.tenantId, deletedAt: null },
                select: { title: true, category: true, fairAle: true, sleAmount: true, aroAmount: true, rtoHours: true, rpoHours: true, revenueAtRisk: true },
                take: 10000,
            }),
        ),
        getLatestSimulation(ctx),
        getAppetiteStatus(ctx),
        // Tenant is global (no RLS) — resolve the display name for the report header.
        runInTenantContext(ctx, (db) => db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } })),
    ]);

    let totalAle = 0, quantifiedCount = 0, maxAle = 0, withRto = 0, withRpo = 0, totalRevenueAtRisk = 0;
    const quantified: Array<{ title: string; category: string | null; ale: number }> = [];
    for (const r of risks) {
        const ale = resolveALE({ fairAle: r.fairAle, sleAmount: r.sleAmount, aroAmount: r.aroAmount });
        if (ale != null) { totalAle += ale; quantifiedCount++; if (ale > maxAle) maxAle = ale; quantified.push({ title: r.title, category: r.category, ale }); }
        if (r.rtoHours != null) withRto++;
        if (r.rpoHours != null) withRpo++;
        if (r.revenueAtRisk != null) totalRevenueAtRisk += r.revenueAtRisk;
    }
    const topRisks = quantified.sort((a, b) => b.ale - a.ale).slice(0, 10);

    return {
        title,
        tenantName: tenant?.name ?? ctx.tenantId,
        generatedAt: new Date().toISOString(),
        totals: { totalRiskCount: risks.length, quantifiedCount, totalAle, avgAle: quantifiedCount > 0 ? totalAle / quantifiedCount : null, maxAle: quantifiedCount > 0 ? maxAle : null },
        var: latestSim ? { mean: latestSim.portfolioMean, p95: latestSim.portfolioP95, p99: latestSim.portfolioP99 } : null,
        appetite: appetite.status === 'NONE' ? null : { status: appetite.status, portfolioAle: appetite.portfolioAle },
        topRisks,
        bia: { withRto, withRpo, totalRevenueAtRisk },
    };
}

// ── Templates ─────────────────────────────────────────────────────────

const SYSTEM_TEMPLATES = [
    { name: 'Portfolio Risk Summary', type: 'PORTFOLIO_SUMMARY', description: 'Executive VaR + top risks + appetite + BIA.' },
    { name: 'Risk Deep Dive', type: 'RISK_DEEP_DIVE', description: 'Single-risk FAIR decomposition + history.' },
    { name: 'Business Impact Analysis', type: 'BIA', description: 'RTO/RPO/MTPD + impact + revenue at risk.' },
];

/** List templates, lazily seeding the 3 system templates for the tenant. */
export async function listTemplates(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const existing = await db.reportTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' }, take: 200 });
        const haveSystem = new Set(existing.filter((t) => t.isSystem).map((t) => t.type));
        const missing = SYSTEM_TEMPLATES.filter((t) => !haveSystem.has(t.type));
        if (missing.length === 0) return existing;
        await db.reportTemplate.createMany({
            data: missing.map((t) => ({ tenantId: ctx.tenantId, name: t.name, description: t.description, type: t.type, configJson: {} as Prisma.InputJsonValue, isSystem: true })),
        });
        return db.reportTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' }, take: 200 });
    });
}

export async function createTemplate(ctx: RequestContext, input: { name: string; type: string; description?: string; configJson?: Record<string, unknown> }) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, (db) =>
        db.reportTemplate.create({ data: { tenantId: ctx.tenantId, name: input.name, type: input.type, description: input.description ?? null, configJson: (input.configJson ?? {}) as Prisma.InputJsonValue, isSystem: false } }),
    );
}

// ── Generation ────────────────────────────────────────────────────────

export async function generateReport(ctx: RequestContext, templateId: string, parameters: ReportParameters, format: ReportFormat) {
    assertCanWrite(ctx);
    const template = await runInTenantContext(ctx, (db) => db.reportTemplate.findFirst({ where: { id: templateId, tenantId: ctx.tenantId } }));
    if (!template) throw notFound('Report template not found');

    const run = await runInTenantContext(ctx, (db) =>
        db.reportRun.create({ data: { tenantId: ctx.tenantId, templateId, parametersJson: parameters as unknown as Prisma.InputJsonValue, format, status: 'GENERATING', requestedBy: ctx.userId, startedAt: new Date() } }),
    );

    try {
        const data = await assembleReportData(ctx, template.name);
        const buffer = format === 'CSV' ? renderCsv(data) : await renderPdf(data);
        const ext = format === 'CSV' ? 'csv' : 'pdf';
        const pathKey = generatePathKey(ctx.tenantId, `report-${run.id}.${ext}`);
        await getStorageProvider().write(pathKey, buffer, { mimeType: format === 'CSV' ? 'text/csv' : 'application/pdf' });
        return runInTenantContext(ctx, (db) =>
            db.reportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', outputPath: pathKey, outputSizeBytes: buffer.length, completedAt: new Date() } }),
        );
    } catch (err) {
        await runInTenantContext(ctx, (db) =>
            db.reportRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date() } }),
        );
        throw err;
    }
}

export async function getReport(ctx: RequestContext, reportRunId: string) {
    assertCanRead(ctx);
    const r = await runInTenantContext(ctx, (db) => db.reportRun.findFirst({ where: { id: reportRunId, tenantId: ctx.tenantId } }));
    if (!r) throw notFound('Report run not found');
    return r;
}

export async function listReports(ctx: RequestContext, opts: { limit?: number } = {}) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => db.reportRun.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: Math.min(opts.limit ?? 50, 200) }));
}

// ── Schedules ─────────────────────────────────────────────────────────

/** Next run instant for a cadence (pure). */
export function computeNextRun(cadence: string, from: Date): Date {
    const d = new Date(from);
    if (cadence === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
    else if (cadence === 'QUARTERLY') d.setUTCMonth(d.getUTCMonth() + 3);
    else d.setUTCMonth(d.getUTCMonth() + 1); // MONTHLY default
    return d;
}

export interface CreateScheduleInput { templateId: string; cadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'; format?: ReportFormat; recipients: string[]; parameters?: ReportParameters; deliveryDay?: number }

export async function createSchedule(ctx: RequestContext, input: CreateScheduleInput) {
    assertCanWrite(ctx);
    if (!input.recipients?.length) throw badRequest('At least one recipient is required');
    return runInTenantContext(ctx, (db) =>
        db.reportSchedule.create({
            data: {
                tenantId: ctx.tenantId, templateId: input.templateId, cadence: input.cadence, format: input.format ?? 'PDF',
                recipientsJson: input.recipients as unknown as Prisma.InputJsonValue, parametersJson: (input.parameters ?? {}) as unknown as Prisma.InputJsonValue,
                deliveryDay: input.deliveryDay ?? null, isActive: true, nextRunAt: computeNextRun(input.cadence, new Date()),
            },
        }),
    );
}

export async function updateSchedule(ctx: RequestContext, scheduleId: string, patch: { isActive?: boolean; cadence?: string; recipients?: string[] }) {
    assertCanWrite(ctx);
    await runInTenantContext(ctx, (db) =>
        db.reportSchedule.updateMany({
            where: { id: scheduleId, tenantId: ctx.tenantId },
            data: {
                ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
                ...(patch.cadence ? { cadence: patch.cadence } : {}),
                ...(patch.recipients ? { recipientsJson: patch.recipients as unknown as Prisma.InputJsonValue } : {}),
            },
        }),
    );
}

export async function deleteSchedule(ctx: RequestContext, scheduleId: string) {
    assertCanWrite(ctx);
    await runInTenantContext(ctx, (db) => db.reportSchedule.deleteMany({ where: { id: scheduleId, tenantId: ctx.tenantId } }));
}

export async function listSchedules(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => db.reportSchedule.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 200 }));
}
