/**
 * Test Hardening — Evidence integrity, audit pack snapshots, secure exports
 *
 * linkEvidenceWithHash()       — links evidence with SHA-256 hash stored at link-time
 * verifyRunEvidence()          — re-computes hashes and checks against stored values
 * snapshotTestRun()            — creates immutable AuditPackItem for a test run
 * exportTestEvidenceBundle()   — generates CSV/JSON export of runs + evidence
 */
import { RequestContext } from '../types';
import { assertCanReadTests, assertCanLinkTestEvidence } from '../policies/test.policies';
import { assertCanManageAuditPacks } from '../policies/audit-readiness.policies';
import { logEvent } from '../events/audit';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { notFound, badRequest } from '@/lib/errors/types';
import { verifyFileIntegrity } from './audit-hardening';

// ─── Evidence Integrity ───

/**
 * Link evidence to a test run with SHA-256 hash for FILE-kind.
 * Wraps the standard link flow, adds integrity metadata.
 */
export async function linkEvidenceWithHash(
    ctx: RequestContext,
    runId: string,
    input: {
        kind: 'FILE' | 'EVIDENCE' | 'LINK' | 'INTEGRATION_RESULT';
        fileId?: string | null;
        evidenceId?: string | null;
        url?: string | null;
        integrationResultId?: string | null;
        note?: string | null;
    },
) {
    assertCanLinkTestEvidence(ctx);

    return runInTenantContext(ctx, async (db: PrismaTx) => {
        const run = await db.controlTestRun.findFirst({
            where: { id: runId, tenantId: ctx.tenantId },
        });
        if (!run) throw notFound('Test run not found');

        // Compute hash for FILE-kind evidence
        let sha256Hash: string | null = null;
        if (input.kind === 'FILE' && input.fileId) {
            try {
                const result = await verifyFileIntegrity(ctx, input.fileId);
                sha256Hash = result.computedHash;
            } catch {
                // File may not exist yet or not be accessible; proceed without hash
                sha256Hash = null;
            }
        }

        const link = await db.controlTestEvidenceLink.create({
            data: {
                tenantId: ctx.tenantId,
                testRunId: runId,
                kind: input.kind,
                fileId: input.fileId ?? null,
                evidenceId: input.evidenceId ?? null,
                url: input.url ?? null,
                integrationResultId: input.integrationResultId ?? null,
                note: input.note ?? null,
                sha256Hash,
                createdByUserId: ctx.userId,
            },
        });

        await logEvent(db, ctx, {
            action: 'TEST_EVIDENCE_LINKED_WITH_HASH',
            entityType: 'ControlTestEvidenceLink',
            entityId: link.id,
            details: JSON.stringify({
            detailsJson: { category: 'relationship', operation: 'linked', sourceEntity: 'ControlTestEvidenceLink' },
                testRunId: runId,
                kind: input.kind,
                sha256Hash,
                fileId: input.fileId,
            }),
        });

        return link;
    });
}

/**
 * Verify all FILE-kind evidence on a test run by re-computing SHA-256.
 */
