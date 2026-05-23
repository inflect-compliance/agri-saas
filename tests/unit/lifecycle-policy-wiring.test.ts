/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Lifecycle Policy Wiring Tests (GAP-4)
 *
 * Validates that lifecycle policies are enforced INSIDE the generic usecase
 * functions (defense-in-depth). This ensures that even if a domain usecase
 * caller forgets to check permissions, the generic layer catches it.
 *
 * Test strategy:
 * - Call each usecase function with insufficient permissions
 * - Verify it throws the correct AppError BEFORE touching the repository
 * - Verify it succeeds with correct permissions
 * - Verify the `enforcePolicy: false` escape hatch works for testing
 */

import type { EditableState } from '@/app-layer/domain/editable-lifecycle.types';
import { createEditableState, updateDraft } from '@/app-layer/services/editable-lifecycle';
import type { RequestContext } from '@/app-layer/types';
import { AppError } from '@/lib/errors/types';

// ─── Mocks ───────────────────────────────────────────────────────────

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

type TestPayload = { content: string };

const MOCK_DB = {} as any;
const AUDIT_CFG: LifecycleAuditConfig = { entityType: 'Test', actionPrefix: 'TEST' };

function ctx(role: string, overrides?: Partial<{ userId: string }>): RequestContext {
    return {
        requestId: 'req-test',
        userId: overrides?.userId ?? 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        role,
        permissions: {
            canRead: true,
            canWrite: ['ADMIN', 'EDITOR'].includes(role),
            canAdmin: role === 'ADMIN',
            canAudit: ['ADMIN', 'AUDITOR'].includes(role),
            canExport: role === 'ADMIN',
        },
    } as RequestContext;
}

function makeRepo(): EditableRepository<TestPayload> & { store: Map<string, EditableState<TestPayload>> } {
    const store = new Map<string, EditableState<TestPayload>>();
    return {
        store,
        loadState: async (_db, id) => store.get(id) ?? null,
        saveState: async (_db, id, state) => { store.set(id, state); },
    };
}

function seedEntity(repo: ReturnType<typeof makeRepo>, id: string, phase: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
    let state = createEditableState<TestPayload>({ content: 'test' });
    if (phase === 'PUBLISHED') {
        state = updateDraft(state, { content: 'v1' });
        // Manually create a published state for testing
        state = {
            ...state,
            phase: 'PUBLISHED',
            currentVersion: 2,
            draft: { content: 'v2-draft' },
            published: { content: 'v1' },
            history: [],
        };
    }
    repo.store.set(id, state);
}

// ═════════════════════════════════════════════════════════════════════
// 1. updateDraftWithAudit — requires canWrite
// ═════════════════════════════════════════════════════════════════════

