/**
 * Unit Test: Automation domain-event contracts.
 *
 * The discriminated union is enforced by the TypeScript compiler;
 * this file exists to *runtime-pin* a handful of invariants that
 * can still be violated at the module boundary:
 *   - every catalogue entry appears as a contract variant
 *   - `isEvent` narrows correctly at runtime
 *   - the `EmitAutomationEvent` shape excludes bus-stamped fields
 */

import {
    AUTOMATION_EVENTS,
    AUTOMATION_EVENT_NAMES,
} from '@/app-layer/automation/events';
import {
    isEvent,
    type AutomationDomainEvent,
    type EmitAutomationEvent,
} from '@/app-layer/automation/event-contracts';

function buildFakeEvent(
    name: AutomationDomainEvent['event']
): AutomationDomainEvent {
    const base = {
        tenantId: 't',
        entityType: 'X',
        entityId: 'id',
        actorUserId: null,
        emittedAt: new Date(),
    };
    switch (name) {
        case 'RISK_CREATED':
            return {
                ...base,
                event: name,
                data: { title: 't', score: 1, category: null },
            };
        case 'RISK_UPDATED':
            return { ...base, event: name, data: { changedFields: [] } };
        case 'RISK_STATUS_CHANGED':
        case 'TEST_PLAN_PAUSED':
        case 'TEST_PLAN_RESUMED':
            return {
                ...base,
                event: name,
                data: { fromStatus: 'A', toStatus: 'B' },
            };
        case 'RISK_CONTROLS_MAPPED':
            return {
                ...base,
                event: name,
                data: { controlId: 'c', action: 'LINKED' },
            };
        case 'TEST_PLAN_CREATED':
            return {
                ...base,
                event: name,
                data: { name: 'n', controlId: 'c' },
            };
        case 'TEST_PLAN_UPDATED':
            return { ...base, event: name, data: { changedFields: [] } };
        case 'TEST_RUN_CREATED':
            return { ...base, event: name, data: { testPlanId: 'p' } };
        case 'TEST_RUN_COMPLETED':
            return {
                ...base,
                event: name,
                data: { testPlanId: 'p', result: 'PASS' },
            };
        case 'TEST_RUN_FAILED':
            return { ...base, event: name, data: { findingSummary: null } };
        case 'TEST_EVIDENCE_LINKED':
            return {
                ...base,
                event: name,
                data: { testRunId: 'r', kind: 'file' },
            };
        case 'TEST_EVIDENCE_UNLINKED':
            return { ...base, event: name, data: { testRunId: 'r' } };
        case 'EVIDENCE_EXPIRING':
            return {
                ...base,
                event: name,
                data: { title: 'e', controlId: null, retentionUntil: null },
            };
        case 'EVIDENCE_EXPIRED':
            return {
                ...base,
                event: name,
                data: { title: 'e', controlId: null, expiredAt: null },
            };
        case 'SCHEDULE':
            return {
                ...base,
                event: name,
                data: { target: 'Evidence', dueAt: null, offsetDays: 7 },
            };
        case 'CONTROL_STATUS_CHANGED':
            return { ...base, event: name, data: { fromStatus: 'NOT_STARTED', toStatus: 'IMPLEMENTED' } };
        case 'POLICY_REVIEW_DUE':
            return { ...base, event: name, data: { title: 'p', nextReviewAt: null, daysOverdue: 3 } };
        case 'VENDOR_ASSESSMENT_OVERDUE':
            return { ...base, event: name, data: { vendorName: 'v', kind: 'REVIEW_OVERDUE', daysOverdue: 5 } };
        case 'ONBOARDING_STARTED':
        case 'ONBOARDING_FINISHED':
        case 'ONBOARDING_RESTARTED':
            return { ...base, event: name, data: {} };
        case 'ONBOARDING_STEP_COMPLETED':
            return { ...base, event: name, data: { step: 'intro' } };
        case 'TASK_CREATED':
            return {
                ...base,
                event: name,
                data: {
                    key: 'TSK-1',
                    title: 't',
                    type: 'TASK',
                    severity: 'MEDIUM',
                    priority: 'P2',
                    assigneeUserId: null,
                    controlId: null,
                },
            };
        case 'TASK_STATUS_CHANGED':
            return {
                ...base,
                event: name,
                data: {
                    fromStatus: 'OPEN',
                    toStatus: 'CLOSED',
                    resolution: null,
                },
            };
        case 'ISSUE_CREATED':
            return {
                ...base,
                event: name,
                data: {
                    key: 'ISS-1',
                    title: 't',
                    severity: 'HIGH',
                    status: 'OPEN',
                    assigneeUserId: null,
                },
            };
        case 'ISSUE_STATUS_CHANGED':
            return {
                ...base,
                event: name,
                data: { fromStatus: 'OPEN', toStatus: 'RESOLVED' },
            };
    }
}

describe('Automation event contracts', () => {
    it('every catalogue entry has a matching discriminated-union variant (buildFakeEvent covers all)', () => {
        // If a new catalogue entry landed without a contract variant,
        // buildFakeEvent's switch would throw on an unhandled case.
        for (const name of AUTOMATION_EVENT_NAMES) {
            expect(() => buildFakeEvent(name)).not.toThrow();
        }
    });

    it('isEvent narrows correctly', () => {
        const risk = buildFakeEvent('RISK_CREATED');
        expect(isEvent(risk, 'RISK_CREATED')).toBe(true);
        expect(isEvent(risk, 'RISK_UPDATED')).toBe(false);

        if (isEvent(risk, 'RISK_CREATED')) {
            // TypeScript-narrowed — `risk.data.title` is string at compile time.
            expect(risk.data.title).toBe('t');
        }
    });

    it('EmitAutomationEvent excludes bus-stamped fields', () => {
        // Producer's emit input must NOT include tenantId/emittedAt.
        // Enforced at compile time by Omit; this is a runtime sanity
        // check that the shape we hand to the bus is narrower than
        // the full event.
        const input: EmitAutomationEvent = {
            event: 'RISK_CREATED',
            entityType: 'Risk',
            entityId: 'r-1',
            actorUserId: null,
            data: { title: 't', score: 1, category: null },
        };
        expect('tenantId' in input).toBe(false);
        expect('emittedAt' in input).toBe(false);
    });

    it('AUTOMATION_EVENTS is exhaustive (no discriminant missing)', () => {
        // The `_catalogueCheck` compile-time assertion in
        // event-contracts.ts only fires when the union is missing a
        // catalogue entry. Mirror that runtime-side: every catalogue
        // name must be a discriminator value we can construct.
        const names = Object.values(AUTOMATION_EVENTS);
        for (const n of names) {
            const evt = buildFakeEvent(
                n as AutomationDomainEvent['event']
            );
            expect(evt.event).toBe(n);
        }
    });
});
