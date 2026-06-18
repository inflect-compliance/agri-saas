import { useEffect, useState } from "react";

/**
 * Tracks the on-screen (virtual) keyboard via the VisualViewport API.
 *
 * When a soft keyboard opens on a phone, the *layout* viewport doesn't
 * change but the *visual* viewport shrinks from the bottom. A
 * `position: fixed; bottom: 0` element (a bottom drawer / sheet) stays
 * anchored to the layout-viewport bottom — i.e. BEHIND the keyboard — so
 * its pinned footer (Save/Cancel) disappears. This hook reports:
 *
 *   - `inset`  — the keyboard height in CSS px (0 when closed). Lift a
 *     bottom-anchored surface by this much (`bottom: inset`) to sit it on
 *     top of the keyboard.
 *   - `height` — the current visual-viewport height in CSS px. Cap the
 *     surface's `maxHeight` to this so its header stays on-screen too.
 *
 * SSR-safe (returns zeros until mounted). A small threshold filters out
 * browser-chrome show/hide jitter so only a real keyboard registers.
 */
export interface KeyboardInset {
  /** Keyboard height in CSS px (0 when no keyboard). */
  inset: number;
  /** Visual-viewport height in CSS px (0 before mount). */
  height: number;
}

// Below this many px the bottom gap is browser chrome (URL bar, etc.),
// not a keyboard — ignore it to avoid the surface jittering on scroll.
const KEYBOARD_MIN_PX = 120;

export function useKeyboardInset(): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>({ inset: 0, height: 0 });

  useEffect(() => {
    const vv =
      typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      // How much of the layout viewport's bottom is covered (keyboard +
      // any below-the-fold chrome). offsetTop accounts for a viewport
      // that has scrolled within the layout viewport.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      const inset = covered > KEYBOARD_MIN_PX ? Math.round(covered) : 0;
      setState({ inset, height: Math.round(vv.height) });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}