describe('updateDraftWithAudit — built-in policy enforcement', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1');
    });

    it('ADMIN can update draft', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('ADMIN'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).resolves.toBeDefined();
    });

    it('EDITOR can update draft', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('EDITOR'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).resolves.toBeDefined();
    });

    it('READER is blocked from updating draft', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('READER'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('AUDITOR is blocked from updating draft', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('AUDITOR'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('READER blocked BEFORE repo access (defense-in-depth)', async () => {
        const loadSpy = jest.spyOn(repo, 'loadState');
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('READER'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).rejects.toThrow();
        // Policy check happens before any DB access
        expect(loadSpy).not.toHaveBeenCalled();
    });
});

// ═════════════════════════════════════════════════════════════════════
// 2. publishWithAudit — requires canAdmin
// ═════════════════════════════════════════════════════════════════════

describe('publishWithAudit — built-in policy enforcement', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1');
    });

    it('ADMIN can publish', async () => {
        await expect(
            publishWithAudit(MOCK_DB, ctx('ADMIN'), 'e1', { publishedBy: 'admin' }, repo, AUDIT_CFG),
        ).resolves.toBeDefined();
    });

    it('EDITOR is blocked from publishing', async () => {
        await expect(
            publishWithAudit(MOCK_DB, ctx('EDITOR'), 'e1', { publishedBy: 'editor' }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('READER is blocked from publishing', async () => {
        await expect(
            publishWithAudit(MOCK_DB, ctx('READER'), 'e1', { publishedBy: 'reader' }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('EDITOR blocked BEFORE repo access', async () => {
        const loadSpy = jest.spyOn(repo, 'loadState');
        await expect(
            publishWithAudit(MOCK_DB, ctx('EDITOR'), 'e1', { publishedBy: 'editor' }, repo, AUDIT_CFG),
        ).rejects.toThrow();
        expect(loadSpy).not.toHaveBeenCalled();
    });
});

// ═════════════════════════════════════════════════════════════════════
// 3. revertWithAudit — requires canAdmin
// ═════════════════════════════════════════════════════════════════════

describe('revertWithAudit — built-in policy enforcement', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1', 'PUBLISHED');
    });

    it('ADMIN can revert', async () => {
        // Need to set up history for revert to work
        // For this test, we just verify the policy doesn't block
        const state = repo.store.get('e1')!;
        repo.store.set('e1', {
            ...state,
            history: [{ version: 2, payload: { content: 'v1' }, publishedAt: new Date().toISOString(), publishedBy: 'admin' }],
        });
        await expect(
            revertWithAudit(MOCK_DB, ctx('ADMIN'), 'e1', { targetVersion: 2 }, repo, AUDIT_CFG),
        ).resolves.toBeDefined();
    });

    it('EDITOR is blocked from reverting', async () => {
        await expect(
            revertWithAudit(MOCK_DB, ctx('EDITOR'), 'e1', { targetVersion: 2 }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('READER is blocked from reverting', async () => {
        await expect(
            revertWithAudit(MOCK_DB, ctx('READER'), 'e1', { targetVersion: 2 }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 4. archiveWithAudit — requires canAdmin
// ═════════════════════════════════════════════════════════════════════

describe('archiveWithAudit — built-in policy enforcement', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1');
    });

    it('ADMIN can archive', async () => {
        await expect(
            archiveWithAudit(MOCK_DB, ctx('ADMIN'), 'e1', repo, AUDIT_CFG),
        ).resolves.toBeDefined();
    });

    it('EDITOR is blocked from archiving', async () => {
        await expect(
            archiveWithAudit(MOCK_DB, ctx('EDITOR'), 'e1', repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });

    it('AUDITOR is blocked from archiving', async () => {
        await expect(
            archiveWithAudit(MOCK_DB, ctx('AUDITOR'), 'e1', repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 5. enforcePolicy: false escape hatch
// ═════════════════════════════════════════════════════════════════════

describe('enforcePolicy: false — test escape hatch', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1');
    });

    it('READER can update draft when enforcePolicy=false', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('READER'), 'e1', { content: 'new' }, repo, AUDIT_CFG, { enforcePolicy: false }),
        ).resolves.toBeDefined();
    });

    it('READER can publish when enforcePolicy=false', async () => {
        await expect(
            publishWithAudit(MOCK_DB, ctx('READER'), 'e1', { publishedBy: 'r' }, repo, AUDIT_CFG, undefined, { enforcePolicy: false }),
        ).resolves.toBeDefined();
    });

    it('READER can archive when enforcePolicy=false', async () => {
        await expect(
            archiveWithAudit(MOCK_DB, ctx('READER'), 'e1', repo, AUDIT_CFG, { enforcePolicy: false }),
        ).resolves.toBeDefined();
    });

    it('default enforcePolicy is true (blocks READER)', async () => {
        await expect(
            updateDraftWithAudit(MOCK_DB, ctx('READER'), 'e1', { content: 'new' }, repo, AUDIT_CFG),
        ).rejects.toThrow(AppError);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Cross-operation escalation matrix
// ═════════════════════════════════════════════════════════════════════

describe('Cross-operation escalation matrix', () => {
    let repo: ReturnType<typeof makeRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
        repo = makeRepo();
        seedEntity(repo, 'e1');
    });

    it.each([
        // [operation, role, shouldSucceed]
        ['updateDraft', 'ADMIN',   true],
        ['updateDraft', 'EDITOR',  true],
        ['updateDraft', 'READER',  false],
        ['updateDraft', 'AUDITOR', false],
        ['publish',     'ADMIN',   true],
        ['publish',     'EDITOR',  false],
        ['publish',     'READER',  false],
        ['publish',     'AUDITOR', false],
        ['archive',     'ADMIN',   true],
        ['archive',     'EDITOR',  false],
        ['archive',     'READER',  false],
        ['archive',     'AUDITOR', false],
    ] as const)('%s by %s → %s', async (operation, role, shouldSucceed) => {
        const context = ctx(role);
        let promise: Promise<any>;

        switch (operation) {
            case 'updateDraft':
                promise = updateDraftWithAudit(MOCK_DB, context, 'e1', { content: 'x' }, repo, AUDIT_CFG);
                break;
            case 'publish':
                promise = publishWithAudit(MOCK_DB, context, 'e1', { publishedBy: 'u' }, repo, AUDIT_CFG);
                break;
            case 'archive':
                promise = archiveWithAudit(MOCK_DB, context, 'e1', repo, AUDIT_CFG);
                break;
        }

        if (shouldSucceed) {
            await expect(promise).resolves.toBeDefined();
        } else {
            await expect(promise).rejects.toThrow(AppError);
        }
    });
});
