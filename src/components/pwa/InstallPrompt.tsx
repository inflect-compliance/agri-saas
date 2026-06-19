'use client';

/**
 * InstallPrompt — the "Install AgriSaaS" affordance for the operator PWA.
 *
 * Two paths, mobile-only:
 *   - Android/Chromium: capture the `beforeinstallprompt` event, suppress
 *     the mini-infobar, and show our own dismissible banner whose Install
 *     button replays the deferred prompt.
 *   - iOS Safari (no beforeinstallprompt): show an "Add to Home Screen"
 *     hint pointing at the Share-sheet, since that's the only install path.
 *
 * Dismiss snoozes for 7 days (localStorage). Hidden when already running
 * standalone (installed). Renders nothing on desktop.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/components/ui/hooks';

const SNOOZE_KEY = 'agri.install.snoozeUntil';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isSnoozed(): boolean {
    try {
        const until = Number(globalThis.localStorage?.getItem(SNOOZE_KEY) ?? '0');
        return Number.isFinite(until) && until > Date.now();
    } catch {
        return false;
    }
}

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

function isIos(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
}

export function InstallPrompt() {
    const { isMobile } = useMediaQuery();
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [iosHint, setIosHint] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (isStandalone() || isSnoozed()) return;

        const onBeforeInstall = (e: Event) => {
            e.preventDefault(); // suppress the default mini-infobar
            setDeferred(e as BeforeInstallPromptEvent);
        };
        const onInstalled = () => {
            setDeferred(null);
            setIosHint(false);
        };
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onInstalled);

        // iOS has no beforeinstallprompt — show the A2HS hint directly.
        if (isIos()) setIosHint(true);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const snooze = useCallback(() => {
        try {
            globalThis.localStorage?.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
        } catch {
            /* private mode — just hide for this session */
        }
        setDismissed(true);
    }, []);

    const install = useCallback(async () => {
        if (!deferred) return;
        try {
            await deferred.prompt();
            await deferred.userChoice;
        } catch {
            /* user closed the native sheet — nothing to do */
        }
        setDeferred(null);
    }, [deferred]);

    // Suppressed under e2e/test mode — the install banner/hint is promotional
    // chrome (like the onboarding tour) that would otherwise overlay the
    // viewport (e.g. intercept the bottom-right FAB) and pollute mobile specs.
    // NEXT_PUBLIC_* must be read via process.env for build-time inlining.
    if (process.env.NEXT_PUBLIC_TEST_MODE === '1') return null;

    // Mobile-only; hidden once dismissed/installed.
    if (!isMobile || dismissed) return null;

    if (deferred) {
        return (
            <div
                data-testid="install-banner"
                role="dialog"
                aria-label="Install AgriSaaS"
                className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-40 flex items-center gap-default rounded-lg border border-border-default bg-bg-default p-3 md:hidden"
            >
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content-emphasis">Install AgriSaaS</p>
                    <p className="text-xs text-content-secondary">Add it to your home screen — works in the field, online or off.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={snooze} data-testid="install-dismiss" aria-label="Dismiss install prompt">Not now</Button>
                <Button variant="primary" size="sm" onClick={() => void install()} data-testid="install-accept">Install</Button>
            </div>
        );
    }

    if (iosHint) {
        return (
            <div
                data-testid="ios-install-hint"
                role="dialog"
                aria-label="Add AgriSaaS to your home screen"
                className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-40 flex items-start gap-default rounded-lg border border-border-default bg-bg-default p-3 md:hidden"
            >
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content-emphasis">Add to Home Screen</p>
                    <p className="text-xs text-content-secondary">
                        Tap the Share icon, then “Add to Home Screen” to install AgriSaaS for offline field use.
                    </p>
                </div>
                <Button variant="secondary" size="sm" onClick={snooze} data-testid="install-dismiss" aria-label="Dismiss install hint">Got it</Button>
            </div>
        );
    }

    return null;
}

export default InstallPrompt;
