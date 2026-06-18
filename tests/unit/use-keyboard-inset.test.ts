/**
 * @jest-environment jsdom
 *
 * useKeyboardInset — derives the soft-keyboard height from VisualViewport.
 */
import { renderHook, act } from '@testing-library/react';
import { useKeyboardInset } from '@/components/ui/hooks';

type VV = {
    height: number;
    offsetTop: number;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    _fire: () => void;
};

function installVisualViewport(height: number, offsetTop = 0): VV {
    const listeners: Array<() => void> = [];
    const vv: VV = {
        height,
        offsetTop,
        addEventListener: jest.fn((_e: string, cb: () => void) => listeners.push(cb)),
        removeEventListener: jest.fn(),
        _fire: () => listeners.forEach((l) => l()),
    };
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: vv,
    });
    return vv;
}

describe('useKeyboardInset', () => {
    const originalInner = window.innerHeight;
    afterEach(() => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInner });
        // @ts-expect-error reset
        delete window.visualViewport;
    });

    it('reports zero inset when the visual viewport fills the layout viewport', () => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        installVisualViewport(800);
        const { result } = renderHook(() => useKeyboardInset());
        expect(result.current.inset).toBe(0);
        expect(result.current.height).toBe(800);
    });

    it('reports the keyboard height when the visual viewport shrinks', () => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        const vv = installVisualViewport(800);
        const { result } = renderHook(() => useKeyboardInset());

        // Keyboard opens → visible area shrinks to 460px (340px keyboard).
        act(() => {
            vv.height = 460;
            vv._fire();
        });
        expect(result.current.inset).toBe(340);
        expect(result.current.height).toBe(460);
    });

    it('ignores sub-threshold gaps (browser chrome, not a keyboard)', () => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        const vv = installVisualViewport(800);
        const { result } = renderHook(() => useKeyboardInset());
        act(() => {
            vv.height = 720; // 80px gap — below the 120px keyboard threshold
            vv._fire();
        });
        expect(result.current.inset).toBe(0);
    });
});
