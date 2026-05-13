/**
 * Structural ratchet: `ControlsClient` adopts `<EntityListPage>`.
 *
 * Locks the invariant that the controls list page sits on the shared
 * shell rather than re-introducing inline `<ListPageShell>` +
 * `<FilterToolbar>` + `<DataTable>` composition. Mirrors the shape of
 * `control-detail-shell-adoption.test.ts` (Prompt 1).
 *
 * Why this exists: a future "tidy-up" PR could quietly inline the shell
 * back out and undo the entity-page-architecture work. This test fails
 * CI on that regression. Same idea as the Epic 52 list-page-shell
 * coverage ratchet — locking a shape, not a value.
 *
 * What it does NOT enforce: the contents of each cell / modal / button.
 * Those are tested by the rendered tests + downstream E2E flows. This
 * file ONLY asserts the *shell-adoption* contract.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONTROLS_CLIENT = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/controls/ControlsClient.tsx',
);

const source = readFileSync(CONTROLS_CLIENT, 'utf8');

describe('ControlsClient — EntityListPage adoption', () => {
    it('imports EntityListPage from the canonical path', () => {
        expect(source).toMatch(
            /import\s*\{\s*EntityListPage\s*\}\s*from\s*['"]@\/components\/layout\/EntityListPage['"];?/,
        );
    });

    it('mounts <EntityListPage<ControlListItem>> at the top level of render', () => {
        expect(source).toContain('<EntityListPage<ControlListItem>');
        expect(source).toContain('</EntityListPage>');
    });

    it('does NOT hand-roll <ListPageShell> directly (shell owns the composition)', () => {
        // The shell wraps ListPageShell internally. A direct import here
        // would mean the page is composing the shell manually again.
        expect(source).not.toMatch(
            /import\s*\{[^}]*\bListPageShell\b[^}]*\}\s*from\s*['"]@\/components\/layout\/ListPageShell['"]/,
        );
    });

    it('does NOT hand-roll <FilterToolbar> directly (shell owns the wiring)', () => {
        // Same reasoning — `filters` prop on EntityListPage is the
        // canonical seam.
        expect(source).not.toMatch(
            /import\s*\{[^}]*\bFilterToolbar\b[^}]*\}\s*from\s*['"]@\/components\/filters\/FilterToolbar['"]/,
        );
    });

    it('threads filters through the shell (defs)', () => {
        // Whitespace-tolerant — the prop literal can wrap across lines.
        // The `searchId` / `searchPlaceholder` props were retired
        // by the FilterToolbar text-search kill sweep (#443) — the
        // sidebar Search pill + global ⌘K palette own textual
        // search now. Only the filter `defs` thread through.
        expect(source).toMatch(/filters\s*=\s*\{\{/);
        expect(source).toContain('defs: liveFilterDefs');
    });

    it('threads the table config through the shell', () => {
        // table prop is required — shell forwards data/columns/etc.
        expect(source).toMatch(/table\s*=\s*\{\{/);
        expect(source).toContain('data: controls');
        expect(source).toContain('columns: controlColumns');
        expect(source).toContain('getRowId: (c) => c.id');
        expect(source).toContain("'data-testid': 'controls-table'");
    });

    it('preserves all four header actions gated by appPermissions.controls.create', () => {
        // Regression guard — the refactor must not silently drop the
        // permission gate or any of the four buttons. Accept both
        // ternary (`? :`) and short-circuit (`&&`) gating styles —
        // both correctly hide the actions when the permission is false.
        expect(source).toMatch(/appPermissions\.controls\.create\s*[?&]/);
        expect(source).toContain('controls-dashboard-btn');
        expect(source).toContain('frameworks-btn');
        expect(source).toContain('install-templates-btn');
        expect(source).toContain('new-control-btn');
    });

    it('preserves the rich domain cell behaviour (status / applicability / quick-edit)', () => {
        // The point of the refactor: keep Inflect's domain richness.
        // These ids are E2E-load-bearing.
        expect(source).toMatch(/status-pill-\$\{c\.id\}/);
        expect(source).toMatch(/applicability-pill-\$\{c\.id\}/);
        expect(source).toMatch(/control-quick-edit-\$\{row\.original\.id\}/);
    });

    it('renders modals + sheet as children (page-state lives next to the page)', () => {
        // Modals/sheets must sit at the page level, not nested into the
        // shell — they own the page's state, not the shell's tree.
        expect(source).toContain('<NewControlModal');
        expect(source).toContain('<ControlDetailSheet');
        // Justification modal stays as a <Modal> child of the page.
        expect(source).toMatch(/<Modal[\s>]/);
    });
});
