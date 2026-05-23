/**
 * Roadmap-15 PR-5 — Asymmetric per-row drift.
 *
 * Without per-row staggering, every NavItem's perpetual animations
 * (the R13-PR3 shimmer + the R15-PR2 halo-breath) start at the
 * same phase. The sidebar's bands then march in lockstep — easy
 * for the eye to read as "a periodic system", which dilutes the
 * carefully-tuned R15 motion into mechanical noise despite the
 * intentionally-mismatched 4s/6s tempos.
 *
 * R15-PR5 introduces `animation-delay` per-row on the two
 * perpetual tracks ONLY:
 *
 *   shimmer       4s ease-in-out var(--nav-shimmer-delay, 0ms) infinite
 *   halo-breath   6s ease-in-out var(--nav-breath-delay, 0ms) infinite
 *
 * The two one-shot tracks (reveal-sweep + starburst) keep zero
 * delay — they're celebration moments that must fire instantly
 * when the row engages. Staggering them would smear the "you just
 * clicked" signal across half a second.
 *
 * NavItem derives the two delay values from a deterministic hash
 * of the row's slug. Same slug always gets the same delay pair,
 * so the visual phase pattern stays stable across renders. Hash
 * buckets are independent (shimmer hash modulo 1000ms ≈ quarter
 * shimmer cycle; halo-breath hash modulo 1500ms ≈ quarter breath
 * cycle), so no two rows share the same (shimmer-phase, breath-
 * phase) coordinate.
 *
 * Quarter-cycle staggers are the visual sweet spot. Smaller
 * staggers (under 100ms) read as "imperfect sync"; larger
 * staggers (above one full cycle) lose the visual relationship
 * between rows. Quarter-cycle = clearly out of phase without
 * looking like exact mirrors.
 *
 * What this ratchet does NOT police:
 *
 *   - The exact hash function. A future refactor to FNV-1a or
 *     similar is fine — the contract is "deterministic per-slug".
 *   - The exact modulo values (1000 / 1500). Future tuning is
 *     allowed within the "quarter cycle" boundary.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const NAV_ITEM_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/layout/nav-item.tsx'),
    'utf8',
);
const TAILWIND_CONFIG = fs.readFileSync(
    path.join(ROOT, 'tailwind.config.js'),
    'utf8',
);

describe('Roadmap-15 PR-5 — per-row drift', () => {
    describe('NavItem hash + style wiring', () => {
        it('declares a hash function for per-row delays', () => {
            // The hash function MUST exist as a named helper so
            // the contract is greppable. A future refactor that
            // inlines the hash into the component body would still
            // work, but the named helper is the canonical pattern
            // and easier for new contributors to find.
            expect(NAV_ITEM_SRC).toMatch(
                /function\s+hashSlugToDriftDelays\s*\(/,
            );
        });

        it('hash returns both shimmerDelayMs and breathDelayMs fields', () => {
            // Two distinct delay buckets — one per perpetual track.
            // A single delay shared across both tracks would
            // re-couple the two timelines (a row's shimmer and
            // breath would always start in phase relative to each
            // other), which defeats the asynchrony intent.
            expect(NAV_ITEM_SRC).toMatch(/shimmerDelayMs:\s*[\w\s%>|()<.]+/);
            expect(NAV_ITEM_SRC).toMatch(/breathDelayMs:\s*[\w\s%>|()<.]+/);
        });

        it('NavItem builds a style object with the two CSS custom properties', () => {
            // The host <Link> element carries the per-row drift
            // style. CSS custom properties inherit into the ::before
            // pseudo-element where the animation runs.
            expect(NAV_ITEM_SRC).toMatch(
                /'--nav-shimmer-delay':\s*`\$\{shimmerDelayMs\}ms`/,
            );
            expect(NAV_ITEM_SRC).toMatch(
                /'--nav-breath-delay':\s*`\$\{breathDelayMs\}ms`/,
            );
        });

        it('the style object is passed to the <Link> element', () => {
            // Without the style prop, the CSS custom properties
            // never reach the DOM and the animation defaults to
            // 0ms delay — exactly the "everything in lockstep"
            // failure mode this PR fixes.
            expect(NAV_ITEM_SRC).toMatch(/<Link[\s\S]*?style=\{driftStyle\}/);
        });

        it('hash is deterministic — same slug always yields same delays', () => {
            // Visual phase pattern must be stable across renders.
            // A random-each-time delay would mean the sidebar
            // reorganizes its phase pattern on every mount, which
            // is jarring. Lock the deterministic shape: a string-
            // multiplier + charCode accumulation is the canonical
            // pattern.
            expect(NAV_ITEM_SRC).toMatch(/h\s*=\s*\(h\s*\*\s*31\s*\+/);
        });
    });

    describe('tailwind composed alive — per-track delays', () => {
        it('`nav-band-alive` shimmer track consumes --nav-shimmer-delay', () => {
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            // The shimmer track contains the CSS custom property
            // in the delay slot of the animation shorthand.
            expect(value).toMatch(
                /nav-band-shimmer\s+4s\s+ease-in-out\s+var\(--nav-shimmer-delay,\s*0ms\)\s+infinite/,
            );
        });

        it('`nav-band-alive` halo-breath track consumes --nav-breath-delay', () => {
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            expect(value).toMatch(
                /nav-band-halo-breath\s+6s\s+ease-in-out\s+var\(--nav-breath-delay,\s*0ms\)\s+infinite/,
            );
        });

        it('`nav-band-alive` reveal-sweep track does NOT carry a custom delay', () => {
            // The reveal is a one-shot celebration — it must fire
            // immediately when the row engages. Adding a stagger
            // would smear the "the band materialized" moment.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            // Bound the reveal-sweep track to the first comma
            // after its declaration.
            const revealStart = value.indexOf('nav-band-reveal-sweep');
            const firstComma = value.indexOf(',', revealStart);
            const revealTrack = value.slice(revealStart, firstComma);
            expect(revealTrack).not.toContain('var(--nav-');
        });

        it('`nav-band-active-alive` shimmer track consumes --nav-shimmer-delay', () => {
            // Active rows drift on their own phase too — that's
            // why both nav-band-alive and nav-band-active-alive
            // need the delay wiring.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            expect(value).toMatch(
                /nav-band-shimmer\s+4s\s+ease-in-out\s+var\(--nav-shimmer-delay,\s*0ms\)\s+infinite/,
            );
        });

        it('`nav-band-active-alive` halo-breath track consumes --nav-breath-delay', () => {
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            expect(value).toMatch(
                /nav-band-halo-breath\s+6s\s+ease-in-out\s+var\(--nav-breath-delay,\s*0ms\)\s+infinite/,
            );
        });

        it('`nav-band-active-alive` starburst track does NOT carry a custom delay', () => {
            // The starburst is THE celebration moment — fires
            // instantly when a row becomes active. Staggering it
            // would mean some rows take 1.5 seconds to celebrate
            // after a click, which would feel broken.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            const value = aliveMatch![1];
            const burstStart = value.indexOf('nav-band-starburst');
            const firstComma = value.indexOf(',', burstStart);
            const burstTrack = value.slice(burstStart, firstComma);
            expect(burstTrack).not.toContain('var(--nav-');
        });

        it('both alive entries use the `, 0ms` fallback (legacy callers stay correct)', () => {
            // Any NavItem caller that forgets to set the custom
            // properties (or any consumer outside NavItem that
            // applies the animation class) MUST still produce a
            // 0ms delay, not `unset` or a syntax error. The CSS
            // var fallback is the safety net.
            const aliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-alive':\s*'([^']+)'/,
            );
            const activeAliveMatch = TAILWIND_CONFIG.match(
                /'nav-band-active-alive':\s*'([^']+)'/,
            );
            expect(aliveMatch).not.toBeNull();
            expect(activeAliveMatch).not.toBeNull();
            for (const value of [aliveMatch![1], activeAliveMatch![1]]) {
                expect(value).toContain('var(--nav-shimmer-delay, 0ms)');
                expect(value).toContain('var(--nav-breath-delay, 0ms)');
            }
        });
    });
});
