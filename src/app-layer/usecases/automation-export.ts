/**
 * Automation canvas export (Visual Rule Editor VR-8).
 *
 * Turns an automation-mode process map into governance documentation: a
 * structured "Compliance Evidence Pack" (rules + 30-day execution aggregates)
 * suitable for attaching to an ISO 27001 audit pack or a SOC 2 evidence
 * request. The same assembled data backs the PDF "Workflow Diagram" export
 * (rendered through the existing process-export pipeline).
 *
 * The aggregation core (`summarizeRuleExecutions`) is pure + unit-tested.
 */
import { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { notFound } from '@/lib/errors/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RuleEvidence {
    id: string;
    name: string;
    triggerEvent: string;
    status: string;
    executionCount: number;
    successRate: number;
    lastTriggeredAt: string | null;
    chainedRuleId: string | null;
}

export interface EvidencePack {
    exportedAt: string;
    processMapId: string;
    processMapName: string;
    rules: RuleEvidence[];
    executions30d: { total: number; succeeded: number; failed: number };
}

interface ExecRow {
    ruleId: string;
    status: string;
    createdAt: Date;
}
interface RuleRow {
    id: string;
    name: string;
    triggerEvent: string;
    status: string;
    executionCount: number;
    lastTriggeredAt: Date | null;
    nextRuleId: string | null;
}

/**
 * Pure aggregator: fold 30-day execution rows into per-rule evidence +
 * a tenant-wide 30-day rollup. `successRate` is succeeded / (terminal runs);
 * a rule with no terminal runs in the window reports 0.
 */
export function summarizeRuleExecutions(
    rules: RuleRow[],
    execs: ExecRow[],
): { rules: RuleEvidence[]; executions30d: EvidencePack['executions30d'] } {
    const byRule = new Map<string, { succeeded: number; failed: number }>();
    let total = 0;
    let succeeded = 0;
    let failed = 0;
    for (const e of execs) {
        const slot = byRule.get(e.ruleId) ?? { succeeded: 0, failed: 0 };
        if (e.status === 'SUCCEEDED') {
            slot.succeeded++;
            succeeded++;
        } else if (e.status === 'FAILED') {
            slot.failed++;
            failed++;
        }
        total++;
        byRule.set(e.ruleId, slot);
    }
    const ruleEvidence: RuleEvidence[] = rules.map((r) => {
        const s = byRule.get(r.id) ?? { succeeded: 0, failed: 0 };
        const terminal = s.succeeded + s.failed;
        return {
            id: r.id,
            name: r.name,
            triggerEvent: r.triggerEvent,
            status: r.status,
            executionCount: r.executionCount,
            successRate: terminal > 0 ? s.succeeded / terminal : 0,
            lastTriggeredAt: r.lastTriggeredAt ? r.lastTriggeredAt.toISOString() : null,
            chainedRuleId: r.nextRuleId,
        };
    });
    return { rules: ruleEvidence, executions30d: { total, succeeded, failed } };
}

/**
 * Assemble the evidence pack for an automation-mode process map. Rules of the
 * map = the AutomationRules its action nodes reference (VR-3 link).
 */
export async function buildAutomationEvidencePack(
    ctx: RequestContext,
    processMapId: string,
    now: Date,
): Promise<EvidencePack> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const map = await db.processMap.findFirst({
            where: { id: processMapId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!map) throw notFound('Process map not found');

        const nodes = await db.processNode.findMany({
            where: { processMapId, tenantId: ctx.tenantId, nodeType: 'action' },
            select: { dataJson: true },
        });
        const ruleIds = nodes
            .map((n) => (n.dataJson as { ruleId?: unknown } | null)?.ruleId)
            .filter((id): id is string => typeof id === 'string');

        if (ruleIds.length === 0) {
            return {
                exportedAt: now.toISOString(),
                processMapId: map.id,
                processMapName: map.name,
                rules: [],
                executions30d: { total: 0, succeeded: 0, failed: 0 },
            };
        }

        const since = new Date(now.getTime() - THIRTY_DAYS_MS);
        const [rules, execs] = await Promise.all([
            db.automationRule.findMany({
                where: { id: { in: ruleIds }, tenantId: ctx.tenantId },
                select: {
                    id: true,
                    name: true,
                    triggerEvent: true,
                    status: true,
                    executionCount: true,
                    lastTriggeredAt: true,
                    nextRuleId: true,
                },
            }),
            db.automationExecution.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    ruleId: { in: ruleIds },
                    createdAt: { gte: since },
                },
                select: { ruleId: true, status: true, createdAt: true },
                take: 5000,
            }),
        ]);

        const summary = summarizeRuleExecutions(rules, execs);
        return {
            exportedAt: now.toISOString(),
            processMapId: map.id,
            processMapName: map.name,
            ...summary,
        };
    });
}
