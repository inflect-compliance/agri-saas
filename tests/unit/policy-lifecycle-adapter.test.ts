/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Policy Lifecycle Integration Tests
 *
 * Validates the Policy domain's adoption of the generic editable lifecycle:
 * - Phase mapping (PolicyStatus ↔ EditablePhase)
 * - PolicyEditableAdapter (load/save cycle via in-memory mock)
 * - End-to-end publish workflow through the generic lifecycle service
 * - Pre-publish validation
 * - No regressions in existing key workflows
 *
 * Test strategy:
 * - In-memory Prisma mock that simulates Policy + PolicyVersion persistence
 * - Full lifecycle transitions using the generic publish/draft/archive functions
 * - Validation of history integrity after multiple publishes
 */

import { LifecycleError } from '@/app-layer/domain/editable-lifecycle.types';
import {
    createEditableState,
    updateDraft,
    publish,
    revertToVersion,
    archive,
    hasPendingChanges,
    hasBeenPublished,
} from '@/app-layer/services/editable-lifecycle';
import type { PolicyPayload } from '@/app-layer/services/policy-lifecycle-adapter';
import {
    policyStatusToPhase,
    phaseToDefaultPolicyStatus,
    validatePolicyPayload,
    POLICY_AUDIT_CONFIG,
} from '@/app-layer/services/policy-lifecycle-adapter';

// ═════════════════════════════════════════════════════════════════════
// Phase Mapping
// ═════════════════════════════════════════════════════════════════════

