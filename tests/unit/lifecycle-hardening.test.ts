/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Editable Lifecycle — Production Hardening Integration Tests
 *
 * Validates the complete lifecycle system for production readiness:
 *
 * 1. **Permission enforcement** — Every lifecycle action respects RBAC
 * 2. **Full E2E workflow** — draft → publish → history → revert → archive
 * 3. **Cross-domain consistency** — Policy and VendorAssessment adapters
 *    behave consistently through the same generic service
 * 4. **Audit trail completeness** — Every transition emits correct events
 * 5. **Tenant safety** — RequestContext is always required and attributed
 * 6. **Error conditions** — Invalid transitions are properly rejected
 */

import { LifecycleError } from '@/app-layer/domain/editable-lifecycle.types';
import type { EditableState } from '@/app-layer/domain/editable-lifecycle.types';
import {
    createEditableState,
    updateDraft,
    publish,
    revertToVersion,
    archive,
    hasPendingChanges,
    hasBeenPublished,
    getEffectivePayload,
    getHistoryEntry,
    getRecentHistory,
} from '@/app-layer/services/editable-lifecycle';
import {
    assertCanEditDraft,
    assertCanPublish,
    assertCanViewHistory,
    assertCanArchive,
    assertCanRevert,
    assertCanViewDraftEntity,
} from '@/app-layer/policies/lifecycle.policies';
import { AppError } from '@/lib/errors/types';

import type { Role } from '@prisma/client';
import { getPermissionsForRole } from '@/lib/permissions';

// ─── Mock audit + logger ─────────────────────────────────────────────

const mockLogEvent = jest.fn();
jest.mock('@/app-layer/events/audit', () => ({
    logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));
jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
    updateDraftWithAudit,
    publishWithAudit,
    revertWithAudit,
    archiveWithAudit,
    type EditableRepository,
    type LifecycleAuditConfig,
} from '@/app-layer/usecases/editable-lifecycle-usecase';

// ─── Test Fixtures ───────────────────────────────────────────────────

type SimplePayload = { content: string; version?: string };

const MOCK_DB = {} as any;

function ctx(role: string, overrides?: Partial<{ userId: string; tenantId: string }>) {
    return {
        requestId: 'req-test',
        userId: overrides?.userId ?? 'user-1',
        tenantId: overrides?.tenantId ?? 'tenant-1',
        tenantSlug: 'acme',
        role: role as Role,
        permissions: {
            canRead: true,
            canWrite: ['ADMIN', 'EDITOR'].includes(role),
            canAdmin: role === 'ADMIN',
            canAudit: ['ADMIN', 'AUDITOR'].includes(role),
            canExport: role === 'ADMIN',
        },
        appPermissions: getPermissionsForRole(role as Role),
    };
}

const AUDIT_CFG: LifecycleAuditConfig = { entityType: 'TestEntity', actionPrefix: 'TEST' };

function makeRepo(): EditableRepository<SimplePayload> & { store: Map<string, EditableState<SimplePayload>> } {
    const store = new Map<string, EditableState<SimplePayload>>();
    return {
        store,
        loadState: async (_db, id) => store.get(id) ?? null,
        saveState: async (_db, id, state) => { store.set(id, state); },
    };
}

// ═════════════════════════════════════════════════════════════════════
// 1. Permission Enforcement
// ═════════════════════════════════════════════════════════════════════

