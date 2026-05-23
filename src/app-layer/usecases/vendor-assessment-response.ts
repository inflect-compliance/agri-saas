/**
 * Epic G-3 — Vendor-facing response usecases.
 *
 * Two entry points underpin the public response flow:
 *
 *   • loadResponseByToken — verify the share-link token and return
 *     the assessment + template tree + the respondent's existing
 *     answers (and ONLY their own — no cross-tenant data leaks).
 *
 *   • submitResponse — final validation + transactional persistence.
 *     Validates required-field presence and per-answer-type shape,
 *     upserts answer rows, transitions status SENT/IN_PROGRESS →
 *     SUBMITTED, computes the provisional score sum.
 *
 * Both usecases live OUTSIDE the authenticated app layer — they
 * never touch the user-bound `RequestContext`. The public route
 * handlers call them directly with the raw token.
 *
 * @module usecases/vendor-assessment-response
 */
import { prisma } from '@/lib/prisma';
import {
    verifyAccessToken,
    type AccessVerificationFailure,
} from '@/lib/security/external-assessment-access';
import { logEvent } from '../events/audit';
import { runWithAuditContext } from '@/lib/audit-context';
import type { RequestContext } from '../types';
import { enqueueEmail } from '../notifications/enqueue';
import { logger } from '@/lib/observability/logger';

/** Synthetic audit ctx for the public response flow. */
function makeExternalAuditCtx(
    tenantId: string,
    assessmentId: string,
): RequestContext {
    return {
        tenantId,
        userId: 'external-respondent',
        requestId: `vendor-assessment-submit:${assessmentId}`,
        role: 'EDITOR' as const,
        permissions: {
            canRead: true,
            canWrite: true,
            canAdmin: false,
            canAudit: false,
            canExport: false,
        },
        appPermissions: {} as never,
    };
}

// ─── Types ─────────────────────────────────────────────────────────

export interface ResponseQuestion {
    id: string;
    sortOrder: number;
    prompt: string;
    answerType:
        | 'YES_NO'
        | 'SINGLE_SELECT'
        | 'MULTI_SELECT'
        | 'TEXT'
        | 'NUMBER'
        | 'SCALE'
        | 'FILE_UPLOAD';
    required: boolean;
    weight: number;
    optionsJson: unknown;
    scaleConfigJson: unknown;
}

export interface ResponseSection {
    id: string;
    sortOrder: number;
    title: string;
    description: string | null;
    questions: ResponseQuestion[];
}

export interface ResponseAnswer {
    questionId: string;
    answerJson: unknown;
}

export interface LoadResponseResult {
    assessmentId: string;
    status: string;
    expiresAtIso: string | null;
    vendor: { name: string };
    template: {
        name: string;
        description: string | null;
        sections: ResponseSection[];
    };
    answers: ResponseAnswer[];
}

export interface SubmitAnswerInput {
    questionId: string;
    answerJson: unknown;
    /** Required for FILE_UPLOAD answers. */
    evidenceId?: string | null;
}

export interface SubmitResponseResult {
    submittedAt: Date;
    status: 'SUBMITTED';
    /** Sum of computedPoints across all submitted answers. */
    provisionalScore: number;
}

export class ExternalAccessDenied extends Error {
    constructor(public readonly reason: AccessVerificationFailure) {
        super(`External access denied: ${reason}`);
    }
}

export class ResponseValidationError extends Error {
    constructor(
        public readonly fieldErrors: Array<{
            questionId: string | null;
            message: string;
        }>,
    ) {
        super(
            `Response validation failed: ${fieldErrors.length} field(s) invalid`,
        );
    }
}

// ─── 1. loadResponseByToken ────────────────────────────────────────

