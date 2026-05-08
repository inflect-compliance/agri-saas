/**
 * Card primitive — PR-6.
 *
 * Wraps the legacy `.glass-card` CSS class with a typed `density` prop
 * so consumers stop hand-rolling `<div className="glass-card p-5">`
 * and `<div className="glass-card p-8">` (visual drift between the
 * canonical `p-4` and `p-6` rungs).
 *
 * Density rungs (deliberately small — two visible plus a no-padding
 * escape hatch for cards whose children own their own padding):
 *
 *   density="comfortable" (default)   p-6   — content cards, panels
 *   density="compact"                 p-4   — stat cards, inline cards
 *   density="none"                    p-0   — children own padding
 *
 * Why three only (no `p-5`/`p-8`)? The audit's call: a finite scale.
 * Pages that reached for `p-5` or `p-8` were drifting between the two
 * canonical rungs without a documented reason; they're collapsed onto
 * `comfortable` (`p-6`) by PR-6's migration. The `card-density-discipline`
 * ratchet at `tests/guards/card-density-discipline.test.ts` blocks
 * reintroduction.
 *
 * Why keep `.glass-card` underneath? It's the existing visual recipe
 * (backdrop-blur + glass-bg + glass-border) that already paints
 * correctly on both themes. The primitive is a typed wrapper, not a
 * replacement.
 */

"use client";

import { cn } from "@dub/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ElementType, type HTMLAttributes } from "react";

const cardVariants = cva("glass-card", {
  variants: {
    density: {
      comfortable: "p-6",
      compact: "p-4",
      none: "",
    },
  },
  defaultVariants: {
    density: "comfortable",
  },
});

type CardTag = "div" | "section" | "article" | "aside" | "li";

interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** Element override. Defaults to `<div>`. Use `section`/`article`
   * when the card represents a discrete content region the page
   * outline cares about. */
  as?: CardTag;
  className?: string;
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { as = "div", density, className, children, ...rest },
  ref,
) {
  const Tag = as as ElementType;
  return (
    <Tag
      ref={ref}
      className={cn(cardVariants({ density }), className)}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export { Card, cardVariants };
export type { CardProps };
