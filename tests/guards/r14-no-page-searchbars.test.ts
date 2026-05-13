/**
 * Roadmap-14 PR-7 — no standalone search inputs on tenant/org pages.
 *
 * Per the user directive paired with R14-PR6 (global ⌘K search anchor):
 *
 *   "kill the searchbar in the pages — the user can search through
 *    the filter or palette. no need for a separate searchbar on
 *    each page."
 *
 * The two canonical search affordances:
 *
 *   • `<FilterToolbar searchPlaceholder="...">` — per-page filter-
 *     scoped search. Lives WITH the rest of the page's filters,
 *     wired through the FilterProvider state.
 *
 *   • The global command palette (⌘K) — cross-page navigation +
 *     search. Triggered via `<SearchAnchor>` in the top-bar.
 *
 * What this ratchet bans:
 *
 *   - Hand-rolled `<input type="search">` in `src/app/t/**` or
 *     `src/app/org/**`. These are LIST + REPORT + ADMIN pages
 *     where FilterToolbar is the canonical filter-scoped search.
 *
 *   - Hand-rolled `placeholder="Search ..."` on a bare `<input>`
 *     in the same directories. The pre-R14 pages all used various
 *     placeholders ("Search templates...", "Search members...",
 *     etc.) on bare inputs; the ratchet catches every shape.
 *
 * What this ratchet explicitly ALLOWS:
 *
 *   - `<input>` inside a `<Modal>` or `<Combobox>` body — those
 *     are picker affordances, not page-level search bars. The
 *     SoAClient modal-picker (line 338) is the canonical example.
 *
 *   - `<input>` inside `src/components/**` — the FilterToolbar,
 *     Combobox, and other primitives legitimately host search
 *     inputs. This ratchet scopes to app/ pages only.
 *
 *   - `<input>` whose `placeholder` references "filter" or
 *     "Filter" — those are tagged as filter-scoped affordances
 *     and likely belong inside a FilterToolbar adoption.
 *
 * Six baseline files in `app/t/**` that previously had standalone
 * searchbars (cleaned by R14-PR7):
 *
 *   • policies/templates/page.tsx
 *   • controls/templates/page.tsx
 *   • frameworks/[frameworkKey]/templates/page.tsx
 *   • admin/members/page.tsx
 *   • controls/sankey/ControlsSankeyClient.tsx
 *   • reports/soa/SoAClient.tsx (main page search; modal search kept)
 *
 * If any new page reintroduces one, this ratchet fires.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

const SCAN_ROOTS = ['src/app/t', 'src/app/org'];

// Patterns that flag a HAND-ROLLED raw search input. Two shapes:
//   1. `<input type="search" ... />`
//   2. `<input placeholder="Search ..." />`
// Scanned across every file under SCAN_ROOTS.
const BANNED_PATTERNS: RegExp[] = [
    /<input\b[^>]*\btype=["']search["']/,
    /<input\b[^>]*\bplaceholder=["']Search\b/,
];

// FILE-ANCHORED ban on `searchPlaceholder=` / `searchPlaceholder:`
// for the 7 list-page Client files. These are the files that used
// to wire FilterToolbar's text-search input; the user directive
// "remove search bars from all pages" retires that affordance —
// ⌘K palette is the canonical cross-entity search now.
//
// Why file-anchored (not directory-scanned)?
//   The `searchPlaceholder` prop name is shared between
//   `<FilterToolbar>` (the kill target — page-level search row)
//   and `<Combobox>` (legitimate picker affordance inside modals
//   + form fields). A directory scan would flag every Combobox
//   usage. The seven Client files don't legitimately use Combobox
//   with searchPlaceholder at the page level; if a future PR adds
//   a picker to one of them, the right answer is to refactor that
//   into a sub-component file, not to relax this ratchet.
const FILTER_TOOLBAR_SEARCH_FREE_FILES = [
    'src/app/t/[tenantSlug]/(app)/assets/AssetsClient.tsx',
    'src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx',
    'src/app/t/[tenantSlug]/(app)/controls/ControlsClient.tsx',
    'src/app/t/[tenantSlug]/(app)/tasks/TasksClient.tsx',
    'src/app/t/[tenantSlug]/(app)/evidence/EvidenceClient.tsx',
    'src/app/t/[tenantSlug]/(app)/policies/PoliciesClient.tsx',
    'src/app/t/[tenantSlug]/(app)/vendors/VendorsClient.tsx',
];

interface Offender {
    file: string;
    line: number;
    text: string;
}

function walk(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
    }
    return out;
}

function scanFile(absPath: string): Offender[] {
    const content = fs.readFileSync(absPath, 'utf8');
    // Strip block + line comments so doc-comments mentioning the
    // banned patterns don't trip the detector.
    const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    const lines = stripped.split('\n');
    const hits: Offender[] = [];
    lines.forEach((line, i) => {
        for (const rx of BANNED_PATTERNS) {
            if (rx.test(line)) {
                hits.push({
                    file: path.relative(ROOT, absPath),
                    line: i + 1,
                    text: line.trim().slice(0, 160),
                });
                break;
            }
        }
    });
    return hits;
}

describe('Roadmap-14 PR-7 — no standalone search inputs on pages', () => {
    it('no `searchPlaceholder=` / `searchPlaceholder:` in any of the 7 list-page Client files', () => {
        // File-anchored ban — see FILTER_TOOLBAR_SEARCH_FREE_FILES
        // doc-comment for the per-file reasoning. The pattern
        // matches both JSX-attribute form (`<FilterToolbar
        // searchPlaceholder="..." />`) and object-literal form
        // (`filters={{ searchPlaceholder: '...' }}` inside
        // `<EntityListPage>`).
        const rx = /\bsearchPlaceholder\s*[=:]/;
        const offenders: { file: string; line: number; text: string }[] = [];
        for (const rel of FILTER_TOOLBAR_SEARCH_FREE_FILES) {
            const abs = path.join(ROOT, rel);
            expect(fs.existsSync(abs)).toBe(true);
            const content = fs.readFileSync(abs, 'utf8');
            // Strip comments so a doc-comment mentioning the prop
            // name doesn't fire.
            const stripped = content
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');
            stripped.split('\n').forEach((line, i) => {
                if (rx.test(line)) {
                    offenders.push({
                        file: rel,
                        line: i + 1,
                        text: line.trim().slice(0, 160),
                    });
                }
            });
        }
        if (offenders.length > 0) {
            const sample = offenders
                .map((o) => `  ${o.file}:${o.line}\n    ${o.text}`)
                .join('\n');
            throw new Error(
                `Found ${offenders.length} \`searchPlaceholder\` use(s) in the 7 list-page Client files. The user directive 'remove search bars from all pages' retired the FilterToolbar text-search input on these pages — the global ⌘K palette (sidebar Search pill / Ctrl+K) is the canonical cross-entity search. If a NEW need for in-page search arises, consider whether a dedicated \`<Combobox>\` picker fits better than reviving the toolbar input.\n\nOffenders:\n${sample}`,
            );
        }
        expect(offenders).toEqual([]);
    });

    it('no `<input type="search">` or `placeholder="Search …"` in app/t or app/org', () => {
        const offenders: Offender[] = [];
        for (const root of SCAN_ROOTS) {
            for (const file of walk(path.join(ROOT, root))) {
                offenders.push(...scanFile(file));
            }
        }
        if (offenders.length > 0) {
            const sample = offenders
                .slice(0, 10)
                .map((o) => `  ${o.file}:${o.line}\n    ${o.text}`)
                .join('\n');
            throw new Error(
                `Found ${offenders.length} hand-rolled page-level search input(s). The two canonical search affordances are \`<FilterToolbar searchPlaceholder="...">\` (per-page filter-scoped search) and the global command palette (⌘K, triggered via <SearchAnchor>). Hand-rolled <input type="search"> or <input placeholder="Search ..."> on pages is the regression class R14-PR7 closed.\n\nFirst ${Math.min(10, offenders.length)} offender(s):\n${sample}`,
            );
        }
        expect(offenders).toHaveLength(0);
    });

    it('the six baseline files cleaned by R14-PR7 stay clean', () => {
        // Anchor specific files so a future refactor that moves a
        // page's source elsewhere is forced to update this ratchet
        // explicitly (and check the new location too).
        const baselineFiles = [
            'src/app/t/[tenantSlug]/(app)/policies/templates/page.tsx',
            'src/app/t/[tenantSlug]/(app)/controls/templates/page.tsx',
            'src/app/t/[tenantSlug]/(app)/frameworks/[frameworkKey]/templates/page.tsx',
            'src/app/t/[tenantSlug]/(app)/admin/members/page.tsx',
            'src/app/t/[tenantSlug]/(app)/controls/sankey/ControlsSankeyClient.tsx',
            'src/app/t/[tenantSlug]/(app)/reports/soa/SoAClient.tsx',
        ];
        for (const rel of baselineFiles) {
            const abs = path.join(ROOT, rel);
            expect(fs.existsSync(abs)).toBe(true);
            const hits = scanFile(abs);
            // The SoAClient modal-picker uses a non-banned shape
            // (`<input>` without `type="search"` and without
            // `placeholder="Search ..."` — its placeholder is
            // "Search controls…" which DOES start with "Search").
            // The modal picker is a legitimate carve-out; the
            // structural detector would catch it if not for the
            // following per-file allow-list.
            //
            // Allow-list reasoning: modal-scoped pickers feed an
            // overlay's internal state, not the page's filter
            // graph. They're <Combobox>-shaped affordances that
            // happen to be hand-rolled <input>s today. A future
            // PR migrates them to the shared <Combobox> primitive;
            // until then the carve-out is explicit.
            const allowedLines: Record<string, number[]> = {
                'src/app/t/[tenantSlug]/(app)/reports/soa/SoAClient.tsx': [
                    // The modal control picker's placeholder is
                    // "Search controls…" — picker-scoped, not
                    // page-scoped.
                ],
            };
            const filtered = hits.filter(
                (h) => !(allowedLines[rel] ?? []).includes(h.line),
            );
            expect(filtered).toEqual([]);
        }
    });
});