describe('Lifecycle Permission Enforcement', () => {

    describe('assertCanEditDraft', () => {
        it.each(['ADMIN', 'EDITOR'])('%s CAN edit drafts', (role) => {
            expect(() => assertCanEditDraft(ctx(role))).not.toThrow();
        });

        it.each(['READER', 'AUDITOR'])('%s CANNOT edit drafts', (role) => {
            expect(() => assertCanEditDraft(ctx(role))).toThrow(AppError);
            expect(() => assertCanEditDraft(ctx(role))).toThrow(/permission/i);
        });
    });

    describe('assertCanPublish', () => {
        it('ADMIN CAN publish', () => {
            expect(() => assertCanPublish(ctx('ADMIN'))).not.toThrow();
        });

        it.each(['EDITOR', 'READER', 'AUDITOR'])('%s CANNOT publish', (role) => {
            expect(() => assertCanPublish(ctx(role))).toThrow(AppError);
            expect(() => assertCanPublish(ctx(role))).toThrow(/admin/i);
        });
    });

    describe('assertCanViewHistory', () => {
        it.each(['ADMIN', 'AUDITOR'])('%s CAN view history', (role) => {
            expect(() => assertCanViewHistory(ctx(role))).not.toThrow();
        });

        it('EDITOR CANNOT view history (no canAudit)', () => {
            expect(() => assertCanViewHistory(ctx('EDITOR'))).toThrow(AppError);
            expect(() => assertCanViewHistory(ctx('EDITOR'))).toThrow(/audit/i);
        });

        it('READER CANNOT view history (no canAudit)', () => {
            expect(() => assertCanViewHistory(ctx('READER'))).toThrow(AppError);
        });
    });

    describe('assertCanArchive', () => {
        it('ADMIN CAN archive', () => {
            expect(() => assertCanArchive(ctx('ADMIN'))).not.toThrow();
        });

        it.each(['EDITOR', 'READER', 'AUDITOR'])('%s CANNOT archive', (role) => {
            expect(() => assertCanArchive(ctx(role))).toThrow(AppError);
        });
    });

    describe('assertCanRevert', () => {
        it('ADMIN CAN revert', () => {
            expect(() => assertCanRevert(ctx('ADMIN'))).not.toThrow();
        });

        it.each(['EDITOR', 'READER', 'AUDITOR'])('%s CANNOT revert', (role) => {
            expect(() => assertCanRevert(ctx(role))).toThrow(AppError);
        });
    });

    describe('assertCanViewDraftEntity (GAP-2: draft visibility)', () => {
        it.each(['ADMIN', 'EDITOR'])('%s CAN view any draft', (role) => {
            expect(() => assertCanViewDraftEntity(ctx(role), 'DRAFT', 'other-user'))
                .not.toThrow();
        });

        it('READER can view own draft', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('READER', { userId: 'owner-1' }), 'DRAFT', 'owner-1',
            )).not.toThrow();
        });

        it.each(['READER', 'AUDITOR'])('%s CANNOT view other user draft', (role) => {
            expect(() => assertCanViewDraftEntity(ctx(role), 'DRAFT', 'other-user'))
                .toThrow(AppError);
        });

        it.each(['ADMIN', 'EDITOR', 'READER', 'AUDITOR'])(
            '%s CAN view published entities',
            (role) => {
                expect(() => assertCanViewDraftEntity(ctx(role), 'PUBLISHED', 'other-user'))
                    .not.toThrow();
            },
        );
    });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Full E2E Workflow with Permissions + Audit
// ═════════════════════════════════════════════════════════════════════

describe('Full Lifecycle E2E with Permissions + Audit', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
    });

    it('EDITOR can edit draft, ADMIN publishes, AUDITOR views history', async () => {
        // Setup entity
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'draft-v1' }));

        // EDITOR updates draft
        const editorCtx = ctx('EDITOR');
        assertCanEditDraft(editorCtx); // passes
        const afterDraft = await updateDraftWithAudit(
            MOCK_DB, editorCtx, 'e1',
            { content: 'draft-v1-refined' },
            repo, AUDIT_CFG,
        );
        expect(afterDraft.draft).toEqual({ content: 'draft-v1-refined' });

        // ADMIN publishes
        const adminCtx = ctx('ADMIN');
        assertCanPublish(adminCtx); // passes
        const afterPublish = await publishWithAudit(
            MOCK_DB, adminCtx, 'e1',
            { publishedBy: adminCtx.userId, changeSummary: 'First release' },
            repo, AUDIT_CFG,
        );
        expect(afterPublish.phase).toBe('PUBLISHED');
        expect(afterPublish.currentVersion).toBe(2);

        // AUDITOR can view history
        const auditorCtx = ctx('AUDITOR');
        assertCanViewHistory(auditorCtx); // passes

        // But AUDITOR cannot edit or publish
        expect(() => assertCanEditDraft(auditorCtx)).toThrow();
        expect(() => assertCanPublish(auditorCtx)).toThrow();
    });

    it('READER is blocked from all lifecycle actions', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'draft' }));
        const readerCtx = ctx('READER');

        expect(() => assertCanEditDraft(readerCtx)).toThrow();
        expect(() => assertCanPublish(readerCtx)).toThrow();
        expect(() => assertCanViewHistory(readerCtx)).toThrow();
        expect(() => assertCanArchive(readerCtx)).toThrow();
        expect(() => assertCanRevert(readerCtx)).toThrow();
    });

    it('EDITOR can edit but NOT publish (escalation boundary)', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'initial' }));
        const editorCtx = ctx('EDITOR');

        // Can edit
        assertCanEditDraft(editorCtx);
        await updateDraftWithAudit(
            MOCK_DB, editorCtx, 'e1',
            { content: 'improved' },
            repo, AUDIT_CFG,
        );

        // Cannot publish
        expect(() => assertCanPublish(editorCtx)).toThrow(/admin/i);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Audit Trail Completeness
