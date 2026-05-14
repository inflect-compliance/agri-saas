"use client";

/**
 * `<HeroMetric>` — masthead-tier metric component (v2-PR-10).
 *
 * Sits at the very top of dashboard pages as the SINGLE-NUMBER
 * verdict — the user's first impression of how the system is doing.
 * 72px tabular-nums value, optional 7-day delta chip, optional
 * primary CTA button.
 *
 * Why a separate primitive (vs. just a bigger KpiCard):
 *   - Different visual register: KPI cards are part of a stack of
 *     metrics ("here are the numbers"); a hero metric is a verdict
 *     ("here's how you're doing right now").
 *   - Different typography: 72px tabular-nums vs 24px gradient.
 *   - Different layout: full-width bar with the value left-aligned
 *     and a primary CTA right-aligned, vs a card-shaped tile.
 *
 * Composition:
 *   - Eyebrow label (uppercase, tracking-wide, muted) above the value.
 *   - Value rendered through `<AnimatedNumber>` so updates animate
 *     smoothly when the dashboard re-fetches via SWR.
 *   - Delta chip on the right (optional) — `+ 4.2 pp vs last week`.
 *   - Primary action button on the far right (optional).
 *   - Description line below the value (optional, ≤ 80 chars).
 *
 * Pairs with:
 *   - `<MetricCard>` (v2-PR-8) — the chassis for KPI tiles. HeroMetric
 *     deliberately does NOT compose via MetricCard because the
 *     visual register is different.
 *   - `<DashboardLayout>` (v2-PR-6) — typical placement is the first
 *     child of the layout body.
 */

import * as React from "react";
import { cn } from "@dub/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { AnimatedNumber, type AnimatedNumberFormat } from "./animated-number";
import { Button } from "./button";
import { cardVariants } from "./card";

// ─── Types ────────────────────────────────────────────────────────

export type HeroMetricFormat = "number" | "percent" | "compact";

export type HeroMetricDeltaPolarity = "up-good" | "down-good" | "neutral";

export interface HeroMetricAction {
    label: string;
    onClick?: () => void;
    href?: string;
    /** Forwarded to the underlying control. */
    "data-testid"?: string;
}

export interface HeroMetricProps {
    /**
     * Eyebrow label rendered above the value. Conventionally the
     * resource name ("Readiness", "Control Coverage").
     */
    eyebrow: React.ReactNode;
    /**
     * The metric value. Rendered through `<AnimatedNumber>` so it
     * animates on update.
     */
    value: number | null | undefined;
    /**
     * Format passed to `<AnimatedNumber>`. Defaults to `'number'`.
     */
    format?: HeroMetricFormat;
    /**
     * Optional one-sentence description rendered below the value.
     * ≤ 80 chars per the v2 polish copy convention.
     */
    description?: React.ReactNode;
    /**
     * Optional 7-day (or whatever-window) delta. When supplied,
     * renders the chip with up/down/flat arrow + magnitude on the
     * right of the masthead (left of the action).
     */
    delta?: number | null;
    /**
     * Polarity for the delta tone:
     *   - 'up-good'   (default) — positive delta = good (green)
     *   - 'down-good'           — negative delta = good (e.g. risk count down)
     *   - 'neutral'             — never tone, always muted
     */
    deltaPolarity?: HeroMetricDeltaPolarity;
    /**
     * Optional label rendered after the delta chip
     * (e.g. "vs last week").
     */
    deltaLabel?: React.ReactNode;
    /**
     * Optional primary action button rendered on the far right of
     * the masthead.
     */
    action?: HeroMetricAction;
    /** Outer wrapper className. */
    className?: string;
    /** Forwarded to the wrapper for E2E selectors. */
    "data-testid"?: string;
}

// ─── Component ────────────────────────────────────────────────────

function deltaSemantic(
    delta: number,
    polarity: HeroMetricDeltaPolarity,
): "good" | "bad" | "neutral" {
    if (polarity === "neutral") return "neutral";
    if (delta === 0) return "neutral";
    const positive = delta > 0;
    if (polarity === "up-good") return positive ? "good" : "bad";
    return positive ? "bad" : "good";
}

const SEMANTIC_TEXT: Record<"good" | "bad" | "neutral", string> = {
    good: "text-content-success",
    bad: "text-content-error",
    neutral: "text-content-muted",
};

