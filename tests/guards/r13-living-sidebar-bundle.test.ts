/**
 * Roadmap-13 PR-12 — Living Sidebar capstone bundle ratchet.
 *
 * The eleven preceding R13 PRs each shipped one slice of the
 * sidebar's evolution + one structural guard. This capstone walks
 * EVERY load-bearing invariant in a single report — when this
 * ratchet stays green, the entire R13 vocabulary is intact.
 *
 * The bundle is intentionally exhaustive — it touches:
 *
 *   PR-1   Navy secondary-brand tokens (both themes, three tiers)
 *   PR-2   3-stop gradient + soft glow
 *   PR-3   Shimmer animation (4s ease-in-out, gated hover + active)
 *   PR-4   Active band swaps to secondary brand
 *   PR-5   Active label takes brand colour
 *   PR-6   Glossy top-edge highlight (::after)
 *   PR-7   Inset bevel shadow on hover
 *   PR-8   Press feedback (active:translate-y-px) + motion exempt
 *   PR-9   Band reaches toward cursor (top/bottom/width animation)
 *   PR-10  Section divider as soft gradient
 *   PR-11  Radial brand wash on active row
 *
 * Each section here is one PR's invariants pulled into a single
 * sweep. The "full picture" failure mode this catches: a refactor
 * that accidentally drops one R13 piece while updating another
 * — the slice-level ratchet for the touched PR stays green, but
 * the dropped slice's ratchet fires here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);
const NAV_SECTION_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-section.tsx'),
    'utf8',
);
const TOKENS_SRC = fs.readFileSync(
    path.join(ROOT, 'src/styles/tokens.css'),
    'utf8',
);
const TAILWIND_CONFIG = fs.readFileSync(
    path.join(ROOT, 'tailwind.config.js'),
    'utf8',
);
const MOTION_GUARD_SRC = fs.readFileSync(
    path.join(ROOT, 'tests/guards/motion-language-discipline.test.ts'),
    'utf8',
);

const DARK_BLOCK = TOKENS_SRC.match(/:root\s*\{[\s\S]*?\n\}/)![0];
const LIGHT_BLOCK = TOKENS_SRC.match(
    /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/,
)![0];

const activeRecipe =
    NAV_ITEM_SRC.match(
        /export\s+const\s+NAV_ITEM_ACTIVE\s*=\s*['"]([^'"]+)['"]/,
    )?.[1] ?? '';
const defaultRecipe =
    NAV_ITEM_SRC.match(
        /export\s+const\s+NAV_ITEM_DEFAULT\s*=\s*['"]([^'"]+)['"]/,
    )?.[1] ?? '';
const baseRegion =
    NAV_ITEM_SRC.match(
        /export\s+const\s+NAV_ITEM_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
    )?.[0] ?? '';
const bandBaseRegion =
    NAV_ITEM_SRC.match(
        /const\s+NAV_ITEM_BAND_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
    )?.[0] ?? '';
const glossBaseRegion =
    NAV_ITEM_SRC.match(
        /const\s+NAV_ITEM_GLOSS_BASE\s*=\s*\[[\s\S]+?\]\.join\(/,
    )?.[0] ?? '';
const sectionDividerRecipe =
    NAV_SECTION_SRC.match(
        /export\s+const\s+NAV_SECTION_DIVIDER\s*=\s*['"]([^'"]+)['"]/,
    )?.[1] ?? '';

describe('Roadmap-13 PR-12 — Living Sidebar capstone bundle', () => {
    describe('PR-1 — secondary-brand token foundation', () => {
        it('METRO declares the three secondary tiers', () => {
            expect(DARK_BLOCK).toMatch(/--brand-secondary-default:\s*#3B82F6/i);
            expect(DARK_BLOCK).toMatch(/--brand-secondary-emphasis:\s*#2563EB/i);
            expect(DARK_BLOCK).toMatch(/--brand-secondary-subtle:/);
        });
        it('PwC declares the three secondary tiers', () => {
            expect(LIGHT_BLOCK).toMatch(/--brand-secondary-default:\s*#1E3A8A/i);
            expect(LIGHT_BLOCK).toMatch(/--brand-secondary-emphasis:\s*#172554/i);
            expect(LIGHT_BLOCK).toMatch(/--brand-secondary-subtle:/);
        });
    });

    describe('PR-2 — 3-stop gradient + soft glow', () => {
        it('band gradient: default → muted → emphasis (utility OR R15-PR1 arbitrary form)', () => {
            // R15-PR1 switched the gradient from Tailwind utility
            // classes (`before:from-...`, `before:via-...`,
            // `before:to-...`) to a single comprehensive
            // `before:bg-[...]` arbitrary value so the stardust
            // particle layers could be stacked on top. Both forms
            // preserve the three brand stops in order — accept
            // either here.
            const utilityForm =
                /before:from-\[var\(--brand-default\)\]/.test(bandBaseRegion) &&
                /before:via-\[var\(--brand-muted\)\]/.test(bandBaseRegion) &&
                /before:to-\[var\(--brand-emphasis\)\]/.test(bandBaseRegion);
            const arbitraryForm =
                /linear-gradient\(to_bottom,/.test(bandBaseRegion) &&
                /var\(--brand-default\)/.test(bandBaseRegion) &&
                /var\(--brand-muted\)/.test(bandBaseRegion) &&
                /var\(--brand-emphasis\)/.test(bandBaseRegion);
            expect(utilityForm || arbitraryForm).toBe(true);
        });
        it('band glow wired via --nav-band-glow', () => {
            expect(bandBaseRegion).toMatch(
                /before:shadow-\[var\(--nav-band-glow\)\]/,
            );
            expect(DARK_BLOCK).toMatch(/--nav-band-glow:/);
            expect(LIGHT_BLOCK).toMatch(/--nav-band-glow:/);
        });
    });

    describe('PR-3 — shimmer animation', () => {
        it('keyframe + animation utility declared in tailwind config', () => {
            expect(TAILWIND_CONFIG).toMatch(/'nav-band-shimmer':\s*\{/);
            expect(TAILWIND_CONFIG).toMatch(
                /'nav-band-shimmer':\s*'nav-band-shimmer\s+4s\s+ease-in-out\s+infinite'/,
            );
        });
        it('background-size 100% 200% in band base; shimmer gated hover + active (single-track OR R15-PR2 alive-composed)', () => {
            // R15-PR2 broadened the band's animation utility from
            // `nav-band-shimmer` (single-track) to `nav-band-alive`
            // (composed: shimmer + halo-breath). The `nav-band-alive`
            // entry in tailwind.config.js embeds `nav-band-shimmer
            // 4s ease-in-out infinite` as its first track, so the
            // R13-PR3 visual contract holds either way. Accept both
            // utility names here.
            expect(bandBaseRegion).toMatch(
                /before:\[background-size:100%_200%\]/,
            );
            const defaultShimmer =
                /hover:before:animate-nav-band-shimmer\b/.test(defaultRecipe);
            const defaultAlive = /hover:before:animate-nav-band-alive\b/.test(
                defaultRecipe,
            );
            expect(defaultShimmer || defaultAlive).toBe(true);
            const activeShimmer =
                /(?<!hover:)before:animate-nav-band-shimmer\b/.test(
                    activeRecipe,
                );
            // R15-PR4 introduced `nav-band-active-alive` (adds the
            // starburst bloom for the active row); its tailwind
            // entry still embeds the 4s shimmer track so the
            // visual contract holds either way.
            const activeAlive =
                /(?<!hover:)before:animate-nav-band-(?:active-)?alive\b/.test(
                    activeRecipe,
                );
            expect(activeShimmer || activeAlive).toBe(true);
        });
    });

    describe('PR-4 — active band swaps to secondary brand', () => {
        it('four secondary-brand band overrides on active', () => {
            expect(activeRecipe).toMatch(
                /before:from-\[var\(--brand-secondary-default\)\]!/,
            );
            expect(activeRecipe).toMatch(
                /before:via-\[var\(--brand-secondary-muted\)\]!/,
            );
            expect(activeRecipe).toMatch(
                /before:to-\[var\(--brand-secondary-emphasis\)\]!/,
            );
            expect(activeRecipe).toMatch(
                /before:shadow-\[var\(--nav-band-glow-active\)\]!/,
            );
        });
        it('--brand-secondary-muted + --nav-band-glow-active tokens declared', () => {
            for (const block of [DARK_BLOCK, LIGHT_BLOCK]) {
                expect(block).toMatch(/--brand-secondary-muted:/);
                expect(block).toMatch(/--nav-band-glow-active:/);
            }
        });
    });

    describe('PR-5 — active label takes brand colour', () => {
        it('active text is brand-default; default text is content-muted', () => {
            expect(activeRecipe).toMatch(
                /\btext-\[var\(--brand-default\)\]/,
            );
            expect(defaultRecipe).toMatch(/\btext-content-muted\b/);
            expect(defaultRecipe).not.toMatch(
                /\btext-\[var\(--brand-default\)\]/,
            );
        });
    });

    describe('PR-6 — glossy top-edge highlight (::after)', () => {
        it('NAV_ITEM_GLOSS_BASE recipe wires top-edge highlight', () => {
            expect(glossBaseRegion).toMatch(/after:absolute/);
            expect(glossBaseRegion).toMatch(/after:top-0/);
            expect(glossBaseRegion).toMatch(/after:h-px/);
            expect(glossBaseRegion).toMatch(
                /after:bg-\[var\(--nav-gloss-highlight\)\]/,
            );
            expect(glossBaseRegion).toMatch(/after:pointer-events-none/);
        });
        it('gloss reveal gated hover + active', () => {
            expect(defaultRecipe).toMatch(/hover:after:opacity-100/);
            expect(activeRecipe).toMatch(
                /(?<!hover:)after:opacity-100/,
            );
        });
        it('--nav-gloss-highlight declared in both themes', () => {
            expect(DARK_BLOCK).toMatch(/--nav-gloss-highlight:/);
            expect(LIGHT_BLOCK).toMatch(/--nav-gloss-highlight:/);
        });
    });

    describe('PR-7 — inset bevel shadow on hover', () => {
        it('--nav-bevel-shadow declared as inset both themes', () => {
            for (const block of [DARK_BLOCK, LIGHT_BLOCK]) {
                expect(block).toMatch(
                    /--nav-bevel-shadow:\s*inset\s+0\s+-1px/,
                );
            }
        });
        it('bevel applied on hover + un-gated on active', () => {
            expect(defaultRecipe).toMatch(
                /hover:shadow-\[var\(--nav-bevel-shadow\)\]/,
            );
            expect(activeRecipe).toMatch(
                /(?<!hover:)shadow-\[var\(--nav-bevel-shadow\)\]/,
            );
        });
    });

    describe('PR-8 — press feedback + motion-language broadening', () => {
        it('press transform + motion-reduce safety net wired in BASE', () => {
            expect(baseRegion).toMatch(/active:translate-y-px/);
            expect(baseRegion).toMatch(
                /motion-reduce:active:translate-y-0/,
            );
            expect(baseRegion).toMatch(/transition-transform/);
            expect(baseRegion).toMatch(/duration-75/);
        });
        it('nav-item.tsx is in the motion-language exempt list', () => {
            expect(MOTION_GUARD_SRC).toMatch(
                /['"]src\/components\/layout\/nav-item\.tsx['"]/,
            );
            // The cap moved from 6 (R13 ceiling) to 11 (R14 broadened
            // for the top-bar slot family) and back to 10 (searchbar-
            // kill sweep retired SearchAnchor + its entry). Lock the
            // current cap as a single digit; future broadenings need
            // to be argued at the motion-language ratchet itself.
            expect(MOTION_GUARD_SRC).toMatch(
                /EXEMPT_FILES\.size\)\.toBeLessThanOrEqual\(10\)/,
            );
        });
    });

    describe('PR-9 — band reaches toward cursor', () => {
        it('band geometry expanded on hover + active', () => {
            expect(defaultRecipe).toMatch(/hover:before:top-1\b/);
            expect(defaultRecipe).toMatch(/hover:before:bottom-1\b/);
            expect(defaultRecipe).toMatch(/hover:before:w-\[4px\]/);
            expect(activeRecipe).toMatch(/before:top-1!/);
            expect(activeRecipe).toMatch(/before:bottom-1!/);
            expect(activeRecipe).toMatch(/before:w-\[4px\]!/);
        });
        it('transition-property list broadened to include geometry', () => {
            expect(bandBaseRegion).toMatch(
                /before:transition-\[opacity,top,bottom,width\]/,
            );
            expect(bandBaseRegion).toMatch(/before:duration-200/);
        });
    });

    describe('PR-10 — section divider as soft gradient', () => {
        it('NAV_SECTION_DIVIDER uses ::before + linear-gradient', () => {
            expect(sectionDividerRecipe).toMatch(/before:absolute/);
            expect(sectionDividerRecipe).toMatch(/before:top-0/);
            expect(sectionDividerRecipe).toMatch(/before:h-px/);
            expect(sectionDividerRecipe).toMatch(
                /before:bg-\[linear-gradient\(90deg,/,
            );
            expect(sectionDividerRecipe).toMatch(/var\(--border-subtle\)/);
        });
        it('isFirst gate preserved', () => {
            expect(NAV_SECTION_SRC).toMatch(
                /!isFirst\s*&&\s*title\s*&&\s*NAV_SECTION_DIVIDER/,
            );
        });
    });

    describe('PR-11 — radial brand wash on active row', () => {
        it('active bg is a radial-gradient from secondary-subtle', () => {
            expect(activeRecipe).toMatch(/bg-\[radial-gradient\(/);
            expect(activeRecipe).toMatch(/radial-gradient\(circle_at_left,/);
            expect(activeRecipe).toMatch(/var\(--brand-secondary-subtle\)/);
            expect(activeRecipe).toMatch(
                /bg-\[radial-gradient\([\s\S]*?,_transparent/,
            );
        });
    });

    describe('integration — preserved R12 invariants', () => {
        it('still 44px row + 8px radius + 18px icon', () => {
            expect(NAV_ITEM_SRC).toMatch(/min-h-\[44px\]/);
            expect(NAV_ITEM_SRC).toMatch(/rounded-lg/);
            expect(NAV_ITEM_SRC).toMatch(/w-\[18px\] h-\[18px\]/);
        });
        it('still focus-visible ring at --ring', () => {
            expect(baseRegion).toMatch(
                /focus-visible:ring-2/,
            );
            expect(baseRegion).toMatch(
                /focus-visible:ring-\[var\(--ring\)\]/,
            );
        });
        it('still 44px touch target on hover (geometry stays still outside band)', () => {
            // Hover expands the BAND geometry, not the row. The row
            // stays at its 44px touch-target height regardless of
            // state.
            expect(defaultRecipe).not.toMatch(/hover:h-/);
            expect(defaultRecipe).not.toMatch(/hover:min-h-/);
            expect(activeRecipe).not.toMatch(/\bh-\d+\b/);
        });
    });

    describe('R12-PR3 + R13-PR10 — section header preserved', () => {
        it('still 10px text + tracking-0.12em + uppercase + content-subtle', () => {
            const headerRecipe =
                NAV_SECTION_SRC.match(
                    /export\s+const\s+NAV_SECTION_HEADER\s*=\s*['"]([^'"]+)['"]/,
                )?.[1] ?? '';
            expect(headerRecipe).toMatch(/text-\[10px\]/);
            expect(headerRecipe).toMatch(/tracking-\[0\.12em\]/);
            expect(headerRecipe).toMatch(/uppercase/);
            expect(headerRecipe).toMatch(/text-content-subtle/);
            expect(headerRecipe).toMatch(/select-none/);
        });
    });
});