// ═════════════════════════════════════════════════════════════════════

describe('Audit Trail Completeness', () => {
    let repo: ReturnType<typeof makeRepo>;
    const adminCtx = ctx('ADMIN');

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
    });

    it('full lifecycle produces complete audit trail', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'v1' }));

        // 1. Draft update
        await updateDraftWithAudit(MOCK_DB, adminCtx, 'e1', { content: 'v1-final' }, repo, AUDIT_CFG);

        // 2. First publish (v1→v2)
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin', changeSummary: 'v1' }, repo, AUDIT_CFG);

        // 3. Second draft
        await updateDraftWithAudit(MOCK_DB, adminCtx, 'e1', { content: 'v2' }, repo, AUDIT_CFG);

        // 4. Second publish (v2→v3) — creates version snapshot
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin', changeSummary: 'v2' }, repo, AUDIT_CFG);

        // 5. Revert
        await revertWithAudit(MOCK_DB, adminCtx, 'e1', { targetVersion: 2 }, repo, AUDIT_CFG);

        // 6. Archive
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin', changeSummary: 'v3' }, repo, AUDIT_CFG);
        await archiveWithAudit(MOCK_DB, adminCtx, 'e1', repo, AUDIT_CFG);

        // Verify audit events
        const actions = mockLogEvent.mock.calls.map((c: any) => c[2].action);
        expect(actions).toContain('TEST_DRAFT_UPDATED');
        expect(actions).toContain('TEST_PUBLISHED');
        expect(actions).toContain('TEST_VERSION_CREATED');
        expect(actions).toContain('TEST_REVERTED');
        expect(actions).toContain('TEST_ARCHIVED');

        // Every event has correct tenant + user context
        for (const call of mockLogEvent.mock.calls) {
            const eventCtx = call[1];
            expect(eventCtx.tenantId).toBe('tenant-1');
            expect(eventCtx.userId).toBe('user-1');
            expect(eventCtx.requestId).toBe('req-test');
        }
    });

    it('audit events include version metadata', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'v1' }));
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin', changeSummary: 'First' }, repo, AUDIT_CFG);

        const publishCall = mockLogEvent.mock.calls.find((c: any) => c[2].action === 'TEST_PUBLISHED');
        expect(publishCall).toBeDefined();

        const payload = publishCall![2];
        expect(payload.metadata.version).toBe(2);
        expect(payload.metadata.previousVersion).toBe(1);
        expect(payload.metadata.changeSummary).toBe('First');
        expect(payload.detailsJson.category).toBe('status_change');
    });

    it('VERSION_CREATED includes snapshot metadata', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'v1' }));
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin' }, repo, AUDIT_CFG);

        repo.store.set('e1', { ...repo.store.get('e1')!, phase: 'DRAFT', draft: { content: 'v2' } });
        await publishWithAudit(MOCK_DB, adminCtx, 'e1', { publishedBy: 'admin' }, repo, AUDIT_CFG);

        const versionCall = mockLogEvent.mock.calls.find((c: any) => c[2].action === 'TEST_VERSION_CREATED');
        expect(versionCall).toBeDefined();

        const payload = versionCall![2];
        expect(payload.metadata.snapshotVersion).toBe(2);
        expect(payload.metadata.historyLength).toBe(1);
        expect(payload.detailsJson.category).toBe('entity_lifecycle');
        expect(payload.detailsJson.operation).toBe('version_snapshot');
    });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Cross-Domain Consistency
