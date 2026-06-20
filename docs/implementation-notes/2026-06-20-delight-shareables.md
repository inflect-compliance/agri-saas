# 2026-06-20 — Shareables (feat/delight-shareables)

**Commit:** `<sha>` feat/delight-shareables — share cards, season PDF, QR codes, sound+haptic

## Design

Give farmers something satisfying to keep/show, and make field actions feel
solid. Four parts:

1. **Shareable cards** — a reusable `ShareableStatCard` chrome whose surface is
   captured to a 2× PNG (`html-to-image`) and shared via the native sheet
   (mobile) or downloaded (desktop). Three instances: season recap, field
   report, spray-job completion.
2. **"Year on the farm" PDF** — `getSeasonRecap` tenant aggregate +
   `generateYearOnFarmPdf` over the existing `src/lib/pdf/*` factory.
3. **QR codes** — zero-dep `qrcode-generator` rendered as an SVG; deep-links
   resolve via new `?parcelId` / `?lotId` query-param entry points.
4. **Sound + haptic** — a Web Audio tone paired with the existing `haptic()` at
   the mark-done sites, gated by a user toggle.

## Files

| File | Role |
|------|------|
| `src/lib/share-card.ts` | `exportShareCard` — DOM → 2× PNG → share/download |
| `src/components/ui/shareable-stat-card.tsx` | reusable card chrome + share button |
| `src/app/.../dashboard/SeasonRecapCard.tsx` | season recap card + PDF download |
| `src/app/.../locations/[locationId]/FieldReportCard.tsx` | field report card |
| `src/components/ui/map/SprayJobCompletionCard.tsx` | spray-job completion card |
| `src/app-layer/usecases/season-recap.ts` | `getSeasonRecap` aggregate |
| `src/app-layer/reports/pdf/year-on-farm.ts` | the PDF |
| `src/app/api/.../reports/{season-recap,year-on-farm}/route.ts` | JSON + PDF |
| `src/components/ui/qr-code.tsx` | SVG QR from `qrcode-generator` |
| `src/lib/sound.ts` | Web Audio feedback tones |
| `src/lib/feedback-prefs.ts` | sound/haptic toggle (localStorage readers) |
| `src/app/account/profile/FeedbackPrefsCard.tsx` | the toggle UI |

## Decisions

- **QR uses `qrcode-generator` (zero-dep MIT), not `qrcode`.** The popular
  `qrcode` package pulls pngjs/yargs into the lockfile — more audit surface.
  Zero deps keeps the security gate (`npm audit` MODERATE+) trivially green and
  needs no THIRD_PARTY_NOTICES entry (bundled npm carries its own LICENSE).
- **QR stays UI-only, not in the PDF.** `qrcode-generator`'s data-URL is a GIF;
  pdfkit only embeds PNG/JPEG. Drawing QR rects directly into pdfkit is the path
  if the PDF ever needs one — deferred.
- **Deep-links are query params on the existing pages**, not new routes — a
  parcel/lot has no standalone detail page; `?parcelId`/`?lotId` read on mount
  open the existing sheet/modal, reusing all the existing UX.
- **cost-per-ha is journal `costAmount` ÷ area, null when absent.** There's no
  input-cost model; this is the only honest cost signal, so the metric simply
  doesn't render when no journal entry carries a cost (rather than showing
  marketing revenue dressed up as cost).
- **Sound + haptic fire on the offline "queued" path, not just "sent".** Marking
  a parcel done is the satisfying moment a field operator wants confirmed —
  signal or not — so the feedback fires when the write is saved offline too.
- **Both gated by a call-time localStorage read** (`feedback-prefs`), mirroring
  celebrations.ts/coach-marks.ts, because `haptic()`/`playSound()` run outside
  React; the toggle UI writes the same keys via `useLocalStorage`.
- **Share cards capture token backgrounds**, so the exported image adapts to the
  active theme and stays self-contained.