export async function loadResponseByToken(
    rawToken: string | null | undefined,
    assessmentId: string,
): Promise<LoadResponseResult> {
    const verified = await verifyAccessToken(rawToken, assessmentId);
    if (!verified.ok) throw new ExternalAccessDenied(verified.reason);
    const assessment = verified.assessment;

    if (!assessment.templateVersionId) {
        // The G-3 send flow always pins a templateVersionId. A null
        // here would mean the assessment was created via a legacy
        // path and got a token re-attached — refuse rather than
        // surface a half-rendered form.
        throw new ExternalAccessDenied('unknown_assessment');
    }

    const [vendor, template] = await Promise.all([
        prisma.vendor.findUnique({
            where: { id: assessment.vendorId },
            select: { name: true },
        }),
        prisma.vendorAssessmentTemplate.findUnique({
            where: { id: assessment.templateVersionId },
            select: {
                name: true,
                description: true,
                sections: {
                    orderBy: { sortOrder: 'asc' },
                    select: {
                        id: true,
                        sortOrder: true,
                        title: true,
                        description: true,
                        questions: {
                            orderBy: { sortOrder: 'asc' },
                            select: {
                                id: true,
                                sortOrder: true,
                                prompt: true,
                                answerType: true,
                                required: true,
                                weight: true,
                                optionsJson: true,
                                scaleConfigJson: true,
                            },
                        },
                    },
                },
            },
        }),
    ]);

    if (!vendor || !template) {
        throw new ExternalAccessDenied('unknown_assessment');
    }

    // Existing answers for THIS assessment only — defence in depth
    // against any cross-tenant scan.
    const existingAnswers = await prisma.vendorAssessmentAnswer.findMany({
        where: {
            assessmentId: assessment.id,
            tenantId: assessment.tenantId,
        },
        select: { questionId: true, answerJson: true },
    });

    return {
        assessmentId: assessment.id,
        status: assessment.status,
        expiresAtIso:
            assessment.externalAccessTokenExpiresAt?.toISOString() ?? null,
        vendor: { name: vendor.name },
        template: {
            name: template.name,
            description: template.description,
            sections: template.sections.map((s) => ({
                id: s.id,
                sortOrder: s.sortOrder,
                title: s.title,
                description: s.description,
                questions: s.questions.map((q) => ({
                    id: q.id,
                    sortOrder: q.sortOrder,
                    prompt: q.prompt,
                    answerType: q.answerType,
                    required: q.required,
                    weight: q.weight,
                    optionsJson: q.optionsJson,
                    scaleConfigJson: q.scaleConfigJson,
                })),
            })),
        },
        answers: existingAnswers.map((a) => ({
            questionId: a.questionId,
            answerJson: a.answerJson,
        })),
    };
}

// ─── 2. submitResponse ─────────────────────────────────────────────

interface QuestionRow {
    id: string;
    answerType: ResponseQuestion['answerType'];
    required: boolean;
    weight: number;
    optionsJson: unknown;
    scaleConfigJson: unknown;
    riskPointsJson: unknown;
}

