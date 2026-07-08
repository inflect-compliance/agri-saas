# 2026-07-08 — Crop icon on parcels (location map)

**Prompt:** #1 — show each parcel's crop as a small icon on the Location map,
reflecting `Parcel.cropType` (populated at import by #7), with a compact
legend and a zoom threshold so it doesn't clutter a zoomed-out view.

## Design

Mirrors the soil-view side-channel pattern: the page passes MapCanvas a
`cropById: Record<parcelId, cropValue>` map (like `soilColorById`), rather than
widening the minimal `MapParcel` shape. MapCanvas draws one extra HTML
`<Marker>` per parcel that carries a crop, positioned at the parcel's
`@turf/bbox` centre (reusing the `parcelLabels` positions) with a small upward
`offset` so the glyph floats just above the existing name/area label. The
marker is `pointerEvents: 'none'` so clicks still fall through to the parcel
fill for selection, and shares the labels' `!drawing && !vectorActive` guard.

**Zoom threshold:** MapCanvas now tracks live zoom (`onZoomEnd` → state,
seeded from the initial view). Crop glyphs render only at `zoom >= 12` — at a
whole-region view they'd overlap into noise; they reappear when inspecting
fields. Labels are unchanged (no zoom gate), so nothing regresses.

**Glyphs:** inline SVGs (`CropGlyph`), *not* lucide — MapCanvas is outside the
no-lucide allowlist and Nucleo has no crop glyphs, so an icon-font import isn't
viable. Keyed by the six `CROP_OPTIONS` values (Wheat/Barley/Canola/Maize/
Sunflower/Peas); an unknown / free-text `cropType` (imported parcels can carry
one) falls back to a generic sprout, so every crop-bearing parcel still gets a
marker. `CropLegend` (modelled on `SoilLegend`) lists the distinct crops
present, glyph + name, and renders in the map-tab side column whenever any
crop is present (independent of the soil toggle — the two legends stack).

No backend change: `cropType` was already selected by
`ParcelRepository.listForLocation` and delivered to the page.

## Files

| File | Role |
| --- | --- |
| `src/components/agriculture/CropGlyph.tsx` | Inline-SVG glyph per crop value + `isKnownCrop` |
| `src/components/agriculture/CropLegend.tsx` | Compact legend (crops present → glyph + label) |
| `src/components/ui/map/MapCanvas.tsx` | `cropById` prop, zoom tracking, crop-glyph `<Marker>` layer |
| `src/app/.../locations/[locationId]/page.tsx` | `cropById`/`cropsPresent` memos, pass to MapCanvas, render `CropLegend` |
| `messages/en.json` · `messages/bg.json` | `ag.crop.legendTitle` (EN + BG) |

## Decisions

- **Side-channel `cropById`, not a widened `MapParcel`** — matches the soil
  precedent and keeps the map primitive's core shape minimal.
- **Separate glyph marker (offset above the label), not augmenting the label**
  — keeps the label DOM (and its E2E selectors) untouched, and lets the glyph
  carry its own zoom gate independent of label visibility.
- **Inline SVG over lucide/Nucleo** — the only path that satisfies the
  no-lucide guard without an allowlist edit, since no crop glyph exists in
  Nucleo.
- **Crop names render as their stored value** (English catalogue labels),
  consistent with the existing crop select (#7); only the legend *title* is
  i18n'd. Localising the six crop names is a separate, larger change.
