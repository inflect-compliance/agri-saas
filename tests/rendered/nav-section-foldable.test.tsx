/** @jest-environment jsdom */
/**
 * Foldable sidebar sections — the `<NavSection>` disclosure contract.
 *
 * A titled section can fold its items away and unfold them when its header is
 * clicked. The header stays the R12-PR3 decorative `<span>` recipe (10px,
 * select-none) nested inside the disclosure `<button>` — the button owns the
 * click-target + aria-expanded, the span owns the type. In the collapsed
 * icon-rail the header is dropped and every item is always shown.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { NavSection } from '@/components/layout/nav-section';
import { SidebarCollapseProvider } from '@/components/layout/sidebar-collapse-context';

function items() {
    return (
        <>
            <a href="/marketplace">Marketplace</a>
            <a href="/trends">Trends</a>
        </>
    );
}

describe('NavSection — foldable disclosure', () => {
    it('renders items and an expanded disclosure button when open', () => {
        render(
            <NavSection title="Exchange" collapsible open onToggleOpen={jest.fn()}>
                {items()}
            </NavSection>,
        );
        const header = screen.getByRole('button', { name: 'Exchange' });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Marketplace')).toBeInTheDocument();
        expect(screen.getByText('Trends')).toBeInTheDocument();
    });

    it('hides the items (but keeps the header) when folded', () => {
        render(
            <NavSection title="Exchange" collapsible open={false} onToggleOpen={jest.fn()}>
                {items()}
            </NavSection>,
        );
        const header = screen.getByRole('button', { name: 'Exchange' });
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Marketplace')).not.toBeInTheDocument();
        expect(screen.queryByText('Trends')).not.toBeInTheDocument();
    });

    it('fires onToggleOpen when the header is clicked', () => {
        const onToggle = jest.fn();
        render(
            <NavSection title="Exchange" collapsible open={false} onToggleOpen={onToggle}>
                {items()}
            </NavSection>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Exchange' }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('keeps the header a plain, non-interactive label when not collapsible', () => {
        render(
            <NavSection title="Exchange">
                {items()}
            </NavSection>,
        );
        // No disclosure button — the header is the decorative span.
        expect(screen.queryByRole('button', { name: 'Exchange' })).not.toBeInTheDocument();
        expect(screen.getByText('Exchange')).toBeInTheDocument();
        // Items always shown for a non-collapsible section.
        expect(screen.getByText('Marketplace')).toBeInTheDocument();
    });

    it('in the collapsed icon-rail, shows every item and drops the header even when folded', () => {
        render(
            <SidebarCollapseProvider collapsed>
                <NavSection title="Exchange" collapsible open={false} onToggleOpen={jest.fn()}>
                    {items()}
                </NavSection>
            </SidebarCollapseProvider>,
        );
        // Icon rail: no header text, and items are NOT folded away.
        expect(screen.queryByText('Exchange')).not.toBeInTheDocument();
        expect(screen.getByText('Marketplace')).toBeInTheDocument();
        expect(screen.getByText('Trends')).toBeInTheDocument();
    });
});
