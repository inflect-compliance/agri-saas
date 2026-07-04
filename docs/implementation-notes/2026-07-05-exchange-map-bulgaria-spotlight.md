# 2026-07-05 — Exchange map: Bulgaria-only dark spotlight

**Commit:** `<pending> feat(exchange): Bulgaria-only dark spotlight map`

## Design

The Exchange marketplace map was a light `streets-v2` basemap showing
Bulgaria *and* its neighbours, on a dark app UI. Reworked into a
Bulgaria-only, dark, commercial map:

- **Basemap:** MapTiler `dataviz-dark` — minimal, label-light, on-brand
  with the dark UI so the SELL/BUY markers are the focal point.
- **Spotlight mask:** a single GeoJSON polygon whose outer ring is a
  generous world rectangle and whose **holes are the 28 oblast outer
  rings** (`buildMask`), filled with a dark navy scrim at 0.72 opacity.
  Result: everything outside Bulgaria is dimmed; only the country is lit.
  Oblast border lines are drawn on top, hiding any hairline seams between
  adjacent holes (geoBoundaries ADM1 is not guaranteed topologically
  clean, so a per-oblast hole mask can leave slivers — the borders cover
  them). This avoids needing a dissolved single-outline artifact (no
  turf/shapely available in the toolchain).
- **Locked view:** `maxBounds` cages panning to a tight box around
  Bulgaria, `minZoom` stops zoom-out to Europe, `dragRotate={false}`.
  The mask dims the small neighbour slivers that the padding still admits.
- **Regions:** oblast fill is a quiet wash by default, brand-emerald when
  filter-selected; click toggles the region filter (unchanged behaviour).
- **Markers:** added a soft `circle-blur` glow halo under each single
  offer; clusters unchanged.

The oblast geometry (`/geo/bg-oblasti.geojson`, geoBoundaries CC-BY-4.0)
is fetched **once** in the component and feeds both the region layer and
the mask, instead of the previous declarative URL source.

## Files

| File | Role |
| --- | --- |
| `src/components/exchange/ExchangeMap.tsx` | Dark style, runtime spotlight mask, locked view, glow markers |

## Decisions

- **Runtime per-oblast mask, not a build-time dissolved outline.** The
  toolchain has no polygon-union lib (`@turf/bbox` only; pip/venv locked
  down). Per-oblast holes + borders-on-top is robust enough and needs no
  new dependency or committed artifact. If seams ever show, a dissolved
  `bg-outline.geojson` can replace the holes later with no API change.
- **Trimmed the `<Map>` prop set to the props certain to be typed in
  react-map-gl v8** (`maxBounds` / `minZoom` / `maxZoom` / `dragRotate`).
  `renderWorldCopies` / `pitchWithRotate` / `touchZoomRotate` were dropped
  to avoid a typecheck failure that couldn't be caught locally (this env's
  `node_modules` is unusable); `maxBounds` already prevents world-wrap and
  keeps neighbours out of frame.
- **Mask opacity / scrim colour (0.72, `#060a14`) are visual guesses** —
  tuned blind (no local render). Worth a look-see after deploy; trivially
  adjustable constants at the top of the file.
