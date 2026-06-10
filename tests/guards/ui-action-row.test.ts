/**
 * UI roadmap 22 + 23 ratchet — table selection action row.
 *
 * 22 — the Tasks bulk "Assign" action uses a real people-picker (UserCombobox),
 *      not a raw "User ID" text input, and the optimistic update shows the
 *      picked name (not the raw user id).
 * 23 — the selection toolbar carries a thin brand-coloured lower border
 *      (`--brand-default`: orange light / yellow dark).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('UI-22 — Tasks bulk Assign uses a people-picker', () => {
    const src = read('src/app/t/[tenantSlug]/(app)/tasks/TasksClient.tsx');
    it('renders <UserCombobox> for the assign action (no raw User ID input)', () => {
        expect(src).toMatch(/bulkAction === 'assign'[\s\S]{0,200}<UserCombobox/);
        expect(src).not.toMatch(/placeholder="User ID \(blank = unassign\)"/);
    });
    it('optimistic assignee uses the picked label, not the raw user id', () => {
        expect(src).toMatch(/assignee: value \? \{ name: label \|\| value \}/);
    });
});

describe('UI-23 — selection toolbar has a brand lower border', () => {
    it('selection-toolbar bottom border is brand-coloured', () => {
        const src = read('src/components/ui/table/selection-toolbar.tsx');
        expect(src).toMatch(/border-b border-\[var\(--brand-default\)\]/);
    });
});
