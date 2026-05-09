'use client';

/**
 * Epic 49 — Compliance Calendar client island.
 *
 * Three views: Heatmap (12 months back), Month (single month grid),
 * Gantt (12 months centred on today, audit-cycle/range-bearing
 * events only). View toggle drives both the rendered component AND
 * the query range (heatmap fetches 12 months back, Gantt fetches
 * a 12-month centred window, Month fetches just the visible month +
 * adjacent padding for the 6×7 grid).
 *
 * Selected day populates a side panel listing every event that day,
 * each linked to its entity detail page.
 */

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button-variants';
import { CalendarHeatmap } from '@/components/ui/CalendarHeatmap';
import { CalendarMonth } from '@/components/ui/CalendarMonth';
import { GanttTimeline } from '@/components/ui/GanttTimeline';
import { EmptyState } from '@/components/ui/empty-state';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { queryKeys } from '@/lib/queryKeys';
import { formatDate } from '@/lib/format-date';
import type {
    CalendarEvent,
    CalendarResponse,
} from '@/app-layer/schemas/calendar.schemas';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

const DAY_MS = 86_400_000;

type View = 'heatmap' | 'month' | 'gantt';

interface CalendarClientProps {
    tenantSlug: string;
    initial: CalendarResponse;
    initialRange: { from: string; to: string };
}

function startOfUtcMonth(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfUtcMonth(d: Date): Date {
    return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );
}

