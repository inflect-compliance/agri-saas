/**
 * R17-PR2 — HeroMetric ambient-glow breath animation.
 *
 * R17-PR1 added the static brand glow under the 72px verdict.
 * PR-2 animates that glow's opacity through a 6-second breath so
 * the masthead reads as gently alive — same identity-tier rhythm
 * as the R14-PR3 brand-mark pulse and the R15-PR2 nav-band halo-
 * breath (every 6s breath is one tier in the same hierarchy).
 *
 * Four load-bearing invariants:
 *
 *   1. Tailwind config registers the `hero-glow-breath` keyframe
 *      with the canonical opacity palindrome (0.65 → 1 → 0.65).
 *      The 0.65 floor keeps the glow visible at minimum brightness
 *      (so it never reads as "off"); the 1.0 peak is the resting
 *      ambient. Asymmetric values would either flicker (lower min)
 *      or never quite breathe (higher min).
 *
 *   2. The animation utility runs at 6s with ease-in-out + infinite.
 *      Slower than the state-tier 4s shimmer; identity-tier rhythm.
 *      ease-in-out gives the natural breath curve.
 *
 *   3. HeroMetric applies `before:animate-hero-glow-breath` on the
 *      section wrapper — the `before:` variant targets the same
 *      pseudo that carries the R17-PR1 radial gradient.
 *
 *   4. The PR-1 contracts are preserved — `data-hero-ambient-glow`
 *      attribute + the wrapper still carries `relative isolate
 *      overflow-hidden`. The breath is composed onto the glow, not
 *      a replacement for it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const HERO_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/HeroMetric.tsx'),
    'utf8',
);
const TW_CONFIG = fs.readFileSync(
    path.join(ROOT, 'tailwind.config.js'),
    'utf8',
);

describe('R17-PR2 — HeroMetric breath animation', () => {
    it('tailwind config defines the hero-glow-breath keyframe with the 0.65 → 1 palindrome', () => {
        // The keyframe shape itself — opacity floor 0.65, peak 1,
        // back to floor. Asymmetric or wider-range values would
        // produce a flicker; a tighter range would be imperceptible.
        expect(TW_CONFIG).toMatch(
            /'hero-glow-breath':\s*\{[\s\S]*?'0%,\s*100%':\s*\{\s*opacity:\s*'0\.65'\s*\}[\s\S]*?'50%':\s*\{\s*opacity:\s*'1'\s*\}/,
        );
    });

    it('tailwind animation utility runs the breath at 6s ease-in-out infinite', () => {
        // Tempo is load-bearing — see R14/R15 for the identity-tier
        // 6s rhythm precedent. ease-in-out is the natural breath
        // curve; infinite keeps the masthead alive while visible.
        expect(TW_CONFIG).toMatch(
            /'hero-glow-breath':\s*\n?\s*'hero-glow-breath\s+6s\s+ease-in-out\s+infinite'/,
        );
    });

    it('HeroMetric applies before:animate-hero-glow-breath on the section wrapper', () => {
        // The `before:` variant attaches the animation to the same
        // pseudo that carries the R17-PR1 radial gradient. Without
        // the variant, the animation would scope to the section
        // itself (which has no animated property in its base styles).
        expect(HERO_SRC).toMatch(/"before:animate-hero-glow-breath"/);
    });

    it('PR-1 glow contracts remain intact', () => {
        // The breath composes onto the glow, not replaces it. PR-3
        // (delta chip + sparkline) will need the data attribute,
        // and the wrapper's stacking-context classes must stay so
        // the `before:` pseudo still resolves under the value.
        expect(HERO_SRC).toMatch(/data-hero-ambient-glow/);
        expect(HERO_SRC).toMatch(/"relative\s+isolate\s+overflow-hidden"/);
        expect(HERO_SRC).toMatch(
            /before:bg-\[radial-gradient\(ellipse_640px_400px_at_18%_60%,\s*var\(--brand-subtle\)_0%,\s*transparent_72%\)\]/,
        );
    });
});
