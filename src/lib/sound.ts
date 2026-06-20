/**
 * Short action-feedback sounds via the Web Audio API (feat/delight-shareables).
 *
 * No asset files — a tiny generated tone, so it's offline-safe and costs zero
 * bundle weight. Capability-gated (Web Audio absent → silent) and respects the
 * user's sound toggle. Best-effort — failures are swallowed so a field
 * operator's "mark done" never breaks on an audio quirk.
 *
 * Pairs with `haptic()` (src/lib/haptics.ts) at action-completion sites.
 */
import { isSoundEnabled } from './feedback-prefs';

export type SoundKind = 'success' | 'error' | 'tap';

const TONES: Record<SoundKind, { freq: number; durationS: number }> = {
    success: { freq: 880, durationS: 0.18 }, // bright, short — "done"
    error: { freq: 220, durationS: 0.24 },
    tap: { freq: 660, durationS: 0.07 },
};

type AudioContextCtor = typeof AudioContext;

// One shared context, lazily created on first (user-gesture-triggered) play.
let sharedCtx: AudioContext | null = null;

function resolveAudioContextCtor(): AudioContextCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Play a short feedback tone. No-op when disabled or unsupported. */
export function playSound(kind: SoundKind = 'success'): void {
    try {
        if (!isSoundEnabled()) return;
        const Ctor = resolveAudioContextCtor();
        if (!Ctor) return;
        sharedCtx ??= new Ctor();
        const ctx = sharedCtx;
        // Autoplay policy: a context created before a gesture starts suspended.
        if (ctx.state === 'suspended') void ctx.resume();

        const { freq, durationS } = TONES[kind];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // Quick attack, exponential decay — a crisp blip, never a drone.
        const t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + durationS);
    } catch {
        /* Web Audio unavailable / blocked — silent */
    }
}