export async function verifyRunEvidence(ctx: RequestContext, runId: string) {
    assertCanReadTests(ctx);

    return runInTenantContext(ctx, async (db: PrismaTx) => {
        const run = await db.controlTestRun.findFirst({
            where: { id: runId, tenantId: ctx.tenantId },
            include: {
                evidence: true,
                testPlan: { select: { name: true } },
            },
        });
        if (!run) throw notFound('Test run not found');

        interface VerificationResult {
            linkId: string;
            kind: string;
            fileId: string | null;
            storedHash: string | null;
            computedHash: string | null;
            matches: boolean | null;
            error: string | null;
        }

        const results: VerificationResult[] = [];

        for (const ev of run.evidence) {
            if (ev.kind === 'FILE' && ev.fileId) {
                try {
                    const integrity = await verifyFileIntegrity(ctx, ev.fileId);
                    results.push({
                        linkId: ev.id,
                        kind: ev.kind,
                        fileId: ev.fileId,
                        storedHash: ev.sha256Hash,
                        computedHash: integrity.computedHash,
                        matches: ev.sha256Hash ? integrity.computedHash === ev.sha256Hash : null,
                        error: null,
                    });
                } catch (e: unknown) {
                    results.push({
                        linkId: ev.id,
                        kind: ev.kind,
                        fileId: ev.fileId,
                        storedHash: ev.sha256Hash,
                        computedHash: null,
                        matches: null,
                        error: e instanceof Error ? e.message : 'Unknown error',
                    });
                }
            } else {
                results.push({
                    linkId: ev.id,
                    kind: ev.kind,
                    fileId: ev.fileId,
                    storedHash: ev.sha256Hash,
                    computedHash: null,
                    matches: null,
                    error: null,
                });
            }
        }

        const allFileLinksVerified = results
            .filter(r => r.kind === 'FILE')
            .every(r => r.matches === true || r.matches === null);

        return {
            runId,
            planName: run.testPlan?.name,
            totalLinks: results.length,
            fileLinks: results.filter(r => r.kind === 'FILE').length,
            verified: results.filter(r => r.matches === true).length,
            mismatches: results.filter(r => r.matches === false).length,
            unverifiable: results.filter(r => r.kind === 'FILE' && r.matches === null).length,
            integrityOk: allFileLinksVerified,
            details: results,
        };
    });
}

// ─── Audit Pack Snapshot ───

/**
 * Create immutable snapshot of a test run in an audit pack.
 * Pack must not be FROZEN (snapshots are added to DRAFT packs, then frozen).
 */
export async function snapshotTestRun(ctx: RequestContext, runId: string, packId: string) {
    assertCanManageAuditPacks(ctx);

    return runInTenantContext(ctx, async (db: PrismaTx) => {
        // Verify pack exists and is not frozen
        const pack = await db.auditPack.findFirst({
            where: { id: packId, tenantId: ctx.tenantId },
        });
        if (!pack) throw notFound('Audit pack not found');
        if (pack.status === 'FROZEN' || pack.status === 'EXPORTED') {
            throw badRequest('Cannot add items to a frozen/exported pack');
        }

        // Get run with full details for snapshot
        const run = await db.controlTestRun.findFirst({
            where: { id: runId, tenantId: ctx.tenantId },
            include: {
                testPlan: {
                    select: { id: true, name: true, method: true, frequency: true },
                },
                control: {
                    select: { id: true, name: true, code: true },
                },
                executedBy: { select: { name: true, email: true } },
                evidence: {
                    select: {
                        id: true, kind: true, fileId: true, url: true,
                        sha256Hash: true, note: true,
                    },
                },
            },
        });
        if (!run) throw notFound('Test run not found');
        if (run.status !== 'COMPLETED') throw badRequest('Can only snapshot completed test runs');

        // Build immutable snapshot JSON
        const snapshotJson = JSON.stringify({
            snapshotVersion: 1,
            capturedAt: new Date().toISOString(),
            testRun: {
                id: run.id,
                status: run.status,
                result: run.result,
                executedAt: run.executedAt?.toISOString?.() ?? run.executedAt,
                notes: run.notes,
                findingSummary: run.findingSummary,
                executedBy: run.executedBy
                    ? { name: run.executedBy.name, email: run.executedBy.email }
                    : null,
            },
            testPlan: run.testPlan
                ? { id: run.testPlan.id, name: run.testPlan.name, method: run.testPlan.method, frequency: run.testPlan.frequency }
                : null,
            control: run.control
                ? { id: run.control.id, name: run.control.name, code: run.control.code }
                : null,
            evidence: run.evidence.map((ev: Record<string, unknown>) => ({
                id: ev.id,
                kind: ev.kind,
                fileId: ev.fileId,
                url: ev.url,
                sha256Hash: ev.sha256Hash,
                note: ev.note,
            })),
            evidenceHashes: run.evidence
                .filter((ev: Record<string, unknown>) => ev.sha256Hash)
                .map((ev: Record<string, unknown>) => ({
                    fileId: ev.fileId,
                    sha256: ev.sha256Hash,
                })),
        });

        // Check for duplicate
        const existing = await db.auditPackItem.findFirst({
            where: {
                auditPackId: packId,
                entityType: 'TEST_RUN',
                entityId: runId,
            },
        });
        if (existing) throw badRequest('This test run is already in the audit pack');

        // Get max sort order
        const lastItem = await db.auditPackItem.findFirst({
            where: { auditPackId: packId },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
        });
        const sortOrder = (lastItem?.sortOrder ?? 0) + 1;

        const item = await db.auditPackItem.create({
            data: {
                tenantId: ctx.tenantId,
                auditPackId: packId,
                entityType: 'TEST_RUN',
                entityId: runId,
                snapshotJson,
                sortOrder,
            },
        });

        await logEvent(db, ctx, {
            action: 'TEST_RUN_SNAPSHOT_ADDED_TO_PACK',
            entityType: 'AuditPackItem',
            entityId: item.id,
            details: JSON.stringify({ runId, packId, result: run.result }),
            detailsJson: { category: 'custom', event: 'test_run_snapshot_added_to_pack' },
        });

        return item;
    });
}

