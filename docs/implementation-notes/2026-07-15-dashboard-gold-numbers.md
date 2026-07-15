# 2026-07-15 — Dashboard: metallic-gold gradient numbers + Bricolage display face

**Commit:** `<pending>` feat(ui): gradient-filled hero numbers + Bricolage display font

## Design

A light "make the dashboard sexier" pass. Two moves, one signature:

1. **Display face — Bricolage Grotesque** — for the featured numbers. A
   contemporary grotesque with character and crisp tabular figures; deliberately
   NOT Inter (the body face) or Space Grotesk (both AI-default faces).

   **Numbers only — NOT headings.** Bricolage has no Cyrillic subset (latin /
   latin-ext / vietnamese), and the product ships in Bulgarian, so applying it
   to headings would silently fall back to Inter on pure-Cyrillic titles and
   render mixed fonts on ones like "Добър ден, **Alice Admin**." The numbers are
   digits (Latin) — Bricolage renders them cleanly — so the display face lands
   exactly where it works. Headings + body stay Inter.

2. **Metallic-gold gradient on the featured numbers** — the Agrent brand gold
   (`#D4AF37 → #B8860B`) as a `background-clip:text` fill. This is the one bold
   thing; everything around it stays quiet.

**Semantic tones are never gold.** Only `default`-tone values gradient-fill; a
`success`/`critical` metric keeps its green/red — the colour is the signal.

## Files

| File | Role |
| --- | --- |
| `src/app/globals.css` | Bricolage added to the Google-Fonts `@import`; new `.metric-gradient` utility (with an `@supports` solid-gold fallback so the glyphs are never invisible) |
| `src/styles/tokens.css` | `--grad-gold` per theme (bright sheen on dark navy, deep bronze on cream, solid AAA bronze in high-contrast) + `--font-display` |
| `tailwind.config.js` | `fontFamily.display` → `font-display` utility |
| `src/components/ui/typography.tsx` | (unchanged — headings stay Inter; see the Cyrillic note above) |
| `src/components/ui/metric.tsx` | `HeroMetric` / `KPIStat` values → `font-display`; default tone → `.metric-gradient` |
| `src/components/ui/MetricCard.tsx` | KPI value → `font-display` (KpiCard supplies its own semantic accent gradient inside) |
| `src/components/trends/MarketTrendsWidget.tsx` | dashboard headline price → `font-display` + gradient |
| `src/components/trends/PricesTab.tsx` | Trends price stat tiles → `font-display` + gradient (bumped to `text-2xl`) |

## Decisions

- **Uplift the shared primitives, not one page.** Applying to `metric.tsx` /
  `MetricCard` / `Heading` means every dashboard (farm, risks, controls, the
  Trends tiles) gets the treatment consistently, from a handful of edits.
- **Guard-safe by construction.** Gradient stops (`--grad-gold` via a CSS
  utility) and `font-display` are neither raw colours nor inline `<hN>` tags, so
  the raw-color / typography-eradication / metric-typography ratchets stay green.
  The font goes through the sanctioned globals.css `@import` (kept first, per the
  import-order guard) + Tailwind `fontFamily`.
- **Accessibility:** gradient text keeps a solid brand-gold fallback under
  `@supports`; the high-contrast theme swaps the gradient for a solid AAA bronze.
