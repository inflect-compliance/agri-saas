/**
 * User toggle for tactile/audible action feedback (feat/delight-shareables).
 *
 * Both default ON. Stored in localStorage so the choice sticks per browser —
 * `haptic()` and `playSound()` read these at call time (outside React), so the
 * readers use raw localStorage here in the lib layer (the same allowance as
 * celebrations.ts / coach-marks.ts; the `src/app/**` ban targets UI components
 * reaching past the useLocalStorage hook). SSR-safe; fails soft (storage
 * blocked → the ON default applies).
 *
 * The settings toggle UI writes these keys through the `useLocalStorage` hook,
 * which JSON-serialises booleans — so the readers parse JSON to stay in sync.
 */

export const SOUND_PREF_KEY = 'agri.feedback.sound';
export const HAPTICS_PREF_KEY = 'agri.feedback.haptics';

function readFlag(key: string): boolean {
    if (typeof window === 'undefined') return true;
    try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? true : JSON.parse(raw) === true;
    } catch {
        return true;
    }
}

/** True unless the user has turned action sounds off. */
export function isSoundEnabled(): boolean {
    return readFlag(SOUND_PREF_KEY);
}

/** True unless the user has turned haptics off. */
export function isHapticsEnabled(): boolean {
    return readFlag(HAPTICS_PREF_KEY);
}
