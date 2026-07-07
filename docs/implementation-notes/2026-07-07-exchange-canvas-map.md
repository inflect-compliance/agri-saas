# 2026-07-07 — Exchange overview: custom Canvas map (retire MapLibre)

**Commit:** `<sha> feat(exchange): custom Canvas map replaces MapLibre for the overview`

## Design

The Exchange marketplace overview no longer uses MapLibre GL. For a
Bulgaria-only commodity overview a full WebGL basemap was overkill and hard
to make read like the approved "grain floor" mockup (slow first paint, a
recurring spotlight-mask triangulation gash, fighting basemap labels). It is
replaced by a bespoke 2D-Canvas renderer in the SAME `ExchangeMap` component
(same props, same two exported colour constants) — a drop-in for
`ExchangeClient`, which was not touched.

```
listings ──► buildModel(listings, geom) ─┬─► offers[]  (projected px,py + national-best flag)
                                          ├─► groups[]  (region·crop·side aggregate, centroid, avg, totalT)
                                          └─► heatByIso (per-region tonnage share)

draw() every frame:
  provinces (Path2D, heat gold / emerald-if-selected) + outline
  z = k/fit
    z < 3.4  → one marker per group, chip "crop·⌀price€/t"
    z ≥ 3.4  → individual offers (fan coincident), chip "crop·Xt·price€/t"
    z ≥ 6.5  → chip also carries the region name
  priority label pass: best > tonnage; a chip overlapping a stronger one
    fades to 0.24; hover / pinned chips lift to full and draw last
```

Geometry (projected province paths + dissolved outline + the projection
params) is baked once into `public/geo/bg-map-geometry.json` from the
existing geoBoundaries geojson. Live offer `lon/lat` is projected at runtime
with the SAME params (equirectangular + cos(midLat)), so markers land on the
correct province. The province polygons are pre-projected into a fixed
1000×600 space; the canvas transform (`fit` + pan/zoom `k,tx,ty`) scales that
space into the pane, so nothing re-projects on pan.

Interaction parity with the old map is preserved: tap a province (empty of
markers) toggles the region filter (`ctx.isPointInPath` hit-test); tap a
single-offer marker opens the detail popup ("View details" → `onListingSelect`);
list-row hover (`highlightedId`) lifts the matching marker's chip. New:
tap pins a marker's full line at any zoom; +/- buttons zoom (bottom-left).

## Files

| File | Role |
|---|---|
| `src/components/exchange/ExchangeMap.tsx` | Rewritten: MapLibre → Canvas renderer. Same exports/props. |
| `public/geo/bg-map-geometry.json` | New. Projected oblast paths + outline + projection params. |
| `messages/{en,bg}.json` | New `exchangeMap.zoomIn` / `zoomOut` keys (zoom-button aria-labels). |

## Decisions

- **Aggregate key is `region·crop·side`, positioned at the offers' centroid.**
  Real offers carry `lon/lat` but no "city", so the prototype's per-city
  grouping maps to per-region here. On split (zoom) offers pop to their true
  coords; only offers sharing an exact projected point get fanned apart.
- **Best is one national winner per crop, side-agnostic** — cheapest sell ask,
  or highest bid for a buy-only crop, ties broken by tonnage. Avoids a gold
  ring in every region and the sell/buy double-flag.
- **Progressive disclosure via two zoom thresholds** (`SPLIT_Z`, `LOC_Z`) plus
  a pin override — the chip text is composed from parts at draw time, so
  "reveal on tap" is just forcing every optional field on.
- **Label de-clutter is a greedy priority placement pass** (cartographer's
  trick): chips draw in `best > tonnage` order against a growing list of
  claimed rects; a collision fades the loser to 0.24 rather than stacking.
- **Imperative render, refs not state for the view transform** — pan/zoom
  mutate a `view` ref and call `drawRef.current()` directly, so dragging never
  triggers a React re-render. State is only `geom / status / pinnedId / popup`.
- **MapLibre stays a dependency** — it still backs the parcel/field `MapCanvas`.
  Only the Exchange overview drops it. `exchange-map-utils.ts`
  (`ExchangeMapListing`, `featureToMapListing`) is retained; the popup uses the
  listing objects directly.
- Supersedes the earlier `#187` MapLibre "gold-country / mask-gash" fix on this
  branch — that patched the MapLibre map this commit removes.
