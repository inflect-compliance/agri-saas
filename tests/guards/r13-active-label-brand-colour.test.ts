/**
 * Roadmap-13 PR-5 — Active label takes brand colour.
 *
 * The user spec called it directly: "on click the letters of the
 * clicked button should change color — yellow for example for the
 * dark theme and orange for the light." This is the WHAT-page
 * signal that pairs with PR-4's WHERE-page signal (cool navy band).
 *
 * Until R13-PR5 the active row's label was `text-content-emphasis`
 * — one rung brighter than the muted default. Honest, but quiet:
 * a user glancing at the sidebar from the desk's edge can't tell
 * the active row from any other emphasised text. R13-PR5 paints the
 * letters in `var(--brand-default)`:
 *
 *   METRO (dark theme, yellow brand) → active label is YELLOW
 *   PwC   (light theme, orange brand) → active label is ORANGE
 *
 * Both themes' brand-default reads at WCAG AA over the active row's
 * brand-subtle wash:
 *
 *   METRO  `#FFCD11` on (deep navy + 18% yellow wash) → >10:1
 *   PwC    `#D04A02` on (cream + 9% orange wash)      → ~5.5:1
 *
 * The R12-PR6 ratchet was updated in the same diff to assert the
 * new vocabulary (`text-[var(--brand-default)]` instead of
 * `text-content-emphasis`). That's deliberate — R12-PR6 was the
 * lock at its time; R13-PR5 is the evolution. The R12-PR6 ratchet
 * still locks the FOUR-token shape of the active state, just with
 * one slot's vocabulary updated.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact hex values of the brand tokens. Future palette
 *     tuning is allowed within the brand-default contract.
 *   - The hover state's label colour. Hover stays `text-content-
 *     emphasis` — the two-tone vocabulary is "muted → emphasis
 *     on hover, emphasis → brand on active."
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);

function activeRecipe(): string {
    const m = NAV_ITEM_SRC.match(
        /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
    );
    expect(m).not.toBeNull();
    return m![1];
}

function defaultRecipe(): string {
    const m = NAV_ITEM_SRC.match(
        /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
    );
    expect(m).not.toBeNull();
    return m![1];
}

describe('Roadmap-13 PR-5 — active label takes brand colour', () => {
    describe('active recipe paints letters in --brand-default', () => {
        it('NAV_ITEM_ACTIVE includes `text-[var(--brand-default)]`', () => {
            // The canonical R13-PR5 wiring. Yellow on METRO (the
            // dark theme), orange on PwC (the light theme) — both
            // because `--brand-default` resolves per theme.
            expect(activeRecipe()).toMatch(
                /\btext-\[var\(--brand-default\)\]/,
            );
        });

        it('NAV_ITEM_ACTIVE does NOT carry the old text-content-emphasis', () => {
            // The R12-PR6 colour vocabulary is explicitly retired
            // on the active row. A regression that puts BOTH
            // `text-content-emphasis` and `text-[var(--brand-default)]`
            // on the row would produce undefined (last-class-wins)
            // behaviour — Tailwind's same-specificity siblings
            // resolve by emitted-CSS source order, not className
            // order.
            expect(activeRecipe()).not.toMatch(/\btext-content-emphasis\b/);
        });

        it('the brand-default text does NOT reach for brand-emphasis', () => {
            // `--brand-emphasis` is the "primary button" deepened
            // tier — used for solid actionable surfaces, not for
            // text colour. A regression to `text-[var(--brand-
            // emphasis)]` would also fail WCAG on PwC's light
            // theme (the emphasis orange is darker → would be
            // OK; the contrast is fine but the semantic role is
            // wrong). The discipline is: text uses brand-DEFAULT,
            // surfaces use brand-EMPHASIS.
            expect(activeRecipe()).not.toMatch(
                /\btext-\[var\(--brand-emphasis\)\]/,
            );
        });
    });

    describe('hover label stays content-emphasis (no brand leak)', () => {
        it('NAV_ITEM_DEFAULT still wakes the label to content-emphasis', () => {
            // Hover wakes the muted label one rung to
            // `text-content-emphasis`. Active jumps further to
            // brand-coloured. If hover ALSO went brand-coloured,
            // the active row would lose its distinction.
            expect(defaultRecipe()).toMatch(
                /\bhover:text-content-emphasis\b/,
            );
        });

        it('NAV_ITEM_DEFAULT does NOT reach for any brand text colour', () => {
            // No `text-[var(--brand-default)]` or `text-[var(--brand-
            // emphasis)]` or `text-[var(--brand-muted)]` on hover.
            // The brand-text vocabulary is exclusively the ACTIVE
            // signal.
            const recipe = defaultRecipe();
            expect(recipe).not.toMatch(
                /\btext-\[var\(--brand-default\)\]/,
            );
            expect(recipe).not.toMatch(
                /\btext-\[var\(--brand-emphasis\)\]/,
            );
            expect(recipe).not.toMatch(
                /\btext-\[var\(--brand-muted\)\]/,
            );
        });
    });

    describe('preserved R12-PR6 conviction tokens', () => {
        it('active still carries a brand wash + opacity-100 band + font-medium', () => {
            // R13-PR5 only replaces ONE conviction token (the text
            // colour). The other three stay — a brand wash (form
            // evolved by R13-PR11 to a radial gradient from
            // brand-secondary-subtle), permanent band, +1 font
            // weight.
            const recipe = activeRecipe();
            const r12Wash = /\bbg-\[var\(--brand-subtle\)\]/.test(recipe);
            const r13Wash =
                /bg-\[radial-gradient\(/.test(recipe) &&
                /var\(--brand(-secondary)?-subtle\)/.test(recipe);
            expect(r12Wash || r13Wash).toBe(true);
            expect(recipe).toMatch(/(?<!hover:)\bbefore:opacity-100\b/);
            expect(recipe).toMatch(/\bfont-medium\b/);
        });
    });

    describe('contrast contract documented in doc-comment', () => {
        it('the NAV_ITEM_ACTIVE doc-comment cites WCAG AA on both themes', () => {
            // The "why this colour works on both themes" reasoning
            // MUST live next to the recipe so a future PR has to
            // argue against it. The doc-comment also documents the
            // expected contrast ratios — a regression to a darker /
            // lighter token would fail the documented contract.
            const activeBlock =
                NAV_ITEM_SRC.match(
                    /\/\*\*[\s\S]*?Active state[\s\S]*?\*\/\s*export\s+const\s+NAV_ITEM_ACTIVE/,
                )?.[0] ?? '';
            expect(activeBlock).toMatch(/WCAG\s*AA/i);
            expect(activeBlock).toMatch(/METRO/);
            expect(activeBlock).toMatch(/PwC/);
        });
    });
});
