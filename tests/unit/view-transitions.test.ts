/**
 * @jest-environment jsdom
 */

/**
 * Route view-transitions — click-eligibility predicate (mobile-native-feel PR-3).
 *
 * `resolveNavTarget` is the "never break navigation" gate: it decides
 * whether a click should be enhanced with a View Transition (and
 * `preventDefault`ed) or left to the browser / Next Link untouched.
 * Every bail-out is a case where enhancing would be wrong or risky, so
 * each is locked here.
 */

import { resolveNavTarget, type NavClickFlags } from '@/lib/view-transitions';

const ORIGIN = 'http://localhost';
const CURRENT = { origin: ORIGIN, pathname: '/dashboard', search: '' };

const plainClick: NavClickFlags = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
};

function anchor(attrs: Record<string, string>): HTMLAnchorElement {
    const a = document.createElement('a');
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    return a;
}

describe('resolveNavTarget — eligible navigations', () => {
    it('returns the internal destination for a plain internal link', () => {
        const a = anchor({ href: '/farm-tasks' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBe('/farm-tasks');
    });

    it('preserves the query string', () => {
        const a = anchor({ href: '/farm-tasks?status=open' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBe(
            '/farm-tasks?status=open',
        );
    });
});

describe('resolveNavTarget — bail-outs (fall through to default)', () => {
    it('bails when the anchor is null', () => {
        expect(resolveNavTarget(null, plainClick, CURRENT)).toBeNull();
    });

    it('bails when the event was already default-prevented', () => {
        const a = anchor({ href: '/farm-tasks' });
        expect(
            resolveNavTarget(a, { ...plainClick, defaultPrevented: true }, CURRENT),
        ).toBeNull();
    });

    it('bails on a non-primary mouse button', () => {
        const a = anchor({ href: '/farm-tasks' });
        expect(resolveNavTarget(a, { ...plainClick, button: 1 }, CURRENT)).toBeNull();
    });

    it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)(
        'bails on %s (open-in-new-tab / new-window intent)',
        (mod) => {
            const a = anchor({ href: '/farm-tasks' });
            expect(
                resolveNavTarget(a, { ...plainClick, [mod]: true }, CURRENT),
            ).toBeNull();
        },
    );

    it('bails on target other than _self', () => {
        const a = anchor({ href: '/farm-tasks', target: '_blank' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails on a download link', () => {
        const a = anchor({ href: '/export.csv', download: '' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails on rel="external"', () => {
        const a = anchor({ href: '/farm-tasks', rel: 'noopener external' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails on a hash-only link (same-page anchor)', () => {
        const a = anchor({ href: '#section' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails on a cross-origin link', () => {
        const a = anchor({ href: 'https://evil.example.com/x' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails when the destination is the current path + query (no real nav)', () => {
        const a = anchor({ href: '/dashboard' });
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });

    it('bails when the anchor has no href', () => {
        const a = anchor({});
        expect(resolveNavTarget(a, plainClick, CURRENT)).toBeNull();
    });
});
