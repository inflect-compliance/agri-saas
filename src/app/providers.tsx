'use client';

// Side effect — disable Zod's eval-based JIT before any schema parses,
// so the strict CSP doesn't report Zod's `new Function` probe. Keep at
// the top of the client entry. See src/lib/zod-jitless.ts.
import '@/lib/zod-jitless';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
    CommandPalette,
    CommandPaletteProvider,
} from '@/components/command-palette';
import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';
import { ShortcutHelpOverlay } from '@/components/app-shell/shortcut-help-overlay';
import { registerFormTelemetrySink } from '@/lib/telemetry/form-telemetry';
import { SWRPersistenceProvider } from '@/components/providers/SWRPersistenceProvider';

/**
 * Epic 54 — bootstrap the global form-telemetry sink once at mount.
 *
 * The sink is intentionally a no-op in open-source mode: a real
 * observability stack (Sentry breadcrumb + PostHog track) can swap in
 * a richer handler from `src/lib/observability/` without touching any
 * modal call site. For local / Playwright visibility of form events,
 * developers set `window.__INFLECT_FORM_TELEMETRY__` from DevTools or
 * a test setup — the hook honours it independent of the sink
 * registered here.
 *
 * We DO register the no-op explicitly (rather than leaving the sink
 * unset) so the hook's `registered === true` check is satisfied and
 * future migrations of the sink don't have to re-discover whether
 * `Providers` already initialised it.
 */
function useFormTelemetryBootstrap() {
    useEffect(() => {
        registerFormTelemetrySink(() => {
            /* wired by the observability layer */
        });
    }, []);
}

function FormTelemetrySink() {
    useFormTelemetryBootstrap();
    return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
    // No <SessionProvider>. The tenant layout resolves the session
    // server-side via `auth()`, nothing calls `useSession`, and
    // `signIn`/`signOut` work without the provider. Mounting it would
    // trigger a client-side `/api/auth/session` fetch on every page
    // load that frequently aborts when tests/users navigate away,
    // producing "Failed to fetch" noise in the console.
    // Epic 57 — `KeyboardShortcutProvider` owns the single window
    // keydown listener that routes every registered shortcut. It wraps
    // the theme + tooltip providers so shortcuts can reach into the
    // tree without every page re-mounting its own listener.
    // Epic 57 — `CommandPaletteProvider` sits INSIDE the shortcut
    // provider so it can register `mod+k` on the shared registry. The
    // palette itself is rendered once at the shell so it's reachable
    // from any route, layered above page content via its own portal.
    // Roadmap-6 P3 — `SWRPersistenceProvider` sits at the top so EVERY
    // client read (all `useTenantSWR` / `useSWR` call sites) shares the
    // one per-tenant, disk-backed SWR cache. A PWA relaunch then paints
    // lists from the on-device cache instead of refetching the whole
    // farm over rural LTE.
    return (
        <SWRPersistenceProvider>
        <KeyboardShortcutProvider>
            <CommandPaletteProvider>
                <ThemeProvider>
                    <TooltipProvider>
                        <FormTelemetrySink />
                        {children}
                        <CommandPalette />
                        {/*
                         * Epic 57 — `?` pops a live listing of every
                         * registered shortcut. Mounted once at the shell so
                         * the registry is the single source of truth and
                         * shortcuts registered deeper in the tree appear
                         * automatically.
                         */}
                        <ShortcutHelpOverlay />
                        {/*
                         * Global toast host. CopyButton / CopyText and the
                         * optimistic-update hook emit into this Toaster;
                         * without it, every `toast()` call is a silent no-op.
                         */}
                        <Toaster
                            theme="dark"
                            position="top-right"
                            richColors
                            closeButton
                            duration={3000}
                        />
                    </TooltipProvider>
                </ThemeProvider>
            </CommandPaletteProvider>
        </KeyboardShortcutProvider>
        </SWRPersistenceProvider>
    );
}