// ═════════════════════════════════════════════════════════════════════

describe('Cross-Domain Consistency', () => {
    it('lifecycle behaves identically regardless of payload type', () => {
        // Policy-like payload
        type PolicyLike = { contentType: string; contentText: string };
        let policyState = createEditableState<PolicyLike>({ contentType: 'MARKDOWN', contentText: '# Policy' });
        policyState = publish(policyState, { publishedBy: 'admin' });
        policyState = updateDraft(policyState, { contentType: 'HTML', contentText: '<h1>Policy</h1>' });
        policyState = publish(policyState, { publishedBy: 'admin' });

        // Assessment-like payload
        type AssessmentLike = { answers: string[]; score: number };
        let assessState = createEditableState<AssessmentLike>({ answers: ['yes', 'no'], score: 50 });
        assessState = publish(assessState, { publishedBy: 'admin' });
        assessState = updateDraft(assessState, { answers: ['yes', 'yes'], score: 100 });
        assessState = publish(assessState, { publishedBy: 'admin' });

        // Both should have identical lifecycle behavior
        expect(policyState.currentVersion).toBe(3);
        expect(assessState.currentVersion).toBe(3);
        expect(policyState.history).toHaveLength(1);
        expect(assessState.history).toHaveLength(1);
        expect(policyState.phase).toBe('PUBLISHED');
        expect(assessState.phase).toBe('PUBLISHED');
    });

    it('query helpers work identically across domain payloads', () => {
        type A = { x: number };
        type B = { y: string };

        let stateA = createEditableState<A>({ x: 1 });
        let stateB = createEditableState<B>({ y: 'hello' });

        // Both haven't been published
        expect(hasBeenPublished(stateA)).toBe(false);
        expect(hasBeenPublished(stateB)).toBe(false);

        stateA = publish(stateA, { publishedBy: 'u1' });
        stateB = publish(stateB, { publishedBy: 'u1' });

        expect(hasBeenPublished(stateA)).toBe(true);
        expect(hasBeenPublished(stateB)).toBe(true);

        expect(hasPendingChanges(stateA)).toBe(false);
        expect(hasPendingChanges(stateB)).toBe(false);

        stateA = updateDraft(stateA, { x: 2 });
        stateB = updateDraft(stateB, { y: 'world' });

        expect(hasPendingChanges(stateA)).toBe(true);
        expect(hasPendingChanges(stateB)).toBe(true);

        expect(getEffectivePayload(stateA)).toEqual({ x: 2 }); // draft over published
        expect(getEffectivePayload(stateB)).toEqual({ y: 'world' });
    });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Error Conditions (Invalid Transitions)
// ═════════════════════════════════════════════════════════════════════

describe('Invalid Transition Rejection', () => {
    it('cannot publish without draft', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin' });

        expect(() => publish(state, { publishedBy: 'admin' }))
            .toThrow(LifecycleError);
    });

    it('cannot edit after archive', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin' });
        state = archive(state);

        expect(() => updateDraft(state, { content: 'nope' }))
            .toThrow(LifecycleError);
    });

    it('cannot publish after archive', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin' });
        state = archive(state);

        expect(() => publish(state, { publishedBy: 'admin' }))
            .toThrow(LifecycleError);
    });

    it('cannot revert to non-existent version', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin' });

        expect(() => revertToVersion(state, { targetVersion: 99 }))
            .toThrow(LifecycleError);
    });

    it('cannot double-archive', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin' });
        state = archive(state);

        expect(() => archive(state)).toThrow(LifecycleError);
    });

    it('usecase rejects non-existent entity', async () => {
        const repo = makeRepo();
        await expect(
            publishWithAudit(MOCK_DB, ctx('ADMIN'), 'nonexistent', { publishedBy: 'admin' }, repo, AUDIT_CFG),
        ).rejects.toThrow(LifecycleError);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Tenant Attribution
// ═════════════════════════════════════════════════════════════════════

describe('Tenant Attribution', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
    });

    it('audit events carry correct tenant from different contexts', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'v1' }));

        const tenant1Ctx = ctx('ADMIN', { tenantId: 'tenant-abc', userId: 'user-x' });
        await updateDraftWithAudit(MOCK_DB, tenant1Ctx, 'e1', { content: 'updated' }, repo, AUDIT_CFG);

        const auditCall = mockLogEvent.mock.calls[0];
        expect(auditCall[1].tenantId).toBe('tenant-abc');
        expect(auditCall[1].userId).toBe('user-x');
    });

    it('different users on same entity produce distinct audit trails', async () => {
        repo.store.set('e1', createEditableState<SimplePayload>({ content: 'v1' }));

        // User A edits
        await updateDraftWithAudit(
            MOCK_DB, ctx('ADMIN', { userId: 'user-a' }), 'e1',
            { content: 'by-a' }, repo, AUDIT_CFG,
        );

        // User B publishes
        await publishWithAudit(
            MOCK_DB, ctx('ADMIN', { userId: 'user-b' }), 'e1',
            { publishedBy: 'user-b' }, repo, AUDIT_CFG,
        );

        const userIds = mockLogEvent.mock.calls.map((c: any) => c[1].userId);
        expect(userIds[0]).toBe('user-a');
        expect(userIds[1]).toBe('user-b');
    });
});

