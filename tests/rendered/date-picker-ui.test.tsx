/**
 * Epic 58 — rendered tests for the shared Calendar and Trigger UI.
 *
 *   - Calendar renders the current month heading, weekday row, and
 *     day buttons; clicking a day emits `onSelect` with the correct
 *     Date; month + year navigation move the caption; the selected
 *     day gets the `bg-brand-emphasis` token class so the design
 *     contract is visible to visual regressions.
 *
 *   - Trigger renders placeholder vs. children, applies `hasError`
 *     styling + `aria-invalid`, forwards its ref, defaults to
 *     `type="button"`, and rotates the chevron under
 *     `data-state="open"` (the attribute Radix/Vaul set via
 *     `asChild`).
 *
 * These tests are intentionally token- and contract-focused. The
 * heavy focus-management behaviour (arrow-key roving tabindex,
 * keyboard selection) is owned by react-day-picker itself; we'd be
 * asserting against the library's implementation rather than our
 * own contract.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';

// Calendar is a client component; trigger is not — both are plain
// imports under the jsdom project.

import { Calendar } from '@/components/ui/date-picker/calendar';

import { Trigger } from '@/components/ui/date-picker/trigger';

// ─── Calendar ─────────────────────────────────────────────────────────

describe('Calendar — render', () => {
    it('mounts the DayPicker grid and shows a caption', () => {
        const { getByTestId, getAllByRole } = render(
            <Calendar mode="single" defaultMonth={new Date(2026, 3, 1)} />,
        );
        expect(getByTestId('calendar')).toBeInTheDocument();
        expect(getByTestId('calendar-heading')).toBeInTheDocument();
        // At least one grid with day cells rendered.
        expect(getAllByRole('grid').length).toBeGreaterThan(0);
    });

    it('shows the month + year in the heading', () => {
        const { getByTestId } = render(
            <Calendar mode="single" defaultMonth={new Date(2026, 3, 1)} />,
        );
        expect(getByTestId('calendar-heading').textContent).toMatch(
            /april\s+2026/i,
        );
    });

    it('advances the month on "next month"', () => {
        const { getByTestId } = render(
            <Calendar mode="single" defaultMonth={new Date(2026, 3, 1)} />,
        );
        act(() => {
            fireEvent.click(getByTestId('calendar-next-month'));
        });
        expect(getByTestId('calendar-heading').textContent).toMatch(
            /may\s+2026/i,
        );
    });

    it('recedes the month on "previous month"', () => {
        const { getByTestId } = render(
            <Calendar mode="single" defaultMonth={new Date(2026, 3, 1)} />,
        );
        act(() => {
            fireEvent.click(getByTestId('calendar-prev-month'));
        });
        expect(getByTestId('calendar-heading').textContent).toMatch(
            /march\s+2026/i,
        );
    });

    it('advances the year when year navigation is enabled', () => {
        const { getByTestId } = render(
            <Calendar
                mode="single"
                showYearNavigation
                defaultMonth={new Date(2026, 3, 1)}
            />,
        );
        act(() => {
            fireEvent.click(getByTestId('calendar-next-year'));
        });
        expect(getByTestId('calendar-heading').textContent).toMatch(
            /april\s+2027/i,
        );
    });

    it('year navigation buttons are omitted when showYearNavigation is false', () => {
        const { queryByTestId } = render(
            <Calendar mode="single" defaultMonth={new Date(2026, 3, 1)} />,
        );
        expect(queryByTestId('calendar-next-year')).toBeNull();
        expect(queryByTestId('calendar-prev-year')).toBeNull();
    });

    it('calls onSelect with a Date when a day is clicked', () => {
        const onSelect = jest.fn();
        const { getByRole } = render(
            <Calendar
                mode="single"
                defaultMonth={new Date(2026, 3, 1)}
                onSelect={onSelect}
            />,
        );
        // Day buttons render with their accessible name set to the
        // localized date. The 15th of April 2026.
        const day15 = getByRole('button', { name: /15.*april|april.*15/i });
        act(() => {
            fireEvent.click(day15);
        });
        expect(onSelect).toHaveBeenCalled();
        const firstCall = onSelect.mock.calls[0][0];
        expect(firstCall).toBeInstanceOf(Date);
        expect(firstCall.getDate()).toBe(15);
        expect(firstCall.getMonth()).toBe(3);
        expect(firstCall.getFullYear()).toBe(2026);
    });

    it('applies the brand-emphasis token class on the selected day', () => {
        const selected = new Date(2026, 3, 15);
        const { container } = render(
            <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
            />,
        );
        // react-day-picker tags the selected cell with data-selected="true".
        const selectedCell = container.querySelector('[data-selected="true"]');
        expect(selectedCell).not.toBeNull();
        // Our contract: selected cells carry `bg-brand-emphasis` via the
        // wrapper classNames. react-day-picker v9 puts the class on the
        // grid cell (the `.selected` class on `<td>`), not the button.
        const cellClass = selectedCell!.getAttribute('class') ?? '';
        const htmlWithinSelection = selectedCell!.outerHTML;
        expect(
            cellClass.includes('bg-brand-emphasis') ||
                htmlWithinSelection.includes('bg-brand-emphasis'),
        ).toBe(true);
    });
});

// ─── Trigger ──────────────────────────────────────────────────────────

describe('Trigger — render + contract', () => {
    it('renders the placeholder when no children are provided', () => {
        const { getByTestId, queryByTestId } = render(
            <Trigger placeholder="Pick a date" />,
        );
        expect(getByTestId('date-picker-trigger-placeholder').textContent).toBe(
            'Pick a date',
        );
        expect(queryByTestId('date-picker-trigger-value')).toBeNull();
    });

    it('renders children in the value slot when provided', () => {
        const { getByTestId, queryByTestId } = render(
            <Trigger placeholder="Pick a date">16 Apr 2026</Trigger>,
        );
        expect(getByTestId('date-picker-trigger-value').textContent).toBe(
            '16 Apr 2026',
        );
        expect(queryByTestId('date-picker-trigger-placeholder')).toBeNull();
    });

    it('applies error styling and aria-invalid when hasError is set', () => {
        const { container } = render(
            <Trigger placeholder="x" hasError />,
        );
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.className).toContain('border-border-error');
        expect(btn.getAttribute('aria-invalid')).toBe('true');
    });

    it('defaults to type="button" so it never submits a surrounding form', () => {
        const { container } = render(<Trigger placeholder="x" />);
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLButtonElement;
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('forwards its ref to the underlying button', () => {
        const ref = React.createRef<HTMLButtonElement>();
        render(<Trigger ref={ref} placeholder="x" />);
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
        expect(ref.current?.hasAttribute('data-date-picker-trigger')).toBe(true);
    });

    it('becomes disabled when disabled is set', () => {
        const { container } = render(<Trigger placeholder="x" disabled />);
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('carries aria-haspopup="dialog" so assistive tech knows it opens an overlay', () => {
        const { container } = render(<Trigger placeholder="x" />);
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLButtonElement;
        expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    });

    it('rotates the chevron under data-state="open"', () => {
        const { container } = render(
            <Trigger placeholder="x" data-state="open" />,
        );
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLElement;
        expect(btn.getAttribute('data-state')).toBe('open');
        // Chevron's class carries `group-data-[state=open]:rotate-180`;
        // the parent has data-state="open", so the Tailwind contextual
        // variant resolves visually. We can't verify computed style in
        // jsdom, but we can verify the marker is in place.
        const chevron = btn.querySelector(
            '[class*="rotate-180"]',
        ) as HTMLElement;
        expect(chevron).not.toBeNull();
    });

    it('fires onClick like any button', () => {
        const onClick = jest.fn();
        const { container } = render(
            <Trigger placeholder="x" onClick={onClick} />,
        );
        const btn = container.querySelector(
            '[data-date-picker-trigger]',
        ) as HTMLButtonElement;
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
