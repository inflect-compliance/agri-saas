/**
 * v2-PR-10 — `<HeroMetric>` primitive contract + adoption.
 *
 * Locks the masthead-tier metric primitive used by dashboard pages
 * as the SINGLE-NUMBER verdict at the top of the page. 72px tabular-
 * nums value, optional 7-day delta chip, optional primary CTA.
 *
 * Why a separate primitive (vs. just a bigger KpiCard):
 *   - Different visual register: KPI cards are part of a stack of
 *     metrics; a hero metric is a verdict.
 *   - Different typography: 72px tabular-nums vs 24px gradient.
 *   - Different layout: full-width bar with the value left-aligned
 *     and a primary CTA right-aligned.
 *
 * Pairs with:
 *   - src/components/ui/HeroMetric.tsx (the primitive)
 *   - src/components/ui/MetricCard.tsx (the chassis for KPI tiles)
 *   - src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx
 *     (canonical adoption — first dashboard with a hero metric)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("v2-PR-10 HeroMetric primitive contract", () => {
    const src = fs.readFileSync(
        path.join(ROOT, "src/components/ui/HeroMetric.tsx"),
        "utf8",
    );

    it("exports the HeroMetric component + props interface", () => {
        expect(src).toMatch(/export\s+function\s+HeroMetric/);
        expect(src).toMatch(/export\s+interface\s+HeroMetricProps/);
    });

    it("declares the documented slot props", () => {
        for (const slot of [
            "eyebrow",
            "value",
            "format",
            "description",
            "delta",
            "deltaPolarity",
            "deltaLabel",
            "action",
        ]) {
            expect(src).toMatch(new RegExp(`\\b${slot}\\??:`));
        }
    });

    it("eyebrow + value are required (no `?`); other slots are optional", () => {
        expect(src).toMatch(/\beyebrow:\s*React\.ReactNode/);
        expect(src).toMatch(/\bvalue:\s*number/);
        for (const slot of [
            "format",
            "description",
            "delta",
            "deltaPolarity",
            "deltaLabel",
            "action",
        ]) {
            expect(src).toMatch(new RegExp(`\\b${slot}\\?:`));
        }
    });

    it("renders the headline at 72px tabular-nums", () => {
        expect(src).toMatch(/text-\[72px\]/);
        expect(src).toMatch(/tabular-nums/);
    });

    it("uses AnimatedNumber for the value", () => {
        expect(src).toMatch(
            /import\s+\{[^}]*AnimatedNumber[^}]*\}\s+from\s+["']\.\/animated-number["']/,
        );
        expect(src).toMatch(/<AnimatedNumber\b/);
    });

    it("renders inside the canonical Card frame (cardVariants raised)", () => {
        // Roadmap-5 PR-1 — the glass-card literal moved into the
        // Card primitive. HeroMetric now composes cardVariants()
        // instead of carrying the literal in its className.
        expect(src).toMatch(/cardVariants\(\)/);
    });

    it("uses the v2-PR-4 transition-colors motion language", () => {
        expect(src).toMatch(/transition-colors\s+duration-150\s+ease-out/);
    });

    it("forwards stable test markers per slot", () => {
        for (const id of [
            "data-hero-metric",
            "data-hero-metric-eyebrow",
            "data-hero-metric-value",
            "data-hero-metric-description",
            "data-hero-metric-delta",
            "data-hero-metric-delta-semantic",
        ]) {
            expect(src).toContain(id);
        }
    });
});

describe("v2-PR-10 executive dashboard adoption", () => {
    const src = fs.readFileSync(
        path.join(
            ROOT,
            "src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx",
        ),
        "utf8",
    );

    it("imports + renders <HeroMetric>", () => {
        expect(src).toMatch(
            /import\s+\{\s*HeroMetric\s*\}\s+from\s+["']@\/components\/ui\/HeroMetric["']/,
        );
        expect(src).toMatch(/<HeroMetric\b/);
    });

    it("places the hero ABOVE the KPI grid", () => {
        const heroIdx = src.search(/<HeroMetric/);
        const kpiGridIdx = src.search(/KPI Grid/);
        expect(heroIdx).toBeGreaterThan(0);
        expect(kpiGridIdx).toBeGreaterThan(0);
        expect(heroIdx).toBeLessThan(kpiGridIdx);
    });

    it("surfaces open field tasks as the farm hero value", () => {
        // The compliance surfaces (controls/tasks/policies) were hidden
        // from this farm app, so the hero now leads with the farmer's
        // open field-task count instead of control coverage. Swapping the
        // hero metric again is a deliberate UX call that should land a
        // same-PR ratchet update here.
        expect(src).toMatch(/value=\{openFarmTasks\}/);
        expect(src).toMatch(/eyebrow="Farm tasks"/);
    });
});
