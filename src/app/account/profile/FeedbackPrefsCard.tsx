'use client';

import { Heading } from '@/components/ui/typography';
import { Switch } from '@/components/ui/switch';
import { useLocalStorage } from '@/components/ui/hooks';
import { SOUND_PREF_KEY, HAPTICS_PREF_KEY } from '@/lib/feedback-prefs';

/**
 * Sound & haptics preferences (feat/delight-shareables).
 *
 * Both default ON; the toggles persist to the same localStorage keys that
 * `haptic()` / `playSound()` read at call time, so flipping one here changes
 * the next "mark done" confirmation. Capability-gating still applies on top —
 * a device without the Vibration / Web Audio API stays silent regardless.
 */
export function FeedbackPrefsCard() {
    const [sound, setSound] = useLocalStorage<boolean>(SOUND_PREF_KEY, true);
    const [haptics, setHaptics] = useLocalStorage<boolean>(HAPTICS_PREF_KEY, true);

    return (
        <div className="mt-6 space-y-default rounded-lg border border-border-subtle bg-bg-default p-default">
            <div className="space-y-1">
                <Heading level={2} className="text-sm">
                    Sound &amp; haptics
                </Heading>
                <p className="text-xs text-content-secondary">
                    Confirmation when you mark field work done. Stays silent on devices that
                    don&rsquo;t support it.
                </p>
            </div>
            <div className="flex items-center justify-between gap-default">
                <span className="text-sm text-content-default">Success sound</span>
                <Switch
                    checked={sound}
                    onCheckedChange={setSound}
                    aria-label="Success sound on marking work done"
                />
            </div>
            <div className="flex items-center justify-between gap-default">
                <span className="text-sm text-content-default">Haptic feedback</span>
                <Switch
                    checked={haptics}
                    onCheckedChange={setHaptics}
                    aria-label="Haptic feedback on marking work done"
                />
            </div>
        </div>
    );
}

export default FeedbackPrefsCard;
