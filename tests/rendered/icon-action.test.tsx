/**
 * IconAction — rendered a11y contract (2026-06-07).
 *
 * The reduction removes visible text, so the accessibility burden shifts
 * entirely onto the `aria-label` + tooltip. These behavioural assertions
 * lock that the icon-only button still has an accessible name, stays
 * keyboard-operable, and carries no visible text label.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IconAction } from '@/components/ui/icon-action';

function renderWithProvider(ui: React.ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('IconAction (rendered a11y)', () => {
    it('exposes an accessible name from `label` (no visible text)', () => {
        renderWithProvider(
            <IconAction
                icon={<svg data-testid="ic" aria-hidden="true" />}
                label="Import risks"
                onClick={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: 'Import risks' });
        expect(btn).toHaveAttribute('aria-label', 'Import risks');
        // Icon-only: the label is NOT rendered as visible text content.
        expect(btn).toHaveTextContent('');
        expect(screen.getByTestId('ic')).toBeInTheDocument();
    });

    it('is keyboard-operable (Enter fires onClick) and focusable', async () => {
        const onClick = jest.fn();
        const user = userEvent.setup();
        renderWithProvider(
            <IconAction
                icon={<svg aria-hidden="true" />}
                label="Apply"
                variant="primary"
                onClick={onClick}
            />,
        );
        await user.tab();
        expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('forwards disabled state', () => {
        renderWithProvider(
            <IconAction
                icon={<svg aria-hidden="true" />}
                label="Freeze pack"
                disabled
                onClick={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Freeze pack' })).toBeDisabled();
    });
});
