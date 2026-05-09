"use client";

/**
 * Epic 49 — <CalendarHeatmap>.
 *
 * GitHub-style activity heatmap (week columns × day rows). Each cell
 * represents one calendar day; intensity buckets color the cell based
 * on event-count for that day.
 *
 * Sized to a 12-month look-back by default; the `from`/`to` props
 * adjust the rendered range. Bare HTML tables — no chart library
 * dependency. Token-styled, accessible (`aria-label` per cell + a
 * legend), and click-through (`onSelectDate` fires for any clicked
 * cell, populated or empty).
 */

import * as React from 'react';
import { cn } from '@dub/utils';
import type { CalendarEvent } from '@/app-layer/schemas/calendar.schemas';
import { getIntensityTone } from '@/lib/design/status-tone';

// ─── Public props ─────────────────────────────────────────────────────

export interface CalendarHeatmapProps {
    /** Events to bucket. Heatmap aggregates per-day count. */
    events: ReadonlyArray<CalendarEvent>;
    /** Inclusive range start (defaults to 12 months before `to`). */
    from?: Date;
    /** Inclusive range end (defaults to today). */
    to?: Date;
    /** Click handler — fires with the YYYY-MM-DD of the clicked cell. */
    onSelectDate?: (date: string) => void;
    /** ARIA label for the wrapping <figure>. */
    'aria-label'?: string;
    /** Forwarded for E2E selectors. */
    'data-testid'?: string;
    className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function startOfUtcDay(d: Date): Date {
    return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
}

function toYMD(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): Date[] {
    const start = startOfUtcDay(from);
    const end = startOfUtcDay(to);
    const days: Date[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
        days.push(new Date(t));
    }
    return days;
}

/**
 * Bucket density into 5 levels — empty + 4 intensity steps. Five
 * levels matches the GitHub heatmap convention and keeps the legend
 * simple. The thresholds are relative to the *max* count in range so
 * sparse data still shows visible signal.
 */
function bucketIntensity(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
    if (count <= 0) return 0;
    if (max <= 1) return 1;
    const ratio = count / max;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
}

// Polish PR-7 — intensity bg delegated to `getIntensityTone` from
// `@/lib/design/status-tone`. The shared helper ensures any future
// activity-density chart gets the same brand-alpha staircase for
// free.

// ─── Component ───────────────────────────────────────────────────────

export function CalendarHeatmap({
    events,
    from,
    to,
    onSelectDate,
    className,
    'aria-label': ariaLabel = 'Compliance activity heatmap',
    'data-testid': dataTestId = 'calendar-heatmap',
}: CalendarHeatmapProps) {
    // Default range: 12 months back from `to` (or from today).
    const rangeTo = to ?? new Date();
    const rangeFrom =
        from ??
        new Date(rangeTo.getTime() - 365 * DAY_MS);

    // Stabilise object identity for the dependency array — comparing
    // by `.getTime()` avoids re-running on every parent render that
    // happens to construct a new Date for the same instant.
    const fromMs = rangeFrom.getTime();
    const toMs = rangeTo.getTime();
    const days = React.useMemo(
        () => eachDay(rangeFrom, rangeTo),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- using ms-since-epoch as stable identity
        [fromMs, toMs],
    );

    const counts = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const e of events) {
            const ymd = e.date.slice(0, 10);
            m.set(ymd, (m.get(ymd) ?? 0) + 1);
        }
        return m;
    }, [events]);

    const max = React.useMemo(() => {
        let m = 0;
        for (const v of counts.values()) if (v > m) m = v;
        return m;
    }, [counts]);

    // Group days into 7-row × N-column grid. We pad the start so the
    // first column begins on a Sunday (UTC day index 0).
    const padStart = days.length > 0 ? days[0].getUTCDay() : 0;
    const padded: (Date | null)[] = [
        ...Array.from<null>({ length: padStart }).fill(null),
        ...days,
    ];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks: (Date | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
        weeks.push(padded.slice(i, i + 7));
    }

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <figure
            className={cn('flex flex-col gap-tight', className)}
            aria-label={ariaLabel}
            data-testid={dataTestId}
        >
            <div className="flex gap-tight">
                {/* Row labels (only show every other row to save space). */}
                <div className="flex flex-col gap-[2px] pt-[14px] text-[10px] text-content-muted select-none">
                    {dayLabels.map((label, i) => (
                        <span
                            key={label}
                            className={cn(
                                'h-[10px] leading-[10px]',
                                i % 2 === 0 && 'opacity-0',
                            )}
                        >
                            {label}
                        </span>
                    ))}
                </div>

                {/* Heatmap grid */}
                <div className="flex gap-[2px] overflow-x-auto">
                    {weeks.map((week, weekIdx) => (
                        <div
                            key={weekIdx}
                            className="flex flex-col gap-[2px]"
                        >
                            {week.map((day, dayIdx) => {
                                if (!day) {
                                    return (
                                        <span
                                            key={dayIdx}
                                            className="h-[10px] w-[10px]"
                                            aria-hidden="true"
                                        />
                                    );
                                }
                                const ymd = toYMD(day);
                                const count = counts.get(ymd) ?? 0;
                                const intensity = bucketIntensity(count, max);
                                const label =
                                    count === 0
                                        ? `${ymd}: no events`
                                        : `${ymd}: ${count} event${count === 1 ? '' : 's'}`;
                                return (
                                    <button
                                        key={dayIdx}
                                        type="button"
                                        onClick={() => onSelectDate?.(ymd)}
                                        title={label}
                                        aria-label={label}
                                        data-ymd={ymd}
                                        data-count={count}
                                        data-intensity={intensity}
                                        className={cn(
                                            'h-[10px] w-[10px] rounded-[2px] transition-colors',
                                            getIntensityTone(intensity),
                                            'hover:ring-1 hover:ring-content-emphasis/40',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                                        )}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <figcaption className="flex items-center gap-1 text-[10px] text-content-muted">
                <span>Less</span>
                {([0, 1, 2, 3, 4] as const).map((i) => (
                    <span
                        key={i}
                        className={cn(
                            'h-[10px] w-[10px] rounded-[2px]',
                            getIntensityTone(i),
                        )}
                        aria-hidden="true"
                    />
                ))}
                <span>More</span>
            </figcaption>
        </figure>
    );
}
