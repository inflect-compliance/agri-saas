# 2026-06-19 — Phone-native operator map (feat/mobile-map)

**Commit:** `<pending>` feat(mobile-map): full-bleed map + thumb controls + geolocation + parcel bottom-sheet

## Design

The map is the field operator's primary screen, so the Location detail Map
tab and the offline field panel are now phone-native. The work splits three
ways:

1. **Reusable map controls + geolocation (`MapCanvas`).** Opt-in on-map
   thumb controls live in the bottom-right thumb zone — zoom ±, locate-me,
   and (stretch) a live-tracking toggle — each a ≥44px (WCAG 2.5.5) touch
   target. `showControls` gates them so every existing read-only/prescription
   mount is byte-for-byte unchanged. Geolocation is pure client
   (`navigator.geolocation`): `getCurrentPosition` flies to the device and
   drops a "blue dot" `<Marker>`; `watchPosition` (behind `liveTracking`)
   follows the device and draws a breadcrumb `LineString`, high-accuracy only
   while tracking and `clearWatch` on stop/unmount (battery-aware). Permission
   denial / unavailability surfaces a non-blocking `aria-live` hint — it never
   throws. `controlsBottomInset` lifts the stack clear of the fixed
   bottom-tab bar.

2. **Parcel bottom-sheet (`ParcelDetailSheet`).** On phones, tapping a parcel
   (on the map or a Parcels-tab card) opens a vaul bottom-sheet — built on the
   canonical `Sheet` primitive (`direction="bottom"`) — with area, crop, last
   application (graceful empty state, see Decisions), a pure-client apply-rate
   calculator (rate/ha × area), and "Start operation here" which launches the
   spray-job wizard seeded with that parcel. This replaces the old
   "scroll-way-down side list" on mobile; **desktop keeps its inline side
   panel** unchanged.

3. **Full-bleed layouts.** The Location Map tab renders the map edge-to-edge
   (`-mx-4`, near-viewport-tall) with no inline side panel on mobile; the
   `OfflineFieldPanel` map grows from a fixed 300px box to a full-width
   `60vh` map and is now **selectable** — tapping a parcel highlights its
   prescription line and scrolls it into view.

## Files

| File | Role |
|---|---|
| `src/components/ui/map/MapCanvas.tsx` | + `showControls`/`controlsBottomInset`/`liveTracking`; zoom/locate/track overlay; geolocation + blue-dot marker + breadcrumb |
| `src/components/ui/map/ParcelDetailSheet.tsx` | **new** — vaul bottom-sheet: area/crop/last-application + apply-rate calc + "Start operation here" |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | mobile full-bleed map (no side panel), parcel-tap + card-tap → sheet, NDVI toggle ≥44px |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/SprayJobWizard.tsx` | + `initialParcelIds` (seed selection on open) for "Start operation here" |
| `src/components/offline/OfflineFieldPanel.tsx` | full-width/taller selectable map; tap-parcel → highlight + scroll its line |
| `tests/e2e/mobile/map.spec.ts` | **new** `@mobile` — controls 44px, locate-me→dot, parcel sheet, start-operation→wizard |
| `tests/e2e/mobile-responsive.spec.ts` | Map-tab test updated for the new mobile layout (no inline panel; full-bleed + controls) |

## Decisions

- **`showControls` is opt-in.** MapCanvas is shared by the read-only operator
  view, the prescription panel, and the operator field-op view. Defaulting the
  controls off keeps those paths unchanged; only the two phone-primary surfaces
  pass `showControls`.
- **Geolocation is custom, not maplibre's `GeolocateControl`.** The built-in
  control renders a ~29px target and its own styling; the prompt requires 44px
  thumb targets and an explicit `getCurrentPosition` flow, so the control is a
  plain `<button>` driving the geolocation API directly (the existing Sheet
  close + bottom-tab use the same raw-button idiom; `icon-only-action-discipline`
  stays green via `aria-label`).
- **"Last application" is a graceful optional.** The Location parcels payload
  doesn't carry per-parcel application history, and joining it would mean a
  backend usecase/repository change (+ index/RLS guardrails) out of scope for a
  map-UX change. The sheet renders a tidy "No applications recorded yet" and
  exposes a `lastApplication` prop for when a per-parcel applications query
  lands. (Follow-up.)
- **The bottom-sheet opens from a parcel-card tap too.** Tapping the WebGL
  canvas at a parcel polygon is non-deterministic in CI, so the same sheet is
  reachable from the Parcels-tab card — a robust, meaningful path that the
  `@mobile` e2e drives.
- **`mobile-responsive.spec.ts` was updated, not just extended.** The mobile
  Map tab intentionally drops the inline "New spray job" side panel, so the old
  "panel stacks below the map" assertion no longer holds; it's replaced with
  full-bleed-width + on-map-control assertions.
