/**
 * Epic 58 — range-display consistency integration test.
 *
 * Verifies the DateRangePicker trigger uses the canonical
 * `formatDateRange` helper so the text on the trigger reads in the
 * same dialect as any filter pill, audit cycle header, or report
 * legend that picks up the helper.
 *
 * This is the "representative page consistency check" the audit
 * asks for — it locks the wire between the trigger's display slot
 * and the shared formatter.
 */

import React from 'react';
import { render } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    usePathname: () => '/',
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
}));

jest.mock('next-auth/react', () => ({
    signOut: jest.fn(),
    signIn: jest.fn(),
}));


import { DateRangePicker } from '@/components/ui/date-picker/date-range-picker';

function getTriggerValue(container: HTMLElement): string | null {
    return (
        container.querySelector(
            '[data-testid="date-picker-trigger-value"]',
        )?.textContent ?? null
    );
}

function utc(ymd: string): Date {
    return new Date(`${ymd}T00:00:00Z`);
}

describe('DateRangePicker — trigger uses canonical formatDateRange', () => {
    it('renders a same-month range without repeating the month on the left endpoint', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2026-04-16'), to: utc('2026-04-30') }}
            />,
        );
        expect(getTriggerValue(container)).toBe('16 – 30 Apr 2026');
    });

    it('renders a same-year range without repeating the year on the left endpoint', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2026-04-16'), to: utc('2026-06-30') }}
            />,
        );
        expect(getTriggerValue(container)).toBe('16 Apr – 30 Jun 2026');
    });

    it('renders a cross-year range with both endpoints carrying their year', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2025-12-20'), to: utc('2026-01-05') }}
            />,
        );
        expect(getTriggerValue(container)).toBe('20 Dec 2025 – 05 Jan 2026');
    });

    it('renders a same-day range as a single formatted date', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2026-04-16'), to: utc('2026-04-16') }}
            />,
        );
        expect(getTriggerValue(container)).toBe('16 Apr 2026');
    });

    it('renders a half-open range with an explicit "From …" prefix', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2026-04-16'), to: null }}
            />,
        );
        expect(getTriggerValue(container)).toBe('From 16 Apr 2026');
    });

    it('renders a half-open range with an explicit "Until …" prefix', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: null, to: utc('2026-04-30') }}
            />,
        );
        expect(getTriggerValue(container)).toBe('Until 30 Apr 2026');
    });

    it('shows the placeholder (no value slot) when both sides are empty', () => {
        const { container } = render(
            <DateRangePicker
                placeholder="Select audit period"
                value={{ from: null, to: null }}
            />,
        );
        expect(getTriggerValue(container)).toBeNull();
        expect(
            container.querySelector('[data-testid="date-picker-trigger-placeholder"]')
                ?.textContent,
        ).toBe('Select audit period');
    });

    it('uses the em-dash (U+2013) separator, never a hyphen-minus', () => {
        const { container } = render(
            <DateRangePicker
                value={{ from: utc('2026-04-16'), to: utc('2026-04-30') }}
            />,
        );
        const text = getTriggerValue(container) ?? '';
        expect(text.includes('–')).toBe(true);
        expect(text.includes(' - ')).toBe(false);
    });
});
