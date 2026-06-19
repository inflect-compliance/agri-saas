/**
 * @jest-environment jsdom
 *
 * Haptics is capability-gated + reduced-motion-aware: it fires
 * navigator.vibrate only when the Vibration API exists AND the user hasn't
 * asked for reduced motion. Anything else is a silent no-op (desktop, iOS
 * Safari, reduced-motion).
 */
import { haptic, canVibrate } from '@/lib/haptics';

function setReducedMotion(reduced: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({
            matches: reduced,
            media: query,
            addEventListener() {},
            removeEventListener() {},
        }),
    });
}

afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
});

describe('haptics', () => {
    it('is a no-op when the Vibration API is absent', () => {
        setReducedMotion(false);
        expect(canVibrate()).toBe(false);
        expect(() => haptic('tap')).not.toThrow();
    });

    it('fires navigator.vibrate with the named pattern when supported', () => {
        const vibrate = jest.fn();
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
        setReducedMotion(false);
        expect(canVibrate()).toBe(true);
        haptic('success');
        expect(vibrate).toHaveBeenCalledWith([12, 40, 18]);
    });

    it('is a no-op under prefers-reduced-motion even when supported', () => {
        const vibrate = jest.fn();
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
        setReducedMotion(true);
        expect(canVibrate()).toBe(false);
        haptic('tap');
        expect(vibrate).not.toHaveBeenCalled();
    });
});