export async function submitResponse(
    rawToken: string | null | undefined,
    assessmentId: string,
    answers: SubmitAnswerInput[],
): Promise<SubmitResponseResult> {
    const verified = await verifyAccessToken(rawToken, assessmentId);
    if (!verified.ok) throw new ExternalAccessDenied(verified.reason);
    const assessment = verified.assessment;

    if (!assessment.templateVersionId) {
        throw new ExternalAccessDenied('unknown_assessment');
    }

    // Load the canonical question set for the pinned template
    // version. Validation runs against THIS, not whatever the
    // client claims to have answered.
    const questions = (await prisma.vendorAssessmentTemplateQuestion.findMany({
        where: {
            templateId: assessment.templateVersionId,
            tenantId: assessment.tenantId,
        },
        select: {
            id: true,
            answerType: true,
            required: true,
            weight: true,
            optionsJson: true,
            scaleConfigJson: true,
            riskPointsJson: true,
        },
    })) as QuestionRow[];

    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const errors: Array<{ questionId: string | null; message: string }> = [];

    // ── Per-answer shape validation ──
    const cleanedAnswers: Array<{
        questionId: string;
        answerJson: unknown;
        computedPoints: number;
        evidenceId: string | null;
    }> = [];
    const seenQuestionIds = new Set<string>();

    for (const incoming of answers) {
        const q = questionMap.get(incoming.questionId);
        if (!q) {
            errors.push({
                questionId: incoming.questionId,
                message: 'Unknown question id',
            });
            continue;
        }
        if (seenQuestionIds.has(incoming.questionId)) {
            errors.push({
                questionId: incoming.questionId,
                message: 'Duplicate answer for question',
            });
            continue;
        }
        seenQuestionIds.add(incoming.questionId);

        const validationError = validateAnswerShape(q, incoming);
        if (validationError) {
            errors.push({
                questionId: q.id,
                message: validationError,
            });
            continue;
        }

        cleanedAnswers.push({
            questionId: q.id,
            answerJson: incoming.answerJson,
            computedPoints: computeProvisionalPoints(q, incoming),
            evidenceId: incoming.evidenceId ?? null,
        });
    }

    // ── Required-field check ──
    const answeredIds = new Set(cleanedAnswers.map((a) => a.questionId));
    for (const q of questions) {
        if (q.required && !answeredIds.has(q.id)) {
            errors.push({
                questionId: q.id,
                message: 'This question is required',
            });
        }
    }

    if (errors.length > 0) {
        throw new ResponseValidationError(errors);
    }

    // ── Persist + transition ──
    // The public flow has no `RequestContext`, so we drive the
    // transaction through the audit-context helper directly. The
    // actor for the audit log is the assessment id itself
    // (external respondent), tenantId is the assessment's.
    const submittedAt = new Date();
    const provisionalScore = cleanedAnswers.reduce(
        (sum, a) => sum + a.computedPoints,
        0,
    );

    return runWithAuditContext(
        {
            tenantId: assessment.tenantId,
            actorUserId: 'external-respondent',
            requestId: `vendor-assessment-submit:${assessment.id}`,
        },
        async () => {
            await prisma.$transaction(async (tx) => {
                // Upsert each answer row; the existing
                // (assessmentId, questionId) unique constraint makes
                // this idempotent for re-submits.
                for (const a of cleanedAnswers) {
                    await tx.vendorAssessmentAnswer.upsert({
                        where: {
                            assessmentId_questionId: {
                                assessmentId: assessment.id,
                                questionId: a.questionId,
                            },
                        },
                        update: {
                            answerJson: a.answerJson as never,
                            computedPoints: a.computedPoints,
                            evidenceId: a.evidenceId,
                        },
                        create: {
                            tenantId: assessment.tenantId,
                            assessmentId: assessment.id,
                            questionId: a.questionId,
                            templateQuestionId: a.questionId,
                            answerJson: a.answerJson as never,
                            computedPoints: a.computedPoints,
                            evidenceId: a.evidenceId,
                        },
                    });
                }

                await tx.vendorAssessment.update({
                    where: { id: assessment.id },
                    data: {
                        status: 'SUBMITTED',
                        submittedAt,
                        score: provisionalScore,
                    },
                });

                // Minimal RequestContext for logEvent — only needs
                // tenantId + userId + requestId. Synthesised here
                // because the public flow has no real auth ctx.
                const auditCtx = makeExternalAuditCtx(
                    assessment.tenantId,
                    assessment.id,
                );
                await logEvent(tx, auditCtx, {
                    action: 'VENDOR_ASSESSMENT_SUBMITTED',
                    entityType: 'VendorAssessment',
                    entityId: assessment.id,
                    details: `External respondent submitted assessment (answers=${cleanedAnswers.length}, score=${provisionalScore})`,
                    detailsJson: {
                        category: 'entity_lifecycle',
                        entityName: 'VendorAssessment',
                        operation: 'submitted',
                        after: {
                            status: 'SUBMITTED',
                            submittedAt: submittedAt.toISOString(),
                            provisionalScore,
                            answerCount: cleanedAnswers.length,
                        },
                        summary: `Vendor assessment submitted by external respondent`,
                    },
                });
            });

            // ── SUBMITTED notification — fired AFTER the
            // transaction commits so a stalled email never holds
            // the assessment row's lock. The assessment.requestedByUserId
            // gets the email; we re-load just the email/name pair we
            // need rather than dragging the full ctx through.
            await notifyAssessmentSubmitted(assessment, provisionalScore);

            return {
                submittedAt,
                status: 'SUBMITTED' as const,
                provisionalScore,
            };
        },
    );
}

