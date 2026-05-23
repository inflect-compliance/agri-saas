"use client";

/**
 * Epic 49 — <CalendarMonth>.
 *
 * Monthly calendar grid (7 columns × 5-6 rows). Each day cell shows
 * up to N event dots colored by category. Clicking a dot navigates
 * to the event's `href`; clicking the day header selects the day
 * (caller can show a side panel of all events for that day).
 *
 * Design choices:
 *   - Pure HTML/CSS grid — no chart library needed
 *   - Token-styled colors per category (single source of truth)
 *   - Sparse-data friendly: empty days render as plain cells
 *   - Overflow handled by collapsing extra events into a "+N more"
 *     pill that, when clicked, opens the same day-selection pane
 *   - Today's cell is highlighted with a token-driven ring
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@dub/utils';
import type {
    CalendarEvent,
} from '@/app-layer/schemas/calendar.schemas';
import { getCategoryTone } from '@/lib/design/status-tone';

// ─── Public props ─────────────────────────────────────────────────────

export interface CalendarMonthProps {
    /** First day of the month to render (any time within the month is OK). */
    month: Date;
    /** Events to plot. Must fall within the rendered month to be visible. */
    events: ReadonlyArray<CalendarEvent>;
    /** Maximum dots per cell before collapsing into "+N more". Default: 3. */
    maxDotsPerDay?: number;
    /** Fired when a day cell is selected (header or "+N more" click). */
    onSelectDate?: (date: string) => void;
    /** Today override (for tests). Default: new Date(). */
    today?: Date;
    className?: string;
    'data-testid'?: string;
}

// ─── Category token map ──────────────────────────────────────────────
//
// Polish PR-7 — calendar dot colour delegates to the shared
// `getCategoryTone` helper in `@/lib/design/status-tone`. The
// CalendarMonth / GanttTimeline / future calendar surfaces all read
// the same vocabulary.

// ─── Helpers ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;


function startOfUtcMonth(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfUtcMonth(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function toYMD(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function isSameUtcDay(a: Date, b: Date): boolean {
    return (
        a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth() &&
        a.getUTCDate() === b.getUTCDate()
    );
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Component ───────────────────────────────────────────────────────

export function CalendarMonth({
    month,
    events,
    maxDotsPerDay = 3,
    onSelectDate,
    today,
    className,
    'data-testid': dataTestId = 'calendar-month',
}: CalendarMonthProps) {
    const todayDate = today ?? new Date();
    const monthStart = startOfUtcMonth(month);
    const monthEnd = endOfUtcMonth(month);

    // Bucket events by YYYY-MM-DD.
    const eventsByDay = React.useMemo(() => {
        const m = new Map<string, CalendarEvent[]>();
        for (const e of events) {
            const ymd = e.date.slice(0, 10);
            const list = m.get(ymd) ?? [];
            list.push(e);
            m.set(ymd, list);
        }
        // Stable order within a day — by category then title for
        // deterministic rendering.
        for (const list of m.values()) {
            list.sort(
                (a, b) =>
                    a.category.localeCompare(b.category) ||
                    a.title.localeCompare(b.title),
            );
        }
        return m;
    }, [events]);

    // Build the 6×7 grid. Pad with leading/trailing days from adjacent
    // months so the grid is always rectangular.
    const padStart = monthStart.getUTCDay();
    const padEnd = 6 - monthEnd.getUTCDay();
    const totalCells = padStart + monthEnd.getUTCDate() + padEnd;
    const cells: { date: Date; inMonth: boolean }[] = [];
    const gridStartMs = monthStart.getTime() - padStart * DAY_MS;
    for (let i = 0; i < totalCells; i++) {
        const d = new Date(gridStartMs + i * DAY_MS);
        cells.push({ date: d, inMonth: d.getUTCMonth() === monthStart.getUTCMonth() });
    }

    return (
        <section
            className={cn('flex flex-col gap-tight', className)}
            data-testid={dataTestId}
            aria-label={`${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`}
        >
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-px text-xs font-medium text-content-muted">
                {WEEKDAY_NAMES.map((label) => (
                    <div
                        key={label}
                        className="text-center py-1"
                    >
                        {label}
                    </div>
                ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
                {cells.map((cell) => {
                    const ymd = toYMD(cell.date);
                    const dayEvents = eventsByDay.get(ymd) ?? [];
                    const isToday = isSameUtcDay(cell.date, todayDate);
                    const visible = dayEvents.slice(0, maxDotsPerDay);
                    const overflow = dayEvents.length - visible.length;

                    // v2-fu-6 — the entire cell is clickable, not
                    // just the day number. We keep the number `<button>`
                    // as the keyboard-accessible target (so screen
                    // readers can tab into individual days), and add
                    // pointer-click handling to the outer cell so
                    // mouse users get the natural "click anywhere
                    // in the box" affordance. Inner `<Link>` event
                    // navigation uses `stopPropagation` so opening
                    // an event doesn't also fire day selection.
                    const handleCellClick = onSelectDate
                        ? (e: React.MouseEvent<HTMLDivElement>) => {
                              // Don't trigger when the click is on a
                              // child link / button — the child's own
                              // handler runs (number button still
                              // calls onSelectDate; event Link
                              // navigates).
                              const target = e.target as HTMLElement;
                              if (target.closest('a, button')) return;
                              onSelectDate(ymd);
                          }
                        : undefined;
                    return (
                        <div
                            key={ymd}
                            className={cn(
                                'relative min-h-[80px] p-1.5 flex flex-col gap-1',
                                cell.inMonth
                                    ? 'bg-bg-default'
                                    : 'bg-bg-muted/30 opacity-60',
                                isToday && 'ring-1 ring-[var(--brand-default)] ring-inset',
                                onSelectDate &&
                                    'cursor-pointer hover:bg-bg-muted/50 transition-colors duration-150 ease-out',
                            )}
                            data-ymd={ymd}
                            data-in-month={cell.inMonth}
                            data-today={isToday || undefined}
                            onClick={handleCellClick}
                        >
                            <button
                                type="button"
                                className={cn(
                                    'self-end text-xs leading-none px-1 py-0.5 rounded text-content-muted hover:bg-bg-muted',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                                    isToday && 'text-content-emphasis font-semibold',
                                )}
                                onClick={() => onSelectDate?.(ymd)}
                                aria-label={`${ymd}: ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}
                            >
                                {cell.date.getUTCDate()}
                            </button>
                            {visible.length > 0 && (
                                <ul className="flex flex-col gap-0.5 min-h-0">
                                    {visible.map((ev) => (
                                        <li
                                            key={ev.id}
                                            data-event-id={ev.id}
                                            data-event-category={ev.category}
                                        >
                                            <Link
                                                href={ev.href}
                                                title={`${ev.title}${ev.detail ? ` — ${ev.detail}` : ''}`}
                                                className={cn(
                                                    'flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate',
                                                    'hover:bg-bg-muted transition-colors',
                                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                                                    ev.status === 'overdue' && 'text-content-error',
                                                    ev.status === 'done' && 'text-content-muted line-through',
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        'inline-block size-2 rounded-full shrink-0',
                                                        getCategoryTone(ev.category).bg,
                                                        ev.status === 'done' && 'opacity-40',
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                <span className="truncate">{ev.title}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {overflow > 0 && (
                                <button
                                    type="button"
                                    onClick={() => onSelectDate?.(ymd)}
                                    className="text-[10px] text-content-muted hover:text-content-emphasis text-left px-1"
                                >
                                    +{overflow} more
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
