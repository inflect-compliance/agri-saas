/**
 * R26-PR-F — Canvas help strip rendered tests.
 *
 * The strip must mount for first-time users, hide once they
 * dismiss it, and self-hide once the canvas has both nodes AND
 * edges (signals "I figured it out").
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasHelpStrip } from '@/components/processes/CanvasHelpStrip';

beforeEach(() => {
    window.localStorage.clear();
});

describe('CanvasHelpStrip', () => {
    it('renders the four canonical hints for a fresh canvas', () => {
        render(<CanvasHelpStrip nodeCount={0} edgeCount={0} />);
        expect(screen.getByText('Tips')).toBeInTheDocument();
        expect(
            screen.getByText(/Drag from the palette to add a node/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Connect handles to draw an edge/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Drop a node near another to auto-bind/),
        ).toBeInTheDocument();
        // R27-PR-C — the edge hint now covers both the variant
        // affordance and the add-control affordance.
        expect(
            screen.getByText(/Select an edge to set its style or add a control/),
        ).toBeInTheDocument();
    });

    it('self-hides once the canvas has both nodes AND edges', () => {
        const { container } = render(
            <CanvasHelpStrip nodeCount={3} edgeCount={1} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('stays visible when there are nodes but no edges yet', () => {
        const { container } = render(
            <CanvasHelpStrip nodeCount={3} edgeCount={0} />,
        );
        expect(container.firstChild).not.toBeNull();
    });

    it('Got-it dismisses the strip and persists across remounts', () => {
        const { container, unmount } = render(
            <CanvasHelpStrip nodeCount={0} edgeCount={0} />,
        );
        expect(container.firstChild).not.toBeNull();
        fireEvent.click(screen.getByTestId('canvas-help-dismiss'));
        expect(container.firstChild).toBeNull();
        unmount();

        const remount = render(<CanvasHelpStrip nodeCount={0} edgeCount={0} />);
        expect(remount.container.firstChild).toBeNull();
    });
});
