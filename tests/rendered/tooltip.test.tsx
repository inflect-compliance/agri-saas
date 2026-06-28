/**
 * Rendered tests for the Epic 56 Tooltip primitive.
 *
 * Imports the real module via `@/components/ui/tooltip`, which is handled
 * by the generic `@/` path mapper in jest.config.js and therefore bypasses
 * the relative-path stub used by every other render test.
 *
 * Covers:
 *   - basic render of trigger + portalised content
 *   - keyboard focus opens the tooltip and connects aria-describedby
 *   - Escape closes
 *   - `disabled` prop renders children untouched with no tooltip wiring
 *   - string and ReactNode content paths
 *   - `title` + `shortcut` render in the header row
 *   - InfoTooltip exposes an accessible help button
 *   - axe finds no violations on the open tooltip
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import * as React from 'react';

import {
    Tooltip,
    TooltipProvider,
    InfoTooltip,
    DynamicTooltipWrapper,
    TOOLTIPS_ENABLED,
} from '@/components/ui/tooltip';

// Tooltips are globally switched off (mobile popup breakage — see
// tooltip.tsx). The behavioural "it opens / shows content" cases only
// make sense while the popup is live, so they skip themselves until
// TOOLTIPS_ENABLED flips back to true. The short-circuit / no-op cases
// below still run and lock in the disabled behaviour.
const itWhenEnabled = TOOLTIPS_ENABLED ? it : it.skip;

function Harness({ children }: { children: React.ReactNode }) {
    // Use delayDuration={0} so the tooltip opens immediately in tests —
    // waitFor can still poll safely, but we avoid hitting Radix's timer
    // which jsdom's fake clock can race with.
    return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}

describe('Tooltip primitive', () => {
    it('renders only the trigger until a user interacts', () => {
        render(
            <Harness>
                <Tooltip content="Delete row">
                    <button type="button">Delete</button>
                </Tooltip>
            </Harness>,
        );

        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    itWhenEnabled('opens on keyboard focus and exposes aria-describedby linkage', async () => {
        const user = userEvent.setup();
        render(
            <Harness>
                <Tooltip content="Delete this row">
                    <button type="button">Delete</button>
                </Tooltip>
            </Harness>,
        );

        const trigger = screen.getByRole('button', { name: 'Delete' });
        await user.tab();
        expect(trigger).toHaveFocus();

        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip).toHaveTextContent('Delete this row');

        // Radix writes aria-describedby on the trigger pointing at the
        // content node — this is how screen readers announce the hint.
        await waitFor(() => {
            const describedBy = trigger.getAttribute('aria-describedby');
            expect(describedBy).toBeTruthy();
            expect(tooltip.id).toBe(describedBy);
        });
    });

    itWhenEnabled('closes on Escape', async () => {
        const user = userEvent.setup();
        render(
            <Harness>
                <Tooltip content="Hint">
                    <button type="button">Hover me</button>
                </Tooltip>
            </Harness>,
        );

        await user.tab();
        await screen.findByRole('tooltip');

        await user.keyboard('{Escape}');
        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });
    });

    itWhenEnabled('renders ReactNode content (rich body)', async () => {
        render(
            <Harness>
                <Tooltip
                    content={
                        <div data-testid="rich-body">
                            <strong>Bold</strong> body with <em>italic</em>.
                        </div>
                    }
                >
                    <button type="button">Help</button>
                </Tooltip>
            </Harness>,
        );

        const user = userEvent.setup();
        await user.tab();

        // Radix renders tooltip content twice: once inside the positioned
        // tooltip and once in a visually-hidden screen-reader announcement
        // region. Both should carry the ReactNode intact.
        const bodies = await screen.findAllByTestId('rich-body');
        expect(bodies.length).toBeGreaterThanOrEqual(1);
        for (const body of bodies) {
            expect(body).toHaveTextContent('Bold body with italic.');
        }
    });

    itWhenEnabled('renders the `title` + `shortcut` header above the content', async () => {
        render(
            <Harness>
                <Tooltip
                    title="Help menu"
                    content="Opens contextual documentation."
                    shortcut="?"
                >
                    <button type="button">Help</button>
                </Tooltip>
            </Harness>,
        );

        const user = userEvent.setup();
        await user.tab();

        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip).toHaveTextContent('Help menu');
        expect(tooltip).toHaveTextContent('Opens contextual documentation.');

        // The shortcut renders inside a <kbd> element for semantic clarity.
        const kbd = tooltip.querySelector('kbd');
        expect(kbd).not.toBeNull();
        expect(kbd!).toHaveTextContent('?');
    });

    it('short-circuits when `disabled` — no tooltip wiring, no aria-describedby', () => {
        render(
            <Harness>
                <Tooltip content="Would be here" disabled>
                    <button type="button">Trigger</button>
                </Tooltip>
            </Harness>,
        );

        const trigger = screen.getByRole('button', { name: 'Trigger' });
        expect(trigger.getAttribute('aria-describedby')).toBeNull();
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('DynamicTooltipWrapper is a no-op when tooltipProps is undefined', () => {
        render(
            <Harness>
                <DynamicTooltipWrapper tooltipProps={undefined}>
                    <span>Bare content</span>
                </DynamicTooltipWrapper>
            </Harness>,
        );

        expect(screen.getByText('Bare content')).toBeInTheDocument();
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    describe('InfoTooltip', () => {
        it('exposes the help button with an accessible label', () => {
            render(
                <Harness>
                    <InfoTooltip content="Evidence must be dated." />
                </Harness>,
            );

            const helpButton = screen.getByRole('button', { name: 'More information' });
            expect(helpButton).toBeInTheDocument();
        });

        it('uses a caller-provided aria-label', () => {
            render(
                <Harness>
                    <InfoTooltip
                        aria-label="Field validation help"
                        content="Evidence must be dated."
                    />
                </Harness>,
            );

            expect(
                screen.getByRole('button', { name: 'Field validation help' }),
            ).toBeInTheDocument();
        });

        itWhenEnabled('opens the tooltip on keyboard focus', async () => {
            const user = userEvent.setup();
            render(
                <Harness>
                    <InfoTooltip content="Evidence must be dated." />
                </Harness>,
            );

            await user.tab();
            const tooltip = await screen.findByRole('tooltip');
            expect(tooltip).toHaveTextContent('Evidence must be dated.');
        });
    });

    describe('a11y', () => {
        itWhenEnabled('open tooltip has no axe violations', async () => {
            const { container } = render(
                <Harness>
                    <Tooltip
                        title="ISO 27001 Clause 9.3"
                        content="Management review ensures the ISMS remains suitable."
                        shortcut="?"
                    >
                        <button type="button">Help</button>
                    </Tooltip>
                </Harness>,
            );

            const user = userEvent.setup();
            await user.tab();
            await screen.findByRole('tooltip');

            const results = await axe(container);
            expect(results).toHaveNoViolations();
        });
    });
});
