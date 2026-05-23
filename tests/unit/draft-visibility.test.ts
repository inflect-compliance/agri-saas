/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Draft Visibility Tests
 *
 * Validates the CISO-Assistant `is_published` visibility convention:
 *
 * 1. **Pure predicate** — `isDraftVisibleTo()` determines entity-level visibility
 * 2. **Scope classifier** — `getVisibilityScope()` classifies list-query scope
 * 3. **Filter builder** — `buildDraftVisibilityFilter()` generates Prisma where clauses
 * 4. **Policy enforcement** — `assertCanViewDraftEntity()` throws on unauthorized access
 * 5. **Cross-role matrix** — ADMIN, EDITOR, READER, AUDITOR visibility boundaries
 *
 * Design rationale:
 * - Published/archived entities are always visible to anyone with canRead
 * - Draft entities are visible only to writers/admins (editorial workflow)
 *   or to the entity's owner (the person who created the draft)
 * - This matches CISO-Assistant's `is_published` flag on `AbstractBaseModel`
 */

import type { EditableState } from '@/app-layer/domain/editable-lifecycle.types';
import type { DraftOwnership } from '@/app-layer/domain/editable-lifecycle.types';
import {
    createEditableState,
    publish,
    archive,
    isDraftVisibleTo,
    getVisibilityScope,
    buildDraftVisibilityFilter,
} from '@/app-layer/services/editable-lifecycle';
import {
    assertCanViewDraftEntity,
} from '@/app-layer/policies/lifecycle.policies';
import { AppError } from '@/lib/errors/types';
import type { Role } from '@prisma/client';
import { getPermissionsForRole } from '@/lib/permissions';

// ─── Test Fixtures ───────────────────────────────────────────────────

type TestPayload = { content: string };

function makeState(phase: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'): EditableState<TestPayload> {
    let state = createEditableState<TestPayload>({ content: 'test' });
    if (phase === 'PUBLISHED' || phase === 'ARCHIVED') {
        state = publish(state, { publishedBy: 'owner-1' });
    }
    if (phase === 'ARCHIVED') {
        state = archive(state);
    }
    return state;
}

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

// ═════════════════════════════════════════════════════════════════════
// 1. isDraftVisibleTo (Pure Predicate)
// ═════════════════════════════════════════════════════════════════════

