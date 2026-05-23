/**
 * Epic 58 — reporting integration test.
 *
 * Verifies that the Audit Cycles create form exposes the shared
 * `DateRangePicker` and that submitting the form with a preset
 * applied sends the resolved `periodStartAt` / `periodEndAt`
 * timestamps to the existing API. The backend route has always
 * accepted these optional fields — the UI previously never
 * exposed them, so this integration is a pure additive change to
 * the on-the-wire payload.
 *
 * What's NOT re-tested here:
 *   - The DateRangePicker's own behaviour (covered by
 *     `tests/rendered/date-pickers.test.tsx`).
 *   - The preset catalogue's boundary maths (covered by
 *     `tests/unit/date-picker-foundation.test.ts`).
 *
 * What IS tested:
 *   - The picker renders inside the Audit Cycles form.
 *   - Picking "Year to date" populates the trigger label with that
 *     preset's name — the discoverability contract.
 *   - Submitting the form emits a POST carrying the preset's
 *     resolved `periodStartAt` / `periodEndAt` ISO strings.
 *   - Submitting without a period skips both fields, preserving
 *     backwards compatibility with the previous UI.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

// Route / navigation stubs — the page uses useParams + useRouter.
const routerMock = {
    push: jest.fn(),
};
jest.mock('next/navigation', () => ({
    useParams: () => ({ tenantSlug: 'acme-corp' }),
    useRouter: () => routerMock,
    usePathname: () => '/t/acme-corp/audits/cycles',
}));

// next-intl isn't wired in a bare render; the audit-cycles page
// doesn't depend on it directly, but transitively-imported shared
// components (if any pull it in) need a stub.
jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

// Next-auth used transitively by the palette / client boundaries in
// some rendered trees — stub defensively.
jest.mock('next-auth/react', () => ({
    signOut: jest.fn(),
    signIn: jest.fn(),
}));


import AuditCyclesPage from '@/app/t/[tenantSlug]/(app)/audits/cycles/page';

import { DEFAULT_DATE_RANGE_PRESETS } from '@/components/ui/date-picker/presets-catalogue';

// ─── Fetch stub ──────────────────────────────────────────────────────

interface FetchCall {
    url: string;
    init?: RequestInit;
}
const fetchCalls: FetchCall[] = [];

function installFetchStub(cycleResponse: { ok: boolean; body?: unknown } = { ok: true, body: { id: 'cyc-1' } }) {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
        async (url: string, init?: RequestInit) => {
            fetchCalls.push({ url, init });
            if (url.endsWith('/audits/cycles') && (!init || init.method === undefined || init.method === 'GET')) {
                return {
                    ok: true,
                    json: async () => [] as unknown[],
                };
            }
            if (url.endsWith('/audits/cycles') && init?.method === 'POST') {
                return {
                    ok: cycleResponse.ok,
                    json: async () => cycleResponse.body,
                };
            }
            return { ok: true, json: async () => null };
        },
    );
}

beforeEach(() => {
    fetchCalls.length = 0;
    routerMock.push.mockReset();
    installFetchStub();
});
afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
});

async function mountAndOpenForm() {
    const utils = render(<AuditCyclesPage />);
    // Wait for the initial cycles fetch to resolve → component exits the loading state.
    await waitFor(() => {
        expect(utils.container.querySelector('#create-cycle-btn')).not.toBeNull();
    });
    const openBtn = utils.container.querySelector('#create-cycle-btn') as HTMLButtonElement;
    act(() => {
        fireEvent.click(openBtn);
    });
    await waitFor(() => {
        expect(utils.container.querySelector('#cycle-form')).not.toBeNull();
    });
    return utils;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Audit Cycles — DateRangePicker integration', () => {
    it('mounts a DateRangePicker labelled "Audit period" inside the create form', async () => {
        const { container, getByText } = await mountAndOpenForm();
        expect(getByText('Audit period')).toBeInTheDocument();

        // The picker exposes the canonical trigger marker the shared
        // primitives emit — so any future refactor of the trigger
        // visual can't silently remove the integration.
        const triggers = container.querySelectorAll('[data-date-picker-trigger]');
        expect(triggers.length).toBeGreaterThanOrEqual(1);
    });

    it('offers the curated audit-period preset subset', async () => {
        const { container } = await mountAndOpenForm();
        // Open the picker popover.
        const trigger = container.querySelector(
            '#cycle-form [data-date-picker-trigger]',
        ) as HTMLButtonElement;
        act(() => {
            fireEvent.click(trigger);
        });

        // The curated list is exactly the slice we selected — we
        // deliberately exclude day-level presets (Today, Yesterday)
        // from audit contexts.
        const expected = [
            'quarter-to-date',
            'year-to-date',
            'last-quarter',
            'last-year',
            'last-90-days',
            'last-30-days',
        ];
        for (const id of expected) {
            expect(
                document.querySelector(`[data-testid="date-picker-preset-${id}"]`),
            ).not.toBeNull();
        }
        // Non-audit presets must NOT appear — would be a regression
        // in the curated subset.
        expect(
            document.querySelector('[data-testid="date-picker-preset-today"]'),
        ).toBeNull();
        expect(
            document.querySelector('[data-testid="date-picker-preset-yesterday"]'),
        ).toBeNull();
    });

    it('shows the preset label on the trigger after selection', async () => {
        const { container } = await mountAndOpenForm();
        const trigger = container.querySelector(
            '#cycle-form [data-date-picker-trigger]',
        ) as HTMLButtonElement;
        act(() => {
            fireEvent.click(trigger);
        });
        const ytdRow = document.querySelector(
            '[data-testid="date-picker-preset-year-to-date"]',
        ) as HTMLElement;
        act(() => {
            fireEvent.click(ytdRow);
        });
        const updatedTrigger = container.querySelector(
            '#cycle-form [data-date-picker-trigger]',
        ) as HTMLButtonElement;
        const valueNode = updatedTrigger.querySelector(
            '[data-testid="date-picker-trigger-value"]',
        );
        expect(valueNode?.textContent).toBe('Year to date');
    });

    it('includes periodStartAt + periodEndAt in the create POST once a preset is applied', async () => {
        const { container } = await mountAndOpenForm();
        // Type a name (required).
        const nameInput = container.querySelector(
            '#cycle-name-input',
        ) as HTMLInputElement;
        fireEvent.change(nameInput, {
            target: { value: 'ISO27001 Q2 2026' },
        });

        // Open the picker + pick "Last quarter".
        const trigger = container.querySelector(
            '#cycle-form [data-date-picker-trigger]',
        ) as HTMLButtonElement;
        act(() => {
            fireEvent.click(trigger);
        });
        const lastQuarterRow = document.querySelector(
            '[data-testid="date-picker-preset-last-quarter"]',
        ) as HTMLElement;
        act(() => {
            fireEvent.click(lastQuarterRow);
        });

        // Submit.
        const form = container.querySelector('#cycle-form') as HTMLFormElement;
        await act(async () => {
            fireEvent.submit(form);
        });

        const postCall = fetchCalls.find(
            (c) =>
                c.url.endsWith('/audits/cycles') &&
                c.init?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const payload = JSON.parse(String(postCall!.init!.body)) as Record<
            string,
            unknown
        >;
        expect(payload.name).toBe('ISO27001 Q2 2026');
        expect(payload.frameworkKey).toBe('ISO27001');
        expect(typeof payload.periodStartAt).toBe('string');
        expect(typeof payload.periodEndAt).toBe('string');

        // Period boundaries should match the resolvable preset, modulo
        // the UTC-midnight origin vs. ISO time-of-day.
        const preset = DEFAULT_DATE_RANGE_PRESETS.find(
            (p) => p.id === 'last-quarter',
        )!;
        const expected = preset.resolve(new Date());
        // We only assert year+month+day because `period.to/from` come
        // from `resolve(new Date())` called inside the component — the
        // reference `now` here is the same wall-clock second, so the
        // quarter it picks must match.
        const actualStart = new Date(String(payload.periodStartAt));
        const actualEnd = new Date(String(payload.periodEndAt));
        expect(actualStart.getUTCFullYear()).toBe(expected.from!.getUTCFullYear());
        expect(actualStart.getUTCMonth()).toBe(expected.from!.getUTCMonth());
        expect(actualStart.getUTCDate()).toBe(expected.from!.getUTCDate());
        expect(actualEnd.getUTCFullYear()).toBe(expected.to!.getUTCFullYear());
        expect(actualEnd.getUTCMonth()).toBe(expected.to!.getUTCMonth());
        expect(actualEnd.getUTCDate()).toBe(expected.to!.getUTCDate());

        // Post-create navigation mirrors the pre-Epic-58 behaviour.
        expect(routerMock.push).toHaveBeenCalledWith(
            '/t/acme-corp/audits/cycles/cyc-1',
        );
    });

    it('omits periodStartAt + periodEndAt when the user skips the picker', async () => {
        const { container } = await mountAndOpenForm();
        const nameInput = container.querySelector(
            '#cycle-name-input',
        ) as HTMLInputElement;
        fireEvent.change(nameInput, {
            target: { value: 'Cycle without a period' },
        });
        const form = container.querySelector('#cycle-form') as HTMLFormElement;
        await act(async () => {
            fireEvent.submit(form);
        });

        const postCall = fetchCalls.find(
            (c) =>
                c.url.endsWith('/audits/cycles') &&
                c.init?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const payload = JSON.parse(String(postCall!.init!.body)) as Record<
            string,
            unknown
        >;
        expect(payload.name).toBe('Cycle without a period');
        expect('periodStartAt' in payload).toBe(false);
        expect('periodEndAt' in payload).toBe(false);
    });
});