function rangeForView(view: View, monthCursor: Date): { from: Date; to: Date } {
    const today = new Date();
    if (view === 'heatmap') {
        return {
            from: new Date(today.getTime() - 365 * DAY_MS),
            to: today,
        };
    }
    if (view === 'gantt') {
        return {
            from: new Date(today.getTime() - 180 * DAY_MS),
            to: new Date(today.getTime() + 180 * DAY_MS),
        };
    }
    // month — pad to cover the 6-row grid
    const start = startOfUtcMonth(monthCursor);
    const end = endOfUtcMonth(monthCursor);
    return {
        from: new Date(start.getTime() - 7 * DAY_MS),
        to: new Date(end.getTime() + 7 * DAY_MS),
    };
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarClient({
    tenantSlug,
    initial,
    initialRange,
}: CalendarClientProps) {
    const [view, setView] = React.useState<View>('month');
    const [monthCursor, setMonthCursor] = React.useState<Date>(
        () => startOfUtcMonth(new Date()),
    );
    const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

    // Pull `getTime()` into a stable primitive so the dep array is
    // statically checkable. We deliberately depend on `monthCursorMs`
    // rather than the live `monthCursor` Date instance — the lint
    // rule sees the missing `monthCursor` dep but the runtime is
    // stable because the timestamp captures the only field
    // `rangeForView` reads off the Date.
    const monthCursorMs = monthCursor.getTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const range = React.useMemo(() => rangeForView(view, monthCursor), [view, monthCursorMs]);

    const fromKey = range.from.toISOString();
    const toKey = range.to.toISOString();

    // Initial server-rendered range happens to overlap with the default
    // (month) view — feed that as initialData when the keys match.
    const initialMatches =
        initialRange.from === fromKey && initialRange.to === toKey;

    const calQuery = useQuery({
        queryKey: queryKeys.calendar.range(tenantSlug, fromKey, toKey),
        queryFn: async (): Promise<CalendarResponse> => {
            const url = `/api/t/${tenantSlug}/calendar?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to load calendar');
            return res.json();
        },
        initialData: initialMatches ? initial : undefined,
        staleTime: 60_000,
    });

    // Stabilise the array identity — the `?? []` produces a fresh
    // empty array each render, which destabilises the useMemos
    // below that depend on `events`.
    const events: CalendarEvent[] = React.useMemo(
        () => calQuery.data?.events ?? [],
        [calQuery.data],
    );

    // Filter: Gantt only shows events that have a meaningful range OR
    // are audit cycles (where `start === end` may be intentional).
    const ganttEvents = React.useMemo(
        () =>
            events.filter(
                (e) => e.end !== undefined || e.category === 'audit',
            ),
        [events],
    );

    const selectedEvents = React.useMemo(() => {
        if (!selectedDate) return [];
        return events.filter((e) => e.date.slice(0, 10) === selectedDate);
    }, [events, selectedDate]);

    const handlePrev = () => {
        if (view !== 'month') return;
        setMonthCursor(
            (prev) =>
                new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1)),
        );
    };
    const handleNext = () => {
        if (view !== 'month') return;
        setMonthCursor(
            (prev) =>
                new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1)),
        );
    };

    return (
        <div className="space-y-section animate-fadeIn">
            {/* Header */}
            <header className="flex items-start justify-between gap-default flex-wrap">
                <div className="min-w-0">
                    <Breadcrumbs
                        items={[
                            { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                            { label: 'Calendar' },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1} className="flex items-center gap-tight">
                        <CalIcon className="size-6 text-content-muted" aria-hidden="true" />
                        Compliance Calendar
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        Track every compliance deadline — evidence reviews, policy renewals,
                        vendor renewals, audit cycles, control tests — in one place.
                    </p>
                </div>
                <div className="flex items-center gap-tight flex-wrap">
                    <ToggleGroup
                        selected={view}
                        selectAction={(v) => setView(v as View)}
                        options={[
                            { value: 'month', label: 'Month' },
                            { value: 'heatmap', label: 'Heatmap' },
                            { value: 'gantt', label: 'Timeline' },
                        ]}
                        size="sm"
                        ariaLabel="Calendar view"
                    />
                </div>
            </header>

            {/* Range navigation (month view only) */}
            {view === 'month' && (
                <div
                    className="flex items-center justify-between glass-card px-4 py-2"
                    data-testid="calendar-month-nav"
                >
                    <button
                        type="button"
                        onClick={handlePrev}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        aria-label="Previous month"
                    >
                        <ChevronLeft className="size-4" />
                    </button>
                    <span
                        className="text-sm font-semibold text-content-emphasis"
                        data-testid="calendar-current-month"
                    >
                        {MONTH_NAMES[monthCursor.getUTCMonth()]}{' '}
                        {monthCursor.getUTCFullYear()}
                    </span>
                    <button
                        type="button"
                        onClick={handleNext}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        aria-label="Next month"
                    >
                        <ChevronRight className="size-4" />
                    </button>
                </div>
            )}

            {/* Loading + error states */}
            {calQuery.isError && (
                <div className="rounded-lg border border-border-error bg-bg-error px-4 py-3 text-sm text-content-error">
                    Failed to load calendar events. Try refreshing.
                </div>
            )}

            {/* Body — view switch */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-section">
                <div className="glass-card p-4">
                    {events.length === 0 && !calQuery.isLoading ? (
                        <EmptyState
                            variant="no-records"
                            title="No deadlines in this range"
                            description="Once you have evidence to renew, policies to review, vendor renewals, or audit cycles, they'll show up here."
                        />
                    ) : view === 'heatmap' ? (
                        <CalendarHeatmap
                            events={events}
                            from={range.from}
                            to={range.to}
                            onSelectDate={setSelectedDate}
                        />
                    ) : view === 'month' ? (
                        <CalendarMonth
                            month={monthCursor}
                            events={events}
                            onSelectDate={setSelectedDate}
                        />
                    ) : (
                        <GanttTimeline
                            from={range.from}
                            to={range.to}
                            events={ganttEvents}
                            emptyMessage="No duration-based events in this range. Create an audit cycle to see it here."
                        />
                    )}
                </div>

                {/* Side panel — selected day's events */}
                <aside
                    className="glass-card p-4"
                    data-testid="calendar-side-panel"
                >
                    {selectedDate ? (
                        <>
                            <Heading level={3} className="mb-2">
                                {formatDate(new Date(selectedDate))}
                            </Heading>
                            {selectedEvents.length === 0 ? (
                                <p className="text-xs text-content-muted">
                                    No events on this day.
                                </p>
                            ) : (
                                <ul className="space-y-tight">
                                    {selectedEvents.map((ev) => (
                                        <li
                                            key={ev.id}
                                            data-event-id={ev.id}
                                        >
                                            <Link
                                                href={ev.href}
                                                className="block rounded p-2 text-xs hover:bg-bg-muted transition-colors"
                                            >
                                                <div className="font-medium text-content-emphasis truncate">
                                                    {ev.title}
                                                </div>
                                                {ev.detail && (
                                                    <div className="text-content-muted truncate">
                                                        {ev.detail}
                                                    </div>
                                                )}
                                                <div className="text-[10px] text-content-subtle uppercase tracking-wider mt-0.5">
                                                    {ev.category} · {ev.status}
                                                </div>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    ) : (
                        <p className="text-xs text-content-muted">
                            Click a day to see events on that date.
                        </p>
                    )}
                </aside>
            </div>
        </div>
    );
}