describe('isDraftVisibleTo', () => {
    const ownership: DraftOwnership = { ownerUserId: 'owner-1' };
    const noOwner: DraftOwnership = { ownerUserId: null };

    // ─── Published entities ──────────────────────────────────────

    describe('published entities', () => {
        const publishedState = makeState('PUBLISHED');

        it('visible to writer', () => {
            expect(isDraftVisibleTo(publishedState, ownership, 'anyone', true)).toBe(true);
        });

        it('visible to non-writer', () => {
            expect(isDraftVisibleTo(publishedState, ownership, 'anyone', false)).toBe(true);
        });

        it('visible to non-owner non-writer', () => {
            expect(isDraftVisibleTo(publishedState, ownership, 'stranger', false)).toBe(true);
        });
    });

    // ─── Archived entities ───────────────────────────────────────

    describe('archived entities', () => {
        const archivedState = makeState('ARCHIVED');

        it('visible to writer', () => {
            expect(isDraftVisibleTo(archivedState, ownership, 'anyone', true)).toBe(true);
        });

        it('visible to non-writer', () => {
            expect(isDraftVisibleTo(archivedState, ownership, 'anyone', false)).toBe(true);
        });
    });

    // ─── Draft entities ──────────────────────────────────────────

    describe('draft entities', () => {
        const draftState = makeState('DRAFT');

        it('visible to writer (editorial workflow)', () => {
            expect(isDraftVisibleTo(draftState, ownership, 'editor-1', true)).toBe(true);
        });

        it('visible to owner (even without write permission)', () => {
            expect(isDraftVisibleTo(draftState, ownership, 'owner-1', false)).toBe(true);
        });

        it('NOT visible to non-owner non-writer', () => {
            expect(isDraftVisibleTo(draftState, ownership, 'stranger', false)).toBe(false);
        });

        it('NOT visible to non-owner reader', () => {
            expect(isDraftVisibleTo(draftState, ownership, 'reader-1', false)).toBe(false);
        });

        it('NOT visible when owner is null and viewer is non-writer', () => {
            expect(isDraftVisibleTo(draftState, noOwner, 'reader-1', false)).toBe(false);
        });

        it('visible to admin (via canWrite)', () => {
            expect(isDraftVisibleTo(draftState, ownership, 'admin-1', true)).toBe(true);
        });
    });

    // ─── Cross-role matrix ───────────────────────────────────────

    describe('cross-role visibility matrix', () => {
        const draftState = makeState('DRAFT');
        const publishedState = makeState('PUBLISHED');
        const archivedState = makeState('ARCHIVED');
        const own: DraftOwnership = { ownerUserId: 'user-1' };
        const other: DraftOwnership = { ownerUserId: 'other-user' };

        it.each([
            // [role, canWrite, ownerMatch, phase, expected]
            ['ADMIN',   true,  false, 'DRAFT',     true],
            ['ADMIN',   true,  false, 'PUBLISHED', true],
            ['ADMIN',   true,  false, 'ARCHIVED',  true],
            ['EDITOR',  true,  false, 'DRAFT',     true],
            ['EDITOR',  true,  false, 'PUBLISHED', true],
            ['READER',  false, true,  'DRAFT',     true],   // own draft
            ['READER',  false, false, 'DRAFT',     false],  // other's draft
            ['READER',  false, false, 'PUBLISHED', true],
            ['READER',  false, false, 'ARCHIVED',  true],
            ['AUDITOR', false, true,  'DRAFT',     true],   // own draft
            ['AUDITOR', false, false, 'DRAFT',     false],  // other's draft
            ['AUDITOR', false, false, 'PUBLISHED', true],
        ] as const)('%s (canWrite=%s, ownDraft=%s, phase=%s) → visible=%s', (
            _role, canWrite, ownerMatch, phase, expected,
        ) => {
            const state = phase === 'DRAFT' ? draftState
                : phase === 'PUBLISHED' ? publishedState
                    : archivedState;
            const ownership = ownerMatch ? own : other;
            const viewerUserId = 'user-1';

            expect(isDraftVisibleTo(state, ownership, viewerUserId, canWrite)).toBe(expected);
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// 2. getVisibilityScope (Scope Classifier)
// ═════════════════════════════════════════════════════════════════════

describe('getVisibilityScope', () => {
    it('returns ALL for writers', () => {
        expect(getVisibilityScope(true)).toBe('ALL');
    });

    it('returns PUBLISHED_AND_OWN for non-writers', () => {
        expect(getVisibilityScope(false)).toBe('PUBLISHED_AND_OWN');
    });
});

// ═════════════════════════════════════════════════════════════════════
// 3. buildDraftVisibilityFilter (Prisma Filter Builder)
// ═════════════════════════════════════════════════════════════════════

describe('buildDraftVisibilityFilter', () => {
    it('returns empty object for writers (no filtering)', () => {
        const filter = buildDraftVisibilityFilter(true, 'user-1');
        expect(filter).toEqual({});
    });

    it('returns OR clause for non-writers with default field names', () => {
        const filter = buildDraftVisibilityFilter(false, 'user-1');
        expect(filter).toEqual({
            OR: [
                { status: { not: 'DRAFT' } },
                { ownerUserId: 'user-1' },
            ],
        });
    });

    it('uses custom field names when specified', () => {
        const filter = buildDraftVisibilityFilter(
            false, 'user-1', 'assessmentStatus', 'createdById',
        );
        expect(filter).toEqual({
            OR: [
                { assessmentStatus: { not: 'DRAFT' } },
                { createdById: 'user-1' },
            ],
        });
    });

    it('filter uses correct userId', () => {
        const filter = buildDraftVisibilityFilter(false, 'user-abc-123');
        const orClauses = (filter as any).OR;
        expect(orClauses[1]).toEqual({ ownerUserId: 'user-abc-123' });
    });

    // ─── Integration-style: simulate filter application ──────────

    describe('simulated filter application', () => {
        type MockEntity = { id: string; status: string; ownerUserId: string };

        const entities: MockEntity[] = [
            { id: 'p1', status: 'DRAFT',     ownerUserId: 'user-a' },
            { id: 'p2', status: 'DRAFT',     ownerUserId: 'user-b' },
            { id: 'p3', status: 'PUBLISHED', ownerUserId: 'user-a' },
            { id: 'p4', status: 'PUBLISHED', ownerUserId: 'user-c' },
            { id: 'p5', status: 'ARCHIVED',  ownerUserId: 'user-a' },
            { id: 'p6', status: 'DRAFT',     ownerUserId: 'user-c' },
        ];

        function applyFilter(filter: Record<string, unknown>, data: MockEntity[]): MockEntity[] {
            if (!filter.OR) return data; // no filter = return all

            const orClauses = filter.OR as Record<string, any>[];
            return data.filter(entity =>
                orClauses.some(clause => {
                    if (clause.status?.not) return entity.status !== clause.status.not;
                    if (clause.ownerUserId) return entity.ownerUserId === clause.ownerUserId;
                    return false;
                }),
            );
        }

        it('writer sees all 6 entities', () => {
            const filter = buildDraftVisibilityFilter(true, 'user-a');
            const visible = applyFilter(filter, entities);
            expect(visible).toHaveLength(6);
        });

        it('reader user-a sees own drafts + all published/archived (4 entities)', () => {
            const filter = buildDraftVisibilityFilter(false, 'user-a');
            const visible = applyFilter(filter, entities);
            expect(visible.map(e => e.id)).toEqual(['p1', 'p3', 'p4', 'p5']);
        });

        it('reader user-b sees own drafts + all published/archived (4 entities)', () => {
            const filter = buildDraftVisibilityFilter(false, 'user-b');
            const visible = applyFilter(filter, entities);
            expect(visible.map(e => e.id)).toEqual(['p2', 'p3', 'p4', 'p5']);
        });

        it('reader user-c sees own drafts + all published/archived (5 entities)', () => {
            const filter = buildDraftVisibilityFilter(false, 'user-c');
            const visible = applyFilter(filter, entities);
            expect(visible.map(e => e.id)).toEqual(['p3', 'p4', 'p5', 'p6']);
        });

        it('reader with no owned drafts sees only published/archived (3 entities)', () => {
            const filter = buildDraftVisibilityFilter(false, 'user-nobody');
            const visible = applyFilter(filter, entities);
            expect(visible.map(e => e.id)).toEqual(['p3', 'p4', 'p5']);
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// 4. assertCanViewDraftEntity (Policy Enforcement)
// ═════════════════════════════════════════════════════════════════════

describe('assertCanViewDraftEntity', () => {
    // ─── Published entities — always allowed ─────────────────────

    describe('published entities', () => {
        it.each(['ADMIN', 'EDITOR', 'READER', 'AUDITOR'])(
            '%s can view published entities',
            (role) => {
                expect(() => assertCanViewDraftEntity(ctx(role), 'PUBLISHED', 'other-user'))
                    .not.toThrow();
            },
        );
    });

    // ─── Archived entities — always allowed ──────────────────────

    describe('archived entities', () => {
        it.each(['ADMIN', 'EDITOR', 'READER', 'AUDITOR'])(
            '%s can view archived entities',
            (role) => {
                expect(() => assertCanViewDraftEntity(ctx(role), 'ARCHIVED', 'other-user'))
                    .not.toThrow();
            },
        );
    });

    // ─── Draft entities — conditional ────────────────────────────

    describe('draft entities', () => {
        it('ADMIN can view any draft (canWrite=true)', () => {
            expect(() => assertCanViewDraftEntity(ctx('ADMIN'), 'DRAFT', 'other-user'))
                .not.toThrow();
        });

        it('EDITOR can view any draft (canWrite=true)', () => {
            expect(() => assertCanViewDraftEntity(ctx('EDITOR'), 'DRAFT', 'other-user'))
                .not.toThrow();
        });

        it('READER can view own draft', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('READER', { userId: 'user-1' }), 'DRAFT', 'user-1',
            )).not.toThrow();
        });

        it('READER CANNOT view other user draft', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('READER', { userId: 'user-1' }), 'DRAFT', 'other-user',
            )).toThrow(AppError);
            expect(() => assertCanViewDraftEntity(
                ctx('READER', { userId: 'user-1' }), 'DRAFT', 'other-user',
            )).toThrow(/draft/i);
        });

        it('AUDITOR can view own draft', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('AUDITOR', { userId: 'user-1' }), 'DRAFT', 'user-1',
            )).not.toThrow();
        });

        it('AUDITOR CANNOT view other user draft', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('AUDITOR', { userId: 'user-1' }), 'DRAFT', 'other-user',
            )).toThrow(AppError);
        });

        it('READER CANNOT view draft with null owner', () => {
            expect(() => assertCanViewDraftEntity(
                ctx('READER', { userId: 'user-1' }), 'DRAFT', null,
            )).toThrow(AppError);
        });
    });

    // ─── Error message quality ───────────────────────────────────

    describe('error messages', () => {
        it('includes draft visibility explanation', () => {
            try {
                assertCanViewDraftEntity(
                    ctx('READER', { userId: 'user-1' }), 'DRAFT', 'other-user',
                );
                expect(true).toBe(false); // Should have thrown
            } catch (e: any) {
                expect(e.message).toContain('draft');
                expect(e.message).toContain('write permission');
            }
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Lifecycle Integration (Visibility Through State Transitions)
// ═════════════════════════════════════════════════════════════════════

describe('Visibility through lifecycle transitions', () => {
    const ownership: DraftOwnership = { ownerUserId: 'author-1' };

    it('entity starts as draft — hidden from non-owner readers', () => {
        const state = createEditableState<TestPayload>({ content: 'draft' });
        expect(isDraftVisibleTo(state, ownership, 'reader-1', false)).toBe(false);
        expect(isDraftVisibleTo(state, ownership, 'author-1', false)).toBe(true);
    });

    it('after publish — visible to everyone', () => {
        let state = createEditableState<TestPayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin-1' });
        expect(isDraftVisibleTo(state, ownership, 'reader-1', false)).toBe(true);
    });

    it('after archive — still visible to everyone', () => {
        let state = createEditableState<TestPayload>({ content: 'v1' });
        state = publish(state, { publishedBy: 'admin-1' });
        state = archive(state);
        expect(isDraftVisibleTo(state, ownership, 'reader-1', false)).toBe(true);
    });

    it('published entity with new draft — hidden from readers', () => {
        // Simulates: published entity where someone created a new draft version
        // The entity is now in DRAFT phase (back to editing)
        const state: EditableState<TestPayload> = {
            phase: 'DRAFT',
            currentVersion: 2,
            draft: { content: 'v2 draft' },
            published: { content: 'v1 live' },
            publishedBy: 'admin-1',
            publishedChangeSummary: null,
            history: [],
        };
        // But the PHASE is DRAFT, so it's hidden from non-writers
        // In production, the list query would use status field filtering
        expect(isDraftVisibleTo(state, ownership, 'reader-1', false)).toBe(false);
        expect(isDraftVisibleTo(state, ownership, 'author-1', false)).toBe(true);
        expect(isDraftVisibleTo(state, ownership, 'editor-1', true)).toBe(true);
    });
});
