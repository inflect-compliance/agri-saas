'use client';
/**
 * Epic G-2 — Test plan scheduling UI.
 *
 * A self-contained section that renders inside the test-plan
 * detail page (`controls/[controlId]/tests/[planId]`). Lets a
 * privileged user pick a business-friendly cadence (Off / Daily /
 * Weekly / Monthly / Quarterly) and persists the choice via the
 * G-2 schedule API (`PUT /tests/plans/:id/schedule`).
 *
 * Cron strings are NEVER exposed to the user — the component owns
 * the cadence-to-cron mapping internally. This honours the
 * prompt-5 constraint that normal users see business-friendly
 * choices, not raw cron.
 *
 * Timezone defaults to the browser's IANA tz from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` so a user in
 * Sofia scheduling "Daily 09:00" actually gets 09:00 local, not
 * 09:00 UTC. The next-run timestamp re-renders in the same zone
 * via the existing `formatDate` primitive.
 *
 * Permission gating mirrors the edit form on the same page: the
 * picker is disabled when `canEdit=false`, and the save action is
 * hidden. Save is also hidden until the user changes something
 * away from the saved state — eliminates the "did I have to click
 * save?" confusion.
 */
import { useMemo, useState } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { formatDate } from '@/lib/format-date';

// ─── Cadence catalog ───────────────────────────────────────────────
//
// `cron` is hidden from the UI. The user only ever sees `label`.
// AT-MINUTE-09:00 is the deliberate convention — every cadence
// fires at 09:00 local-tz, mid-business-day enough to surface in
// dashboards but not a 3 AM-cron-job vibe. Future advanced-mode
// UI can let users tune the time; for now, business-friendly
// defaults beat option overload.

interface Cadence {
    value: 'OFF' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
    label: string;
    description: string;
    cron: string | null;
}

const CADENCES: Cadence[] = [
    {
        value: 'OFF',
        label: 'Off (manual)',
        description: 'Test runs are created on demand. No auto-schedule.',
        cron: null,
    },
    {
        value: 'DAILY',
        label: 'Daily at 09:00',
        description: 'Runs every day at 09:00 in your local timezone.',
        cron: '0 9 * * *',
    },
    {
        value: 'WEEKLY',
        label: 'Weekly (Mondays at 09:00)',
        description: 'Runs every Monday at 09:00.',
        cron: '0 9 * * MON',
    },
    {
        value: 'MONTHLY',
        label: 'Monthly (1st at 09:00)',
        description: 'Runs the first of every month at 09:00.',
        cron: '0 9 1 * *',
    },
    {
        value: 'QUARTERLY',
        label: 'Quarterly (1st of Jan/Apr/Jul/Oct)',
        description: 'Runs on the first of each calendar quarter at 09:00.',
        cron: '0 9 1 1,4,7,10 *',
    },
];

const CADENCE_OPTIONS: ComboboxOption[] = CADENCES.map((c) => ({
    value: c.value,
    label: c.label,
}));

/**
 * Map a stored cron string back to one of the canned cadences.
 * Anything outside the catalog is treated as a custom cron and
 * shown as "Custom schedule" — the picker doesn't change it
 * silently. (User has to explicitly choose a cadence to overwrite.)
 */
function cronToCadence(cron: string | null): Cadence['value'] | 'CUSTOM' {
    if (cron === null) return 'OFF';
    const match = CADENCES.find((c) => c.cron === cron);
    return match?.value ?? 'CUSTOM';
}

// ─── Next-run formatting ───────────────────────────────────────────

type NextRunTone = 'overdue' | 'today' | 'normal' | 'none';

function nextRunTone(nextRunAtIso: string | null): NextRunTone {
    if (!nextRunAtIso) return 'none';
    const ms = new Date(nextRunAtIso).getTime() - Date.now();
    if (ms < 0) return 'overdue';
    if (ms < 24 * 3600 * 1000) return 'today';
    return 'normal';
}

const TONE_CLASS: Record<NextRunTone, string> = {
    overdue: 'text-content-error font-semibold',
    today: 'text-content-warning font-semibold',
    normal: 'text-content-default',
    none: 'text-content-subtle',
};

const TONE_LABEL: Record<NextRunTone, string> = {
    overdue: 'Overdue',
    today: 'Today',
    normal: 'Next run',
    none: '',
};

// ─── Component ─────────────────────────────────────────────────────

export interface TestPlanScheduleSectionProps {
    planId: string;
    initialAutomationType: 'MANUAL' | 'SCRIPT' | 'INTEGRATION';
    initialSchedule: string | null;
    initialScheduleTimezone: string | null;
    initialNextRunAt: string | null;
    canEdit: boolean;
    onSaved?: () => void;
}

