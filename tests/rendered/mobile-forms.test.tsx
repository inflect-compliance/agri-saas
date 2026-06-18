/**
 * @jest-environment jsdom
 *
 * Mobile-forms PR-3 primitives:
 *   1. <Fab> — mobile-only floating create button (md:hidden, fires onClick).
 *   2. <Modal isDirty> dirty-guard — a dismiss (X / Escape / backdrop / drag)
 *      on an edited form asks "Discard changes?" instead of closing; the
 *      explicit Cancel button still closes directly.
 *
 * useMediaQuery is forced to desktop so the Modal renders the Radix Dialog
 * (Vaul's drag handlers throw in jsdom) — the close path under test is the
 * same on both surfaces.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Radix Presence keeps fly-out-animated nodes mounted until `animationend`,
// which jsdom never fires — so portals leak across tests. Nuke the body too.
afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

/** The form modal's floating X carries `data-modal-close` (the discard
 *  confirm has no X). jsdom can leak prior-test portals into the body, so
 *  click the LAST match — the current render's. */
function clickModalX() {
    const xs = document.querySelectorAll<HTMLElement>('[data-modal-close]');
    fireEvent.click(xs[xs.length - 1]);
}
/** Last-match query — robust against leaked portals from earlier tests. */
function lastButton(name: string): HTMLElement {
    const all = screen.getAllByRole('button', { name });
    return all[all.length - 1];
}

// Modal uses Next's useRouter() as a fallback close path; stub it.
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/components/ui/hooks', () => {
    const actual = jest.requireActual('@/components/ui/hooks');
    return {
        ...actual,
        useMediaQuery: () => ({
            device: 'desktop',
            width: 1024,
            height: 768,
            isMobile: false,
            isDesktop: true,
        }),
    };
});

import { Fab } from '@/components/ui/fab';
import { Modal } from '@/components/ui/modal';

describe('Fab', () => {
    it('renders a mobile-only labelled button that fires onClick', () => {
        const onClick = jest.fn();
        render(<Fab onClick={onClick} label="New Task" icon={<svg data-testid="plus" />} />);
        const btn = screen.getByRole('button', { name: 'New Task' });
        expect(btn).toHaveClass('md:hidden');
        expect(btn).toHaveClass('fixed');
        expect(btn.querySelector('[data-testid="plus"]')).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('Modal isDirty dirty-guard', () => {
    function DirtyModal({ setShowModal }: { setShowModal: jest.Mock }) {
        return (
            <Modal showModal setShowModal={setShowModal} isDirty title="Edit task">
                <Modal.Header title="Edit task" />
                <Modal.Body>
                    <input aria-label="Title" defaultValue="x" />
                </Modal.Body>
                <Modal.Actions>
                    <button type="button" onClick={() => setShowModal(false)}>
                        Cancel
                    </button>
                    <button type="button">Save</button>
                </Modal.Actions>
            </Modal>
        );
    }

    // Runs first (before any modal-opening test leaks portals into the body)
    // so the negative "no discard confirm" assertion is unambiguous.
    it('the explicit Cancel button closes directly (no guard)', () => {
        const setShowModal = jest.fn();
        render(<DirtyModal setShowModal={setShowModal} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(setShowModal).toHaveBeenCalledWith(false);
        expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    });

    it('a dismiss on a dirty form asks first instead of closing', () => {
        const setShowModal = jest.fn();
        render(<DirtyModal setShowModal={setShowModal} />);
        clickModalX();
        expect(setShowModal).not.toHaveBeenCalled();
        expect(screen.getAllByText('Discard changes?').at(-1)).toBeInTheDocument();
    });

    it('"Discard" closes the form', () => {
        const setShowModal = jest.fn();
        render(<DirtyModal setShowModal={setShowModal} />);
        clickModalX();
        fireEvent.click(lastButton('Discard'));
        expect(setShowModal).toHaveBeenCalledWith(false);
    });
});