function deltaArrow(delta: number): React.ElementType {
    if (delta > 0) return ArrowUp;
    if (delta < 0) return ArrowDown;
    return Minus;
}

export function HeroMetric({
    eyebrow,
    value,
    format = "number",
    description,
    delta,
    deltaPolarity = "up-good",
    deltaLabel,
    action,
    className,
    "data-testid": dataTestId,
}: HeroMetricProps) {
    const isEmpty = value === null || value === undefined;
    const animatedFormat: AnimatedNumberFormat =
        format === "percent"
            ? { kind: "percent", fractionDigits: 1 }
            : format === "compact"
              ? {
                    kind: "intl",
                    options: {
                        notation: "compact",
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                    },
                }
              : { kind: "decimal", fractionDigits: 0 };

    const deltaInfo = (() => {
        if (delta === undefined || delta === null) return null;
        const semantic = deltaSemantic(delta, deltaPolarity);
        const Arrow = deltaArrow(delta);
        const sign = delta > 0 ? "+" : "";
        return { semantic, Arrow, sign, magnitude: Math.abs(delta) };
    })();

    return (
        <section
            className={cn(
                cardVariants(),
                "relative isolate overflow-hidden",
                "flex flex-col gap-tight md:flex-row md:items-end md:justify-between",
                "transition-colors duration-150 ease-out",
                // R17-PR1 — ambient brand glow behind the 72px value.
                // Soft radial wash anchored under the value (left bias,
                // vertical centre), brand-subtle alpha that fades to
                // transparent. R17-PR2 animates the glow's opacity
                // through a 6-second breath on top of the same gradient.
                "before:content-[''] before:absolute before:inset-0 before:-z-10 before:pointer-events-none",
                "before:bg-[radial-gradient(ellipse_640px_400px_at_18%_60%,var(--brand-subtle)_0%,transparent_72%)]",
                // R17-PR2 — 6s opacity breath on the glow. The mast-
                // head reads as gently alive — same identity-tier
                // rhythm as the R14 brand pulse and the R15 nav-band
                // halo-breath. prefers-reduced-motion auto-flattens
                // via tokens.css.
                "before:animate-hero-glow-breath",
                className,
            )}
            data-hero-metric
            data-hero-ambient-glow
            data-testid={dataTestId}
        >
            <div className="min-w-0 flex-1">
                <p
                    className="text-xs text-content-muted uppercase tracking-wide font-medium"
                    data-hero-metric-eyebrow
                >
                    {eyebrow}
                </p>
                <p
                    className={cn(
                        "text-[72px] leading-none font-bold tabular-nums mt-tight",
                        isEmpty
                            ? "text-content-subtle"
                            : "text-content-emphasis",
                    )}
                    data-hero-metric-value
                >
                    {isEmpty ? (
                        "—"
                    ) : (
                        <AnimatedNumber
                            value={value}
                            format={animatedFormat}
                        />
                    )}
                </p>
                {description && (
                    <p
                        className="text-sm text-content-muted mt-tight max-w-prose"
                        data-hero-metric-description
                    >
                        {description}
                    </p>
                )}
            </div>
            <div className="flex flex-col gap-tight items-end shrink-0">
                {deltaInfo && (
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 text-sm font-medium",
                            SEMANTIC_TEXT[deltaInfo.semantic],
                        )}
                        data-hero-metric-delta
                        data-hero-metric-delta-semantic={deltaInfo.semantic}
                    >
                        <deltaInfo.Arrow className="h-4 w-4" />
                        {deltaInfo.sign}
                        <AnimatedNumber
                            value={deltaInfo.magnitude}
                            format={animatedFormat}
                        />
                        {deltaLabel && (
                            <span className="text-content-subtle ml-1">
                                {deltaLabel}
                            </span>
                        )}
                    </span>
                )}
                {action && (
                    action.href ? (
                        <a
                            href={action.href}
                            data-testid={action["data-testid"]}
                            className="inline-flex"
                        >
                            <Button variant="primary" size="md">
                                {action.label}
                            </Button>
                        </a>
                    ) : (
                        <Button
                            variant="primary"
                            size="md"
                            onClick={action.onClick}
                            data-testid={action["data-testid"]}
                        >
                            {action.label}
                        </Button>
                    )
                )}
            </div>
        </section>
    );
}