// ─── Export ───

interface ExportOptions {
    controlId?: string;
    format?: 'csv' | 'json';
    periodDays?: number;
}

/**
 * Export test evidence bundle as CSV or JSON.
 */
export async function exportTestEvidenceBundle(ctx: RequestContext, options: ExportOptions) {
    assertCanReadTests(ctx);

    return runInTenantContext(ctx, async (db: PrismaTx) => {
        const where: Record<string, unknown> = { tenantId: ctx.tenantId };
        if (options.controlId) where.controlId = options.controlId;
        if (options.periodDays) {
            const since = new Date();
            since.setDate(since.getDate() - options.periodDays);
            where.createdAt = { gte: since };
        }

        const runs = await db.controlTestRun.findMany({
            where,
            include: {
                testPlan: { select: { name: true, method: true, frequency: true } },
                control: { select: { id: true, name: true, code: true } },
                executedBy: { select: { name: true, email: true } },
                evidence: {
                    select: {
                        id: true, kind: true, fileId: true, url: true,
                        sha256Hash: true, note: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        const rows = runs.map((run) => ({
            runId: run.id,
            controlCode: run.control?.code || '',
            controlName: run.control?.name || '',
            planName: run.testPlan?.name || '',
            method: run.testPlan?.method || '',
            frequency: run.testPlan?.frequency || '',
            status: run.status,
            result: run.result || '',
            executedAt: run.executedAt?.toISOString?.() ?? run.executedAt ?? '',
            executedBy: run.executedBy?.email || '',
            notes: run.notes || '',
            findingSummary: run.findingSummary || '',
            evidenceCount: run.evidence?.length || 0,
            evidenceHashes: run.evidence
                ?.filter((e) => e.sha256Hash)
                .map((e) => `${e.fileId}:${e.sha256Hash}`)
                .join('; ') || '',
        }));

        if (options.format === 'csv') {
            if (rows.length === 0) return 'No test runs found.\n';
            const headers = Object.keys(rows[0]);
            const csvLines = [
                headers.join(','),
                ...rows.map(row =>
                    headers.map(h => {
                        const val = String((row as Record<string, unknown>)[h] ?? '');
                        return val.includes(',') || val.includes('"') || val.includes('\n')
                            ? `"${val.replace(/"/g, '""')}"`
                            : val;
                    }).join(',')
                ),
            ];
            return csvLines.join('\n') + '\n';
        }

        return rows;
    });
}
