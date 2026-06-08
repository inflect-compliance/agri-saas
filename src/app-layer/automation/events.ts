/**
 * Canonical catalog of domain events that automation rules can subscribe to.
 *
 * An AutomationRule.triggerEvent is a free-form string in the database so
 * new events can be emitted without a schema migration. This file is the
 * *producer-side* contract: any code that either emits an event (audit
 * writers, usecase hooks) or lets a user pick one (builder UI) imports
 * from here. Typos at the producer side become compile errors; typos in
 * stored rules become runtime "no matching event" non-firings.
 *
 * Names mirror the `action` strings already written to the audit log so
 * the automation layer can plug into the same event stream without a
 * translation table.
 */

export const AUTOMATION_EVENTS = {
    // ─── Risk lifecycle ───
    RISK_CREATED: 'RISK_CREATED',
    RISK_UPDATED: 'RISK_UPDATED',
    RISK_STATUS_CHANGED: 'RISK_STATUS_CHANGED',
    RISK_CONTROLS_MAPPED: 'RISK_CONTROLS_MAPPED',

    // ─── Control testing ───
    TEST_PLAN_CREATED: 'TEST_PLAN_CREATED',
    TEST_PLAN_UPDATED: 'TEST_PLAN_UPDATED',
    TEST_PLAN_PAUSED: 'TEST_PLAN_PAUSED',
    TEST_PLAN_RESUMED: 'TEST_PLAN_RESUMED',
    TEST_RUN_CREATED: 'TEST_RUN_CREATED',
    TEST_RUN_COMPLETED: 'TEST_RUN_COMPLETED',
    TEST_RUN_FAILED: 'TEST_RUN_FAILED',
    // Emitted by emitTestEvidenceLinked/Unlinked — now subscribable (was
    // producer/catalog drift: emitted but absent from the catalog).
    TEST_EVIDENCE_LINKED: 'TEST_EVIDENCE_LINKED',
    TEST_EVIDENCE_UNLINKED: 'TEST_EVIDENCE_UNLINKED',

    // ─── Evidence lifecycle (high-value automation: "notify the owner
    //     when their evidence is about to go stale / has expired") ───
    EVIDENCE_EXPIRING: 'EVIDENCE_EXPIRING',
    EVIDENCE_EXPIRED: 'EVIDENCE_EXPIRED',

    // ─── Onboarding ───
    ONBOARDING_STARTED: 'ONBOARDING_STARTED',
    ONBOARDING_STEP_COMPLETED: 'ONBOARDING_STEP_COMPLETED',
    ONBOARDING_FINISHED: 'ONBOARDING_FINISHED',
    ONBOARDING_RESTARTED: 'ONBOARDING_RESTARTED',

    // ─── Tasks (high-value automation: "notify owner", "escalate if
    //     SLA breached", "auto-close related issues") ───
    TASK_CREATED: 'TASK_CREATED',
    TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',

    // ─── Issues (high-value automation: incident detection, alert
    //     routing, cross-issue linkage) ───
    ISSUE_CREATED: 'ISSUE_CREATED',
    ISSUE_STATUS_CHANGED: 'ISSUE_STATUS_CHANGED',

    // ─── Time-based (PR-E) — synthesized by the cron-trigger-sweep N days
    //     before a target entity's due date. The single Archer-parity
    //     time/schedule trigger; the schedule lives in
    //     AutomationRule.scheduleConfigJson, the fired entity in the payload. ───
    SCHEDULE: 'SCHEDULE',

    // ─── Domain coverage fill (cycle-2 follow-up) — three high-value triggers
    //     the audit flagged as missing: control lifecycle, policy governance,
    //     and vendor-risk deadlines. ───
    CONTROL_STATUS_CHANGED: 'CONTROL_STATUS_CHANGED',
    POLICY_REVIEW_DUE: 'POLICY_REVIEW_DUE',
    VENDOR_ASSESSMENT_OVERDUE: 'VENDOR_ASSESSMENT_OVERDUE',
} as const;

export type AutomationEventName =
    (typeof AUTOMATION_EVENTS)[keyof typeof AUTOMATION_EVENTS];

/** Runtime list — used by the builder UI and validation guards. */
export const AUTOMATION_EVENT_NAMES: readonly AutomationEventName[] =
    Object.values(AUTOMATION_EVENTS);

/** Narrow an arbitrary string to a known catalog entry (e.g. builder input). */
export function isKnownAutomationEvent(
    value: string
): value is AutomationEventName {
    return (AUTOMATION_EVENT_NAMES as readonly string[]).includes(value);
}
