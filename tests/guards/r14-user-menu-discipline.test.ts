/**
 * Roadmap-14 PR-5 — `<UserMenu>` discipline.
 *
 * The right-slot avatar + dropdown that owns account-scoped verbs.
 * Mounts after the workspace switcher in the top-bar right slot.
 *
 * PR-5 ships a deliberately small menu — three regions:
 *
 *   • Identity header — name + email at the top (quiet typography
 *     so the eye reads actionable items, not the header).
 *
 *   • Theme toggle row — mounted inside the menu so the sidebar
 *     can retire its own toggle in R14-PR12. The shared
 *     `<ThemeToggle>` primitive handles its own keyboard story
 *     and persists to localStorage.
 *
 *   • Sign out — the destructive action, separated by a
 *     `Popover.Separator` from the non-destructive items above.
 *
 * Items the menu does NOT include (and the reasoning):
 *
 *   • Profile / Account settings — no `/profile` or `/account`
 *     route exists today. Adding items the user can't reach via a
 *     real route would be misleading.
 *
 *   • Keyboard shortcuts — already triggered by the `?` key
 *     (registered via `useKeyboardShortcut`), with the help
 *     overlay rendered globally by `<ShortcutHelpOverlay>` in
 *     `app/providers.tsx`. No need for a duplicate path here.
 *
 * Future PRs may extend if those routes land. The ratchet locks
 * the three sections currently shipped + the absent-misleading
 * regression class.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const USER_MENU_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/user-menu.tsx'),
    'utf8',
);
const TOP_CHROME_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/TopChrome.tsx'),
    'utf8',
);

describe('Roadmap-14 PR-5 — UserMenu discipline', () => {
    describe('component', () => {
        it('exports `UserMenu` as a named export', () => {
            expect(USER_MENU_SRC).toMatch(
                /export\s+function\s+UserMenu\b/,
            );
        });

        it('reads display name + email from `useSession()`', () => {
            // Same data source as the rest of the chrome (header,
            // tenant switcher). useSession() is the canonical
            // client-side accessor.
            expect(USER_MENU_SRC).toMatch(
                /import\s+\{[^}]*\buseSession\b[^}]*\}\s+from\s+['"]next-auth\/react['"]/,
            );
            expect(USER_MENU_SRC).toMatch(/session\?\.user\?\.name/);
            expect(USER_MENU_SRC).toMatch(/session\?\.user\?\.email/);
        });

        it('falls back to "Account" when name is missing', () => {
            // Defence in depth — the menu must never render
            // empty-string or "undefined" as the display name.
            // Legitimate state during hydration; the fallback is
            // the visible safety net.
            expect(USER_MENU_SRC).toMatch(
                /session\?\.user\?\.name\?\.trim\(\)\s*\?\?\s*['"]Account['"]/,
            );
        });
    });

    describe('avatar trigger', () => {
        it('is a `<button type="button">` with full ARIA popover attrs', () => {
            // Canonical popover trigger semantics. aria-haspopup +
            // aria-expanded are how assistive tech knows what the
            // button does.
            expect(USER_MENU_SRC).toMatch(
                /<button[\s\S]+?type="button"/,
            );
            expect(USER_MENU_SRC).toMatch(/aria-haspopup="menu"/);
            expect(USER_MENU_SRC).toMatch(/aria-expanded=\{open\}/);
        });

        it('carries `data-testid="top-chrome-user-menu"`', () => {
            expect(USER_MENU_SRC).toMatch(
                /data-testid="top-chrome-user-menu"/,
            );
        });

        it('renders 32×32 round avatar with initials (aria-hidden)', () => {
            // The visible avatar is decorative — the aria-label on
            // the trigger button is the accessible name.
            expect(USER_MENU_SRC).toMatch(/h-8\s+w-8/);
            expect(USER_MENU_SRC).toMatch(/rounded-full/);
            expect(USER_MENU_SRC).toMatch(
                /<span\s+aria-hidden="true">\{initialsFromName\(displayName\)\}<\/span>/,
            );
        });

        it('hover uses `brightness-110` (motion-language safe)', () => {
            // No transform / scale / shadow on the avatar trigger.
            // Filter is not in the motion-language ban list.
            expect(USER_MENU_SRC).toMatch(/hover:brightness-110/);
            expect(USER_MENU_SRC).not.toMatch(/hover:scale-/);
            expect(USER_MENU_SRC).not.toMatch(/hover:translate-/);
            expect(USER_MENU_SRC).not.toMatch(/hover:shadow-/);
        });
    });

    describe('menu contents', () => {
        it('renders the identity header (name + optional email)', () => {
            expect(USER_MENU_SRC).toMatch(
                /data-testid="user-menu-display-name"/,
            );
            expect(USER_MENU_SRC).toMatch(
                /data-testid="user-menu-display-email"/,
            );
            // Email row is conditional — only renders when email
            // is present. A regression that drops the conditional
            // would render an empty <p> on accounts without email.
            expect(USER_MENU_SRC).toMatch(
                /\{displayEmail\s*&&\s*\(/,
            );
        });

        it('mounts the shared `<ThemeToggle>` primitive', () => {
            // The menu does NOT re-implement a theme toggle — it
            // mounts the shared one. A regression that hand-rolls
            // a toggle here would lose the localStorage
            // persistence + keyboard story the primitive owns.
            expect(USER_MENU_SRC).toMatch(
                /import\s+\{\s*ThemeToggle\s*\}\s+from\s+['"]@\/components\/theme\/ThemeToggle['"]/,
            );
            expect(USER_MENU_SRC).toMatch(/<ThemeToggle\b/);
            expect(USER_MENU_SRC).toMatch(
                /data-testid="user-menu-theme-row"/,
            );
        });

        it('renders the Sign out action at the bottom of the menu', () => {
            expect(USER_MENU_SRC).toMatch(
                /data-testid="user-menu-sign-out"/,
            );
            // Destructive action — must use signOut from
            // next-auth/react with `callbackUrl: '/login'`.
            expect(USER_MENU_SRC).toMatch(
                /import\s+\{[^}]*\bsignOut\b[^}]*\}\s+from\s+['"]next-auth\/react['"]/,
            );
            expect(USER_MENU_SRC).toMatch(
                /signOut\(\s*\{\s*callbackUrl:\s*['"]\/login['"]/,
            );
        });

        it('separates the three regions with `Popover.Separator`', () => {
            // Visual separation: identity header | theme row | sign-out.
            // Both separators are required — collapsing them would
            // run the destructive action visually flush with the
            // theme toggle.
            const separatorCount = (
                USER_MENU_SRC.match(/<Popover\.Separator\b/g) ?? []
            ).length;
            expect(separatorCount).toBeGreaterThanOrEqual(2);
        });
    });

    describe('what the menu does NOT include (anti-misleading invariants)', () => {
        // Strip comments before scanning — the doc-comment mentions
        // these items by name when explaining why they're absent.
        const stripped = USER_MENU_SRC
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');

        it('no Profile menu item (no `/profile` route exists)', () => {
            expect(stripped).not.toMatch(/href=['"]\/profile['"]/);
        });

        it('no Account-settings menu item (no `/account` route exists)', () => {
            expect(stripped).not.toMatch(/href=['"]\/account['"]/);
            expect(stripped).not.toMatch(
                /href=['"]\/settings['"]/,
            );
        });
    });

    describe('TopChrome wiring', () => {
        it('imports UserMenu from `./user-menu`', () => {
            expect(TOP_CHROME_SRC).toMatch(
                /import\s+\{\s*UserMenu\s*\}\s+from\s+['"]\.\/user-menu['"]/,
            );
        });

        it('mounts UserMenu in the right slot AFTER the identity affordance', () => {
            // The slot order matters — switcher first (workspace
            // context), user menu second (account scope). A
            // regression that swaps them would put the account
            // menu before the workspace, which feels wrong
            // (workspace is the broader scope).
            expect(TOP_CHROME_SRC).toMatch(
                /<Identity\s*\/>\s*\n\s*<UserMenu\s*\/>/,
            );
        });
    });
});
