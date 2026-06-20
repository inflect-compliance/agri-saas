/**
 * Capability-gated mobile haptics (Vibration API).
 *
 * A silent no-op when:
 *   - the Vibration API is absent (desktop browsers, iOS Safari), or
 *   - the user prefers reduced motion (we treat haptics as non-essential
 *     feedback the preference should suppress).
 *
 * Patterns are short on purpose — a field operator marking jobs with gloves
 * wants a crisp confirmation, never a buzz that slows them down.
 */
import { prefersReducedMotion } from '@/components/ui/hooks/use-reduced-motion';
import { isHapticsEnabled } from '@/lib/feedback-prefs';

export type HapticKind = 'tap' | 'success' | 'warning' | 'error';

const PATTERNS: Record<HapticKind, number | number[]> = {
    tap: 10,
    success: [12, 40, 18],
    warning: [20, 50, 20],
    error: [40, 30, 40],
};

/** True when this device can produce haptics + the user hasn't opted out. */
export function canVibrate(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.vibrate === 'function' &&
        !prefersReducedMotion() &&
        isHapticsEnabled()
    );
}

/** Fire a short haptic. Best-effort — failures are swallowed. */
export function haptic(kind: HapticKind = 'tap'): void {
    try {
        if (!canVibrate()) return;
        navigator.vibrate(PATTERNS[kind]);
    } catch {
        /* unsupported / blocked — ignore */
    }
}