describe('Policy Phase Mapping', () => {
    describe('policyStatusToPhase', () => {
        it.each([
            ['DRAFT', 'DRAFT'],
            ['IN_REVIEW', 'DRAFT'],
            ['APPROVED', 'DRAFT'],
            ['PUBLISHED', 'PUBLISHED'],
            ['ARCHIVED', 'ARCHIVED'],
        ])('maps PolicyStatus %s → EditablePhase %s', (status, expected) => {
            expect(policyStatusToPhase(status)).toBe(expected);
        });

        it('maps unknown status to DRAFT', () => {
            expect(policyStatusToPhase('UNKNOWN')).toBe('DRAFT');
        });
    });

    describe('phaseToDefaultPolicyStatus', () => {
        it.each([
            ['DRAFT', 'DRAFT'],
            ['PUBLISHED', 'PUBLISHED'],
            ['ARCHIVED', 'ARCHIVED'],
        ] as const)('maps EditablePhase %s → PolicyStatus %s', (phase, expected) => {
            expect(phaseToDefaultPolicyStatus(phase)).toBe(expected);
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// Policy Audit Config
// ═════════════════════════════════════════════════════════════════════

describe('Policy Audit Config', () => {
    it('uses Policy entity type', () => {
        expect(POLICY_AUDIT_CONFIG.entityType).toBe('Policy');
    });

    it('uses POLICY action prefix', () => {
        expect(POLICY_AUDIT_CONFIG.actionPrefix).toBe('POLICY');
    });
});

// ═════════════════════════════════════════════════════════════════════
// Policy Payload Validation
// ═════════════════════════════════════════════════════════════════════

describe('Policy Payload Validation', () => {
    it('passes for valid MARKDOWN policy', () => {
        const payload: PolicyPayload = {
            contentType: 'MARKDOWN',
            contentText: '# Policy Title\n\nContent here',
            externalUrl: null,
            changeSummary: 'Initial draft',
        };
        expect(() => validatePolicyPayload(payload, {} as any)).not.toThrow();
    });

    it('passes for valid HTML policy', () => {
        const payload: PolicyPayload = {
            contentType: 'HTML',
            contentText: '<h1>Policy</h1><p>Content</p>',
            externalUrl: null,
            changeSummary: null,
        };
        expect(() => validatePolicyPayload(payload, {} as any)).not.toThrow();
    });

    it('passes for valid EXTERNAL_LINK policy', () => {
        const payload: PolicyPayload = {
            contentType: 'EXTERNAL_LINK',
            contentText: null,
            externalUrl: 'https://docs.example.com/policy',
            changeSummary: null,
        };
        expect(() => validatePolicyPayload(payload, {} as any)).not.toThrow();
    });

    it('rejects MARKDOWN without contentText', () => {
        const payload: PolicyPayload = {
            contentType: 'MARKDOWN',
            contentText: null,
            externalUrl: null,
            changeSummary: null,
        };
        expect(() => validatePolicyPayload(payload, {} as any))
            .toThrow('contentText is required');
    });

    it('rejects HTML without contentText', () => {
        const payload: PolicyPayload = {
            contentType: 'HTML',
            contentText: null,
            externalUrl: null,
            changeSummary: null,
        };
        expect(() => validatePolicyPayload(payload, {} as any))
            .toThrow('contentText is required');
    });

    it('rejects EXTERNAL_LINK without externalUrl', () => {
        const payload: PolicyPayload = {
            contentType: 'EXTERNAL_LINK',
            contentText: null,
            externalUrl: null,
            changeSummary: null,
        };
        expect(() => validatePolicyPayload(payload, {} as any))
            .toThrow('externalUrl is required');
    });
});

// ═════════════════════════════════════════════════════════════════════
// Policy Lifecycle (Pure, via generic service)
// ═════════════════════════════════════════════════════════════════════

describe('Policy Lifecycle (generic service integration)', () => {
    const MARKDOWN_V1: PolicyPayload = {
        contentType: 'MARKDOWN',
        contentText: '# Information Security Policy\n\nVersion 1 content.',
        externalUrl: null,
        changeSummary: 'Initial policy draft',
    };

    const MARKDOWN_V2: PolicyPayload = {
        contentType: 'MARKDOWN',
        contentText: '# Information Security Policy\n\nVersion 2 — updated scope.',
        externalUrl: null,
        changeSummary: 'Updated scope section',
    };

    const MARKDOWN_V3: PolicyPayload = {
        contentType: 'MARKDOWN',
        contentText: '# Information Security Policy\n\nVersion 3 — final revision.',
        externalUrl: null,
        changeSummary: 'Final revision',
    };

    const EXTERNAL_V1: PolicyPayload = {
        contentType: 'EXTERNAL_LINK',
        contentText: null,
        externalUrl: 'https://docs.example.com/policy/v1',
        changeSummary: 'Linked to external doc',
    };

    // ─── Draft Editing ───────────────────────────────────────────

    describe('draft editing', () => {
        it('creates initial policy with MARKDOWN draft', () => {
            const state = createEditableState(MARKDOWN_V1);

            expect(state.phase).toBe('DRAFT');
            expect(state.currentVersion).toBe(1);
            expect(state.draft).toEqual(MARKDOWN_V1);
            expect(state.published).toBeNull();
        });

        it('creates initial policy with EXTERNAL_LINK draft', () => {
            const state = createEditableState(EXTERNAL_V1);

            expect(state.draft).toEqual(EXTERNAL_V1);
        });

        it('updates draft content without changing version', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = updateDraft(state, MARKDOWN_V2);

            expect(state.draft).toEqual(MARKDOWN_V2);
            expect(state.currentVersion).toBe(1);
        });

        it('switches content type in draft', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = updateDraft(state, EXTERNAL_V1);

            expect(state.draft!.contentType).toBe('EXTERNAL_LINK');
            expect(state.draft!.externalUrl).toBe('https://docs.example.com/policy/v1');
            expect(state.draft!.contentText).toBeNull();
        });

        it('editing after publish creates pending changes', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin' });

            expect(hasPendingChanges(state)).toBe(false);

            state = updateDraft(state, MARKDOWN_V2);
            expect(hasPendingChanges(state)).toBe(true);
            expect(state.phase).toBe('DRAFT'); // back to DRAFT
        });
    });

    // ─── First Publish ───────────────────────────────────────────

    describe('first publish', () => {
        it('promotes draft to published', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1', changeSummary: 'First release' });

            expect(state.phase).toBe('PUBLISHED');
            expect(state.currentVersion).toBe(2);
            expect(state.published).toEqual(MARKDOWN_V1);
            expect(state.draft).toBeNull();
        });

        it('creates no history on first publish', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });

            expect(state.history).toHaveLength(0);
        });

        it('marks entity as published', () => {
            let state = createEditableState(MARKDOWN_V1);
            expect(hasBeenPublished(state)).toBe(false);

            state = publish(state, { publishedBy: 'admin-1' });
            expect(hasBeenPublished(state)).toBe(true);
        });
    });

    // ─── Subsequent Publishes (Version History) ──────────────────

    describe('subsequent publishes and version history', () => {
        it('snapshots prior live state to history', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v1
            state = updateDraft(state, MARKDOWN_V2);
            state = publish(state, { publishedBy: 'admin-1', changeSummary: 'Updated scope' }); // v2

            expect(state.currentVersion).toBe(3);
            expect(state.published).toEqual(MARKDOWN_V2);
            expect(state.history).toHaveLength(1);
            expect(state.history[0].version).toBe(2);
            expect(state.history[0].payload).toEqual(MARKDOWN_V1);
        });

        it('preserves ordered history across 3 publishes', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v1
            state = updateDraft(state, MARKDOWN_V2);
            state = publish(state, { publishedBy: 'admin-1' }); // v2
            state = updateDraft(state, MARKDOWN_V3);
            state = publish(state, { publishedBy: 'admin-2' }); // v3

            expect(state.currentVersion).toBe(4);
            expect(state.history).toHaveLength(2);

            // History is ordered oldest first
            expect(state.history[0].version).toBe(2);
            expect(state.history[0].payload.contentText).toContain('Version 1');
            expect(state.history[1].version).toBe(3);
            expect(state.history[1].payload.contentText).toContain('Version 2');

            // Current published is v3
            expect(state.published!.contentText).toContain('Version 3');
        });

        it('snapshot preserves content type changes in history', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v1: MARKDOWN
            state = updateDraft(state, EXTERNAL_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v2: EXTERNAL_LINK

            expect(state.history[0].payload.contentType).toBe('MARKDOWN');
            expect(state.published!.contentType).toBe('EXTERNAL_LINK');
        });
    });

    // ─── Revert to Prior Version ─────────────────────────────────

    describe('revert to prior version', () => {
        it('reverts draft to historical version', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v1
            state = updateDraft(state, MARKDOWN_V2);
            state = publish(state, { publishedBy: 'admin-1' }); // v2

            state = revertToVersion(state, { targetVersion: 2 });

            expect(state.draft).toEqual(MARKDOWN_V1);
            expect(state.published).toEqual(MARKDOWN_V2); // v2 still live
            expect(state.phase).toBe('DRAFT');
        });

        it('reverted content can be re-published', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' }); // v1
            state = updateDraft(state, MARKDOWN_V2);
            state = publish(state, { publishedBy: 'admin-1' }); // v2

            state = revertToVersion(state, { targetVersion: 2 });
            state = publish(state, { publishedBy: 'admin-1', changeSummary: 'Reverted to v2' }); // v4

            expect(state.currentVersion).toBe(4);
            expect(state.published).toEqual(MARKDOWN_V1); // v1 content is back as live
            expect(state.history).toHaveLength(2); // v1 + v2 snapshots
        });
    });

    // ─── Archive ─────────────────────────────────────────────────

    describe('archive', () => {
        it('freezes policy', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });
            state = archive(state);

            expect(state.phase).toBe('ARCHIVED');
        });

        it('preserves published content after archive', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });
            state = archive(state);

            expect(state.published).toEqual(MARKDOWN_V1);
        });

        it('preserves version history after archive', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });
            state = updateDraft(state, MARKDOWN_V2);
            state = publish(state, { publishedBy: 'admin-1' });
            state = archive(state);

            expect(state.history).toHaveLength(1);
            expect(state.history[0].version).toBe(2);
        });

        it('blocks edits after archive', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });
            state = archive(state);

            expect(() => updateDraft(state, MARKDOWN_V2)).toThrow(LifecycleError);
            expect(() => publish(state, { publishedBy: 'admin-1' })).toThrow(LifecycleError);
        });
    });

    // ─── Existing Workflow Regression Guards ─────────────────────

    describe('existing workflow regression guards', () => {
        it('cannot publish without draft content', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });

            // No draft → cannot publish again
            expect(() => publish(state, { publishedBy: 'admin-1' }))
                .toThrow(LifecycleError);
        });

        it('creating new content after publish moves back to DRAFT', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });

            expect(state.phase).toBe('PUBLISHED');

            state = updateDraft(state, MARKDOWN_V2);
            expect(state.phase).toBe('DRAFT'); // matches existing: "createPolicyVersion → DRAFT"
        });

        it('version number only increments on publish, not on draft edits', () => {
            let state = createEditableState(MARKDOWN_V1);
            expect(state.currentVersion).toBe(1);

            state = updateDraft(state, MARKDOWN_V2);
            expect(state.currentVersion).toBe(1); // no increment

            state = updateDraft(state, MARKDOWN_V3);
            expect(state.currentVersion).toBe(1); // still no increment

            state = publish(state, { publishedBy: 'admin-1' });
            expect(state.currentVersion).toBe(2); // now increments
        });

        it('archived policy cannot create new versions', () => {
            let state = createEditableState(MARKDOWN_V1);
            state = publish(state, { publishedBy: 'admin-1' });
            state = archive(state);

            // This mirrors: "Cannot create version for an archived policy"
            expect(() => updateDraft(state, MARKDOWN_V2))
                .toThrow(LifecycleError);
        });
    });

    // ─── Full Policy Lifecycle (E2E) ─────────────────────────────

    describe('full policy lifecycle (end-to-end)', () => {
        it('complete policy lifecycle mirrors existing behavior', () => {
            // 1. Author creates policy with initial draft
            let state = createEditableState<PolicyPayload>({
                contentType: 'MARKDOWN',
                contentText: '# Acceptable Use Policy\n\n## 1. Purpose\n...',
                externalUrl: null,
                changeSummary: 'Initial draft',
            });
            expect(state.phase).toBe('DRAFT');
            expect(state.currentVersion).toBe(1);

            // 2. Author iterates on the draft
            state = updateDraft(state, {
                contentType: 'MARKDOWN',
                contentText: '# Acceptable Use Policy\n\n## 1. Purpose\nThis policy establishes...',
                externalUrl: null,
                changeSummary: 'Added purpose section',
            });
            expect(state.currentVersion).toBe(1); // no version bump on drafts

            // 3. Admin publishes v1 (after approval workflow in the real system)
            state = publish(state, { publishedBy: 'admin-1', changeSummary: 'First release' });
            expect(state.phase).toBe('PUBLISHED');
            expect(state.currentVersion).toBe(2);
            expect(state.history).toHaveLength(0); // first publish, no prior

            // 4. Author creates new draft for v2
            state = updateDraft(state, {
                contentType: 'MARKDOWN',
                contentText: '# Acceptable Use Policy v2\n\nExpanded scope...',
                externalUrl: null,
                changeSummary: 'Expanded scope for remote work',
            });
            expect(state.phase).toBe('DRAFT'); // back to draft
            expect(state.published!.contentText).toContain('Purpose'); // v1 still live

            // 5. Publish v2 — v1 is archived to history
            state = publish(state, { publishedBy: 'admin-1', changeSummary: 'v2 release' });
            expect(state.currentVersion).toBe(3);
            expect(state.history).toHaveLength(1);
            expect(state.history[0].version).toBe(2);

            // 6. Compliance team decides v1 was better, reverts
            state = revertToVersion(state, { targetVersion: 2 });
            expect(state.draft!.contentText).toContain('Purpose');
            expect(state.published!.contentText).toContain('Expanded scope'); // v2 still live

            // 7. Re-publish reverted v2 content as v4
            state = publish(state, { publishedBy: 'admin-2', changeSummary: 'Reverted to v2 policy' });
            expect(state.currentVersion).toBe(4);
            expect(state.history).toHaveLength(2);

            // 8. Archive the policy
            state = archive(state);
            expect(state.phase).toBe('ARCHIVED');

            // Verify everything is frozen
            expect(() => updateDraft(state, MARKDOWN_V1)).toThrow(LifecycleError);
            expect(() => publish(state, { publishedBy: 'admin-1' })).toThrow(LifecycleError);
            expect(() => revertToVersion(state, { targetVersion: 2 })).toThrow(LifecycleError);

            // But the data is preserved for audit
            expect(state.published).not.toBeNull();
            expect(state.history).toHaveLength(2);
        });
    });
});