export function TestPlanScheduleSection({
    planId,
    initialAutomationType,
    initialSchedule,
    initialScheduleTimezone,
    initialNextRunAt,
    canEdit,
    onSaved,
}: TestPlanScheduleSectionProps) {
    const apiUrl = useTenantApiUrl();

    const browserTz = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    }, []);

    // Saved state — what the server confirmed last.
    const savedCadence = cronToCadence(initialSchedule);
    const savedTz = initialScheduleTimezone ?? browserTz;

    // Local edit state — what the user has clicked / not yet saved.
    const [pendingCadence, setPendingCadence] = useState<
        Cadence['value'] | 'CUSTOM'
    >(savedCadence);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dirty = pendingCadence !== savedCadence;
    const tone = nextRunTone(initialNextRunAt);

    const cadenceObj = CADENCES.find((c) => c.value === pendingCadence);

    async function save() {
        setSaving(true);
        setError(null);
        try {
            const target = CADENCES.find((c) => c.value === pendingCadence);
            // Defensive — should never fire because the picker only
            // surfaces catalog cadences.
            if (!target) {
                setError('Choose a cadence before saving.');
                return;
            }
            const body = {
                schedule: target.cron,
                scheduleTimezone: target.cron === null ? null : browserTz,
                automationType:
                    target.cron === null
                        ? 'MANUAL'
                        : // Default any scheduled plan to SCRIPT — INTEGRATION
                          // is reserved for advanced-mode UI that names a
                          // specific connector. For now, "scheduled" = SCRIPT.
                          'SCRIPT',
                // Preserve any existing automationConfig — the UI
                // doesn't edit it from this section.
            };
            const res = await fetch(
                apiUrl(`/tests/plans/${planId}/schedule`),
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                let parsed: { error?: string } | null = null;
                try {
                    parsed = JSON.parse(txt);
                } catch { /* keep as text */ }
                setError(
                    parsed?.error ??
                        txt ??
                        `Failed to save schedule (${res.status})`,
                );
                return;
            }
            onSaved?.();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Could not save schedule',
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="glass-card p-4 space-y-3"
            id="test-plan-schedule-section"
            data-testid="test-plan-schedule-section"
        >
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-content-default">
                    Schedule
                </h3>
                <span className="text-xs text-content-subtle">
                    All times in {browserTz}
                </span>
            </div>

            {/* Frequency picker */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div className="md:col-span-2">
                    <label
                        className="text-xs text-content-muted block mb-1"
                        htmlFor="test-plan-schedule-cadence"
                    >
                        Frequency
                    </label>
                    <Combobox
                        hideSearch
                        id="test-plan-schedule-cadence"
                        disabled={!canEdit || saving}
                        selected={
                            CADENCE_OPTIONS.find(
                                (o) => o.value === pendingCadence,
                            ) ?? null
                        }
                        setSelected={(opt) => {
                            if (opt && opt.value !== pendingCadence) {
                                setPendingCadence(
                                    opt.value as Cadence['value'],
                                );
                                setError(null);
                            }
                        }}
                        options={CADENCE_OPTIONS}
                        matchTriggerWidth
                    />
                    {cadenceObj && (
                        <p className="text-xs text-content-subtle mt-1">
                            {cadenceObj.description}
                        </p>
                    )}
                    {pendingCadence === 'CUSTOM' && (
                        <p
                            className="text-xs text-content-warning mt-1"
                            data-testid="test-plan-custom-schedule-warning"
                        >
                            This plan has a custom schedule that doesn&apos;t
                            match the standard cadences. Choosing a
                            cadence above will overwrite it.
                        </p>
                    )}
                </div>

                {/* Next-run indicator */}
                <div
                    className="md:pt-5"
                    data-testid="test-plan-next-run-indicator"
                >
                    <div className="text-xs text-content-muted mb-1">
                        Next run
                    </div>
                    {tone === 'none' ? (
                        <div className={TONE_CLASS[tone]}>
                            No automated runs scheduled
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            <div
                                className={`text-sm ${TONE_CLASS[tone]}`}
                                data-testid="test-plan-next-run-tone"
                                data-tone={tone}
                            >
                                {TONE_LABEL[tone]}: {formatDate(initialNextRunAt!)}
                            </div>
                            {initialAutomationType !== 'MANUAL' && (
                                <div className="text-xs text-content-subtle">
                                    Automation: {initialAutomationType}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Save row */}
            {canEdit && dirty && (
                <div className="flex items-center justify-between border-t border-border-default/40 pt-3">
                    {error ? (
                        <span
                            className="text-xs text-content-error"
                            role="alert"
                            data-testid="test-plan-schedule-error"
                        >
                            {error}
                        </span>
                    ) : (
                        <span className="text-xs text-content-subtle">
                            Click save to apply the new schedule.
                        </span>
                    )}
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={save}
                        disabled={saving}
                        id="save-test-plan-schedule-btn"
                    >
                        {saving ? 'Saving…' : 'Save schedule'}
                    </Button>
                </div>
            )}

            {!canEdit && (
                <p className="text-xs text-content-subtle">
                    You don&apos;t have permission to change this plan&apos;s
                    schedule.
                </p>
            )}
        </div>
    );
}