// ═════════════════════════════════════════════════════════════════════
// 7. Version History Integrity
// ═════════════════════════════════════════════════════════════════════

describe('Version History Integrity', () => {
    it('10 sequential publishes produce correct history chain', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });

        for (let i = 1; i <= 10; i++) {
            if (i > 1) {
                state = updateDraft(state, { content: `v${i}` });
            }
            state = publish(state, { publishedBy: `user-${i}`, changeSummary: `Release v${i}` });
        }

        expect(state.currentVersion).toBe(11);
        expect(state.published).toEqual({ content: 'v10' });
        expect(state.draft).toBeNull();
        expect(state.history).toHaveLength(9); // v2 through v10

        // Verify ordering (oldest first)
        for (let i = 0; i < 9; i++) {
            expect(state.history[i].version).toBe(i + 2);
            expect(state.history[i].payload.content).toBe(`v${i + 1}`);
        }

        // Verify getHistoryEntry
        const v5 = getHistoryEntry(state, 6);
        expect(v5?.payload.content).toBe('v5');

        // Verify getRecentHistory
        const recent = getRecentHistory(state, 3);
        expect(recent).toHaveLength(3);
        expect(recent[0].version).toBe(10); // most recent first
        expect(recent[1].version).toBe(9);
        expect(recent[2].version).toBe(8);
    });

    it('revert + re-publish produces correct history without duplication', () => {
        let state = createEditableState<SimplePayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'u1' }); // v1
        state = updateDraft(state, { content: 'v2' });
        state = publish(state, { publishedBy: 'u1' }); // v2
        state = updateDraft(state, { content: 'v3' });
        state = publish(state, { publishedBy: 'u1' }); // v3

        // Revert to v2 and re-publish as v5
        state = revertToVersion(state, { targetVersion: 2 });
        state = publish(state, { publishedBy: 'u1' }); // v5

        expect(state.currentVersion).toBe(5);
        expect(state.published).toEqual({ content: 'v1' }); // v1 content now live as v5
        expect(state.history).toHaveLength(3); // v2, v3, v4

        // History preserves the original chain
        expect(state.history[0].payload.content).toBe('v1');
        expect(state.history[1].payload.content).toBe('v2');
        expect(state.history[2].payload.content).toBe('v3');
    });
});
