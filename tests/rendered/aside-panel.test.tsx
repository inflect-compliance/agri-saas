/** @jest-environment jsdom */

/**
 * Rendered (Tier-2) test — `<AsidePanel>` (right-rail Phase 1).
 *
 * Pins the primitive's behaviour: the docked panel renders its
 * content, the collapse toggle swaps docked ↔ spine, the state
 * persists to localStorage under the `surfaceKey`, and the `<xl`
 * Sheet trigger is always present (the responsive fallback).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { AsidePanel } from '@/components/ui/aside-panel';

beforeEach(() => {
    window.localStorage.clear();
});

describe('<AsidePanel>', () => {
    it('renders the docked panel expanded by default, with its content', () => {
        render(
            <AsidePanel title="Linked Tasks" surfaceKey="test-surface">
                <p>rail body</p>
            </AsidePanel>,
        );
        const docked = screen.getByTestId('aside-panel-docked');
        expect(docked).toBeInTheDocument();
        expect(screen.queryByTestId('aside-panel-spine')).toBeNull();
        // Title + content both render inside the docked panel.
        expect(within(docked).getByText('rail body')).toBeInTheDocument();
        expect(within(docked).getByText('Linked Tasks')).toBeInTheDocument();
    });

    it('collapses to a spine on the collapse toggle, and re-expands', async () => {
        const user = userEvent.setup();
        render(
            <AsidePanel title="Linked Tasks" surfaceKey="test-surface">
                <p>rail body</p>
            </AsidePanel>,
        );

        await user.click(
            screen.getByRole('button', { name: /collapse linked tasks/i }),
        );
        expect(screen.getByTestId('aside-panel-spine')).toBeInTheDocument();
        expect(screen.queryByTestId('aside-panel-docked')).toBeNull();

        await user.click(
            screen.getByRole('button', { name: /expand linked tasks/i }),
        );
        expect(screen.getByTestId('aside-panel-docked')).toBeInTheDocument();
        expect(screen.queryByTestId('aside-panel-spine')).toBeNull();
    });

    it('persists the collapsed state to localStorage under the surfaceKey', async () => {
        const user = userEvent.setup();
        render(
            <AsidePanel title="Linked Tasks" surfaceKey="risk-detail">
                <p>rail body</p>
            </AsidePanel>,
        );
        await user.click(
            screen.getByRole('button', { name: /collapse linked tasks/i }),
        );
        // The collapse state is keyed by surfaceKey so each rail
        // surface remembers independently.
        expect(
            window.localStorage.getItem('aside:collapsed:risk-detail'),
        ).toBe('true');
    });

    it('starts collapsed when localStorage already has a collapsed state', async () => {
        window.localStorage.setItem('aside:collapsed:risk-detail', 'true');
        render(
            <AsidePanel title="Linked Tasks" surfaceKey="risk-detail">
                <p>rail body</p>
            </AsidePanel>,
        );
        // useLocalStorage hydrates from storage in an effect.
        expect(
            await screen.findByTestId('aside-panel-spine'),
        ).toBeInTheDocument();
    });

    it('always renders the <xl Sheet trigger (responsive fallback)', () => {
        render(
            <AsidePanel title="Linked Tasks" surfaceKey="test-surface">
                <p>rail body</p>
            </AsidePanel>,
        );
        // The Sheet trigger is the < xl path — present in the DOM
        // regardless of collapse state; CSS (`xl:hidden`) governs
        // which surface is visible at runtime.
        expect(
            screen.getByTestId('aside-panel-sheet-trigger'),
        ).toBeInTheDocument();
    });
});