/**
 * Best-effort SUBMITTED notification for the internal requester.
 * Failures are logged + swallowed: the assessment is already
 * committed; missing the email is a known-ack flow we'd rather
 * tolerate than reverse the submit.
 */
async function notifyAssessmentSubmitted(
    assessment: { id: string; tenantId: string; requestedByUserId: string },
    provisionalScore: number,
): Promise<void> {
    try {
        const { prisma } = await import('@/lib/prisma');
        const requester = await prisma.user.findUnique({
            where: { id: assessment.requestedByUserId },
            select: { email: true, name: true },
        });
        if (!requester?.email) return;
        const ctx = await loadVendorAssessmentContext(assessment);
        if (!ctx) return;

        await prisma.$transaction(async (tx) => {
            await enqueueEmail(tx, {
                tenantId: assessment.tenantId,
                type: 'VENDOR_ASSESSMENT_SUBMITTED',
                toEmail: requester.email!,
                entityId: assessment.id,
                payload: {
                    requesterName: requester.name ?? 'there',
                    vendorName: ctx.vendorName,
                    templateName: ctx.templateName,
                    submittedAtIso: new Date().toISOString(),
                    reviewUrl: ctx.reviewUrl,
                    submittedScore: provisionalScore,
                },
            });
        });
    } catch (err) {
        logger.warn('vendor-assessment-response: submitted-notify failed', {
            component: 'vendor-assessment-response',
            assessmentId: assessment.id,
            err: err instanceof Error ? err : new Error(String(err)),
        });
    }
}

/**
 * Look up vendor + template + tenant slug for assessment-related
 * email payloads. Returns null when any link is missing.
 */
async function loadVendorAssessmentContext(assessment: {
    id: string;
    tenantId: string;
}): Promise<{
    vendorName: string;
    templateName: string;
    reviewUrl: string;
} | null> {
    const { prisma } = await import('@/lib/prisma');
    const a = await prisma.vendorAssessment.findUnique({
        where: { id: assessment.id },
        select: {
            vendor: { select: { name: true } },
            templateVersion: { select: { name: true } },
            tenant: { select: { slug: true } },
        },
    });
    if (!a?.vendor || !a.templateVersion || !a.tenant) return null;
    // env.APP_URL is the validated source of truth (src/env.ts).

    const { env } = require('@/env') as { env: { APP_URL?: string } };
    const origin = (env.APP_URL ?? '').replace(/\/$/, '');
    const reviewUrl = `${origin}/t/${a.tenant.slug}/admin/vendor-assessment-reviews/${assessment.id}`;
    return {
        vendorName: a.vendor.name,
        templateName: a.templateVersion.name,
        reviewUrl,
    };
}

// ─── Validation helpers ────────────────────────────────────────────

