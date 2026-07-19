/** @jest-environment jsdom */
/**
 * P3.2-follow — mobile popovers nested inside an overlay bottom-anchor.
 *
 * A Popover already inside a Sheet/Modal can't stack a second Vaul drawer, so
 * it falls through to the Radix dropdown. Anchored to its trigger that dropdown
 * lands cramped near the TOP of the screen inside a bottom Sheet (the reported
 * parcel-sheet bug). It now carries `data-mobile-sheet="true"`, which the
 * globals.css rule uses to re-anchor Radix's positioning wrapper to the
 * viewport bottom — so every mobile picker rises from the bottom edge.
 *
 * These tests lock the MARKER (the seam the CSS keys off) and the three cases
 * that must NOT get it. The re-anchoring itself is CSS and can't be asserted in
 * jsdom, so the marker is the contract.
 */
import { render, screen } from '@testing-library/react';

const mockMediaQuery = jest.fn();
jest.mock('@/components/ui/hooks', () => ({
    ...jest.requireActual('@/components/ui/hooks'),
    useMediaQuery: () => mockMediaQuery(),
    useKeyboardInset: () => ({ inset: 0, height: undefined }),
    useReducedMotion: () => true,
}));

import { Popover } from '@/components/ui/popover';
import { OverlayDepthProvider } from '@/components/ui/overlay-depth';

function renderPopover({
    inOverlay,
    forceDropdown,
}: {
    inOverlay: boolean;
    forceDropdown?: boolean;
}) {
    const popover = (
        <Popover
            openPopover
            setOpenPopover={jest.fn()}
            forceDropdown={forceDropdown}
            content={<div>option-list</div>}
        >
            <button type="button">trigger</button>
        </Popover>
    );
    return render(
        inOverlay ? <OverlayDepthProvider>{popover}</OverlayDepthProvider> : popover,
    );
}

describe('Popover — mobile bottom-anchoring inside an overlay', () => {
    afterEach(() => mockMediaQuery.mockReset());

    it('marks the content as a bottom sheet on mobile inside an overlay', () => {
        mockMediaQuery.mockReturnValue({ isMobile: true });
        renderPopover({ inOverlay: true });
        expect(screen.getByText('option-list')).toBeInTheDocument();
        expect(document.querySelector('[data-mobile-sheet="true"]')).not.toBeNull();
    });

    it('does NOT mark it on desktop inside an overlay (trigger-anchored dropdown)', () => {
        mockMediaQuery.mockReturnValue({ isMobile: false });
        renderPopover({ inOverlay: true });
        expect(document.querySelector('[data-mobile-sheet="true"]')).toBeNull();
    });

    it('does NOT mark it when forceDropdown opts out explicitly', () => {
        mockMediaQuery.mockReturnValue({ isMobile: true });
        renderPopover({ inOverlay: true, forceDropdown: true });
        expect(document.querySelector('[data-mobile-sheet="true"]')).toBeNull();
    });

    it('does NOT mark it on mobile at page root — that case still gets the Vaul drawer', () => {
        mockMediaQuery.mockReturnValue({ isMobile: true });
        renderPopover({ inOverlay: false });
        expect(document.querySelector('[data-mobile-sheet="true"]')).toBeNull();
    });
});
