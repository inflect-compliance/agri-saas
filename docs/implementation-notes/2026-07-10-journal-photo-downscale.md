# 2026-07-10 — Downscale camera photos before journal upload

**Commit:** `<sha>` feat(journal): downscale camera photos before upload (rural LTE)

## Design

Field operators shoot 8–12 MP camera photos (8–12 MB JPEGs) and upload them
from the journal Photos tab over flaky rural LTE. The raw `File` was streamed
straight into a multipart POST. Now the capture path runs it through a
client-side downscaler first:

```
onPhotoCaptured / onFileChosen → uploadFile(file)
   preview: URL.createObjectURL(file)      # original, instant, offline-safe
   upload:  downscalePhoto(file) → FormData # ~2000px / JPEG 0.85, a few hundred KB
```

`src/lib/image/downscale-photo.ts` is deliberately separate from the avatar
`resizeImage` (`src/lib/resize-image.ts`): the avatar helper **cover-crops**
to fixed dimensions for a square/OG thumbnail; a journal photo must keep its
**full frame and aspect ratio** (it's evidence), so this one only scales the
long edge down to a cap. EXIF orientation is baked in via
`createImageBitmap(file, { imageOrientation: 'from-image' })` so a portrait
phone photo isn't silently rotated.

## Files

| File | Role |
|---|---|
| `src/lib/image/downscale-photo.ts` | canvas downscaler — long-edge cap, aspect preserved, JPEG re-encode |
| `src/app/t/[tenantSlug]/(app)/journal/[id]/JournalPhotosTab.tsx` | calls `downscalePhoto` before `FormData.append`; preview still uses the original |
| `tests/unit/downscale-photo.test.ts` | jsdom unit tests (large shrinks, small/non-image/throw/no-gain all pass through) |

## Decisions

- **Fail-open, always.** Every non-happy path returns the ORIGINAL `File`,
  never throws: non-images (a PDF attachment) skip; an image already within
  the 2000 px cap skips (no needless recompression / quality loss); a
  re-encode that isn't actually smaller is discarded; and any
  canvas/`createImageBitmap` failure (old browser, decode error) falls back to
  the original. A downscale hiccup must never block a field upload.
- **2000 px / 0.85.** Plenty of detail for an agronomy record while cutting a
  10 MB capture to a few hundred KB — the win that matters on 1-bar LTE.
- **Scope.** Only the journal capture path is wired. The avatar/OG
  `resizeImage` path is untouched (different contract — crop, not fit).