function validateAnswerShape(
    q: QuestionRow,
    incoming: SubmitAnswerInput,
): string | null {
    const v = incoming.answerJson as
        | { value?: unknown }
        | string
        | number
        | boolean
        | unknown[]
        | null
        | undefined;

    switch (q.answerType) {
        case 'YES_NO': {
            const value = extractValue(v);
            if (value !== 'yes' && value !== 'no') {
                return 'YES_NO answers must be "yes" or "no".';
            }
            return null;
        }
        case 'SINGLE_SELECT': {
            const value = extractValue(v);
            const options = parseOptions(q.optionsJson);
            if (typeof value !== 'string') {
                return 'SINGLE_SELECT requires a string value.';
            }
            if (!options.has(value)) {
                return `SINGLE_SELECT value "${value}" is not in the question's options.`;
            }
            return null;
        }
        case 'MULTI_SELECT': {
            const value = extractValue(v);
            const options = parseOptions(q.optionsJson);
            if (!Array.isArray(value)) {
                return 'MULTI_SELECT requires an array value.';
            }
            for (const item of value) {
                if (typeof item !== 'string') {
                    return 'MULTI_SELECT array items must be strings.';
                }
                if (!options.has(item)) {
                    return `MULTI_SELECT item "${item}" is not in the question's options.`;
                }
            }
            return null;
        }
        case 'TEXT': {
            const value = extractValue(v);
            if (typeof value !== 'string') return 'TEXT requires a string value.';
            if (value.length > 10000) return 'TEXT answers must be ≤10000 characters.';
            return null;
        }
        case 'NUMBER': {
            const value = extractValue(v);
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return 'NUMBER requires a finite numeric value.';
            }
            return null;
        }
        case 'SCALE': {
            const value = extractValue(v);
            const cfg = q.scaleConfigJson as
                | { min?: unknown; max?: unknown }
                | null
                | undefined;
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return 'SCALE requires a finite numeric value.';
            }
            if (
                !cfg ||
                typeof cfg.min !== 'number' ||
                typeof cfg.max !== 'number'
            ) {
                return 'SCALE question is missing a valid scaleConfigJson.';
            }
            if (value < cfg.min || value > cfg.max) {
                return `SCALE value ${value} is outside [${cfg.min}, ${cfg.max}].`;
            }
            return null;
        }
        case 'FILE_UPLOAD': {
            // Today the vendor flow accepts evidenceId or null.
            // Required-field check below catches empty FILE_UPLOAD
            // responses; here we just shape-check.
            if (
                incoming.evidenceId !== null &&
                incoming.evidenceId !== undefined &&
                typeof incoming.evidenceId !== 'string'
            ) {
                return 'FILE_UPLOAD evidenceId must be a string.';
            }
            return null;
        }
    }
}

function extractValue(v: unknown): unknown {
    if (
        v !== null &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        'value' in (v as object)
    ) {
        return (v as { value: unknown }).value;
    }
    return v;
}

function parseOptions(optionsJson: unknown): Set<string> {
    if (!Array.isArray(optionsJson)) return new Set();
    const out = new Set<string>();
    for (const item of optionsJson) {
        if (
            item &&
            typeof item === 'object' &&
            'value' in (item as object)
        ) {
            const value = (item as { value: unknown }).value;
            if (typeof value === 'string') out.add(value);
        }
    }
    return out;
}

/**
 * Provisional point computation. Mirrors the existing scoring
 * service for the legacy flow (`computeAnswerPoints`) but inlined
 * here so the public path doesn't depend on the legacy module.
 *
 * Final scoring + reviewer overrides happen in a later G-3 prompt.
 */
function computeProvisionalPoints(
    q: QuestionRow,
    incoming: SubmitAnswerInput,
): number {
    const value = extractValue(incoming.answerJson);
    const weight = q.weight ?? 1;

    // SINGLE_SELECT / MULTI_SELECT — sum points from matching options.
    if (q.answerType === 'SINGLE_SELECT' || q.answerType === 'MULTI_SELECT') {
        const points = optionPoints(q.optionsJson, value);
        return points * weight;
    }
    // SCALE — value is the points; weight applied.
    if (q.answerType === 'SCALE' && typeof value === 'number') {
        return value * weight;
    }
    // YES_NO — try the riskPointsJson legacy map.
    if (q.answerType === 'YES_NO') {
        const map = q.riskPointsJson as Record<string, number> | null;
        if (map && typeof value === 'string' && typeof map[value] === 'number') {
            return map[value] * weight;
        }
    }
    return 0;
}

function optionPoints(optionsJson: unknown, value: unknown): number {
    if (!Array.isArray(optionsJson)) return 0;
    const wanted = new Set<string>();
    if (typeof value === 'string') wanted.add(value);
    else if (Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string') wanted.add(v);
    } else return 0;

    let points = 0;
    for (const item of optionsJson) {
        if (item && typeof item === 'object' && 'value' in (item as object)) {
            const v = (item as { value: unknown }).value;
            const p = (item as { points?: unknown }).points;
            if (typeof v === 'string' && wanted.has(v) && typeof p === 'number') {
                points += p;
            }
        }
    }
    return points;
}
