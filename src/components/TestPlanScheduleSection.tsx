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
import { useTranslations } from 'next-intl';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { formatDate } from '@/lib/format-date';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

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
    cron: string | null;
}

const CADENCES: Cadence[] = [
    { value: 'OFF', cron: null },
    { value: 'DAILY', cron: '0 9 * * *' },
    { value: 'WEEKLY', cron: '0 9 * * MON' },
    { value: 'MONTHLY', cron: '0 9 1 * *' },
    { value: 'QUARTERLY', cron: '0 9 1 1,4,7,10 *' },
];

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
    const t = useTranslations('testSchedule');
    const apiUrl = useTenantApiUrl();

    const cadenceLabels: Record<Cadence['value'], string> = {
        OFF: t('cadenceOffLabel'),
        DAILY: t('cadenceDailyLabel'),
        WEEKLY: t('cadenceWeeklyLabel'),
        MONTHLY: t('cadenceMonthlyLabel'),
        QUARTERLY: t('cadenceQuarterlyLabel'),
    };
    const cadenceDescriptions: Record<Cadence['value'], string> = {
        OFF: t('cadenceOffDesc'),
        DAILY: t('cadenceDailyDesc'),
        WEEKLY: t('cadenceWeeklyDesc'),
        MONTHLY: t('cadenceMonthlyDesc'),
        QUARTERLY: t('cadenceQuarterlyDesc'),
    };
    const CADENCE_OPTIONS: ComboboxOption[] = CADENCES.map((c) => ({
        value: c.value,
        label: cadenceLabels[c.value],
    }));
    const toneLabels: Record<NextRunTone, string> = {
        overdue: t('toneOverdue'),
        today: t('toneToday'),
        normal: t('toneNormal'),
        none: '',
    };

    const browserTz = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    }, []);

    // Saved state — what the server confirmed last.
    const savedCadence = cronToCadence(initialSchedule);

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
                setError(t('chooseCadence'));
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
                        t('failedToSave', { status: res.status }),
                );
                return;
            }
            onSaved?.();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : t('couldNotSave'),
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}
            id="test-plan-schedule-section"
            data-testid="test-plan-schedule-section"
        >
            <div className="flex items-center justify-between">
                <Heading level={3}>
                    {t('schedule')}
                </Heading>
                <span className="text-xs text-content-subtle">
                    {t('allTimesIn', { tz: browserTz })}
                </span>
            </div>

            {/* Frequency picker */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-compact items-start">
                <div className="md:col-span-2">
                    <label
                        className="text-xs text-content-muted block mb-1"
                        htmlFor="test-plan-schedule-cadence"
                    >
                        {t('frequency')}
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
                            {cadenceDescriptions[cadenceObj.value]}
                        </p>
                    )}
                    {pendingCadence === 'CUSTOM' && (
                        <p
                            className="text-xs text-content-warning mt-1"
                            data-testid="test-plan-custom-schedule-warning"
                        >
                            {t('customWarning')}
                        </p>
                    )}
                </div>

                {/* Next-run indicator */}
                <div
                    className="md:pt-5"
                    data-testid="test-plan-next-run-indicator"
                >
                    <div className="text-xs text-content-muted mb-1">
                        {t('nextRun')}
                    </div>
                    {tone === 'none' ? (
                        <div className={TONE_CLASS[tone]}>
                            {t('noAutomatedRuns')}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            <div
                                className={`text-sm ${TONE_CLASS[tone]}`}
                                data-testid="test-plan-next-run-tone"
                                data-tone={tone}
                            >
                                {t('nextRunValue', { tone: toneLabels[tone], date: formatDate(initialNextRunAt!) })}
                            </div>
                            {initialAutomationType !== 'MANUAL' && (
                                <div className="text-xs text-content-subtle">
                                    {t('automationType', { type: initialAutomationType })}
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
                            {t('clickSave')}
                        </span>
                    )}
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={save}
                        disabled={saving}
                        id="save-test-plan-schedule-btn"
                    >
                        {saving ? t('saving') : t('saveSchedule')}
                    </Button>
                </div>
            )}

            {!canEdit && (
                <p className="text-xs text-content-subtle">
                    {t('noPermission')}
                </p>
            )}
        </div>
    );
}
