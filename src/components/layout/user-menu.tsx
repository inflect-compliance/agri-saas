'use client';

/**
 * Roadmap-14 PR-5 — `<UserMenu>` — right-slot avatar + dropdown.
 *
 * Mounts to the right of every workspace-aware top-bar surface
 * (tenant or org variant). Provides the canonical home for
 * account-scoped verbs:
 *
 *   • Theme toggle (light / dark)
 *   • Sign out
 *
 * Future PRs may extend with Profile, Account settings, Keyboard
 * shortcuts (already exists, triggered by `?` key). PR-5 keeps the
 * menu intentionally small — adding items the user can't reach via
 * a real route would be misleading.
 *
 * The avatar trigger replaces the sidebar's "log-out icon at the
 * bottom" affordance as the global account-actions home; the
 * sidebar's existing identity panel + log-out icon stay in place
 * until R14-PR12 mobile unification, when they're consolidated
 * here.
 *
 * Data: `useSession()` for the display name. Falls back to
 * "Account" when name is unset (legitimate state for unauth-during-
 * hydration; the menu itself never renders unauthed because
 * `<AppShell>` doesn't mount).
 *
 * Visual: 32×32 round avatar with the user's initials over a
 * brand-subtle fill. Hover brightens (motion-language safe). The
 * dropdown opens to `align="end"` so it hugs the right edge of the
 * viewport and never overflows.
 */

import { useCallback, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

import { Popover } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

// ─── Recipe ────────────────────────────────────────────────────────

const AVATAR_BUTTON_CLASS =
    'flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-subtle)] text-[11px] font-semibold text-[var(--brand-emphasis)] transition-[filter] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page';

const MENU_ROW_CLASS =
    'flex w-full cursor-pointer select-none items-center gap-compact rounded-md px-2.5 py-1.5 text-left text-sm text-content-default transition-colors duration-100 ease-out hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

function initialsFromName(name: string | null | undefined): string {
    const cleaned = (name ?? '').trim();
    if (!cleaned) return '·';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
    return (
        parts[0]!.charAt(0).toUpperCase() +
        parts[parts.length - 1]!.charAt(0).toUpperCase()
    );
}

export function UserMenu() {
    const { data: session } = useSession();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    const displayName = session?.user?.name?.trim() ?? 'Account';
    const displayEmail = session?.user?.email ?? null;

    const handleSignOut = useCallback(async () => {
        close();
        await signOut({ callbackUrl: '/login' });
    }, [close]);

    return (
        <Popover
            openPopover={open}
            setOpenPopover={setOpen}
            align="end"
            side="bottom"
            sideOffset={8}
            popoverContentClassName="w-[240px] p-1"
            content={
                <Popover.Menu aria-label="Account menu">
                    {/* Identity header — name + email at the top.
                        Quiet typography so the eye reads the
                        actionable items below, not the header. */}
                    <div className="px-2.5 pt-1.5 pb-2">
                        <p
                            className="truncate text-sm font-medium text-content-emphasis"
                            data-testid="user-menu-display-name"
                        >
                            {displayName}
                        </p>
                        {displayEmail && (
                            <p
                                className="truncate text-xs text-content-muted"
                                data-testid="user-menu-display-email"
                            >
                                {displayEmail}
                            </p>
                        )}
                    </div>

                    <Popover.Separator />

                    {/* Theme toggle. Mounted INSIDE the menu so the
                        sidebar can retire its own toggle in
                        R14-PR12. ThemeToggle handles its own
                        keyboard story + persists to localStorage. */}
                    <div
                        className="px-2.5 py-1.5 flex items-center justify-between text-sm text-content-default"
                        data-testid="user-menu-theme-row"
                    >
                        <span>Theme</span>
                        <ThemeToggle id="user-menu-theme-toggle" />
                    </div>

                    <Popover.Separator />

                    {/* Sign out — the destructive action at the
                        end of the menu, separated from the
                        non-destructive items above. */}
                    <button
                        type="button"
                        onClick={handleSignOut}
                        role="menuitem"
                        data-testid="user-menu-sign-out"
                        className={MENU_ROW_CLASS}
                    >
                        <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span>Sign out</span>
                    </button>
                </Popover.Menu>
            }
        >
            <button
                type="button"
                className={AVATAR_BUTTON_CLASS}
                aria-label={`Account menu for ${displayName}`}
                aria-expanded={open}
                aria-haspopup="menu"
                data-testid="top-chrome-user-menu"
            >
                <span aria-hidden="true">{initialsFromName(displayName)}</span>
            </button>
        </Popover>
    );
}
