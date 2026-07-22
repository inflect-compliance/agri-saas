# 2026-07-21 — Promotions: artwork upload, scanning, and rendering

**Commit:** `<pending>` feat(promotions): promotion artwork with inline AV scanning

Third of the support-uploads-promotions sequence, after the `Company` data model
and the platform-support console. `Promotion.mediaUrl` has existed since #12
shipped and **nothing has ever written or rendered it**.

## The threat model is not the avatar's

Structurally this is `lib/account/avatar.ts`: a flat non-tenant storage key, a
client canvas round-trip that emits webp with EXIF already gone, and a server
that validates bytes rather than decoding them. `buildTenantObjectKey` is
deliberately unused — it requires a tenantId, and a promotion belongs to every
tenant.

But the content is different in a way that matters. An avatar is a user's own
photo shown to colleagues. **A promotion image is third-party artwork, emailed
to support by an outside company, rendered as an `<img>` in every tenant's
feed.** Both existing precedents fail that:

- **Evidence** uploads are scanned ASYNCHRONOUSLY and enforced at *download*
  time (`isDownloadAllowed`). An `<img>` in a feed never passes through that
  gate.
- **Avatars** are not scanned at all — no `FileRecord`, no `scanStatus`.

Copying either wholesale would have served unscanned, externally-sourced bytes
cross-tenant. So this path scans **inline, before the bytes are stored** — which
is affordable precisely because the volume is low: a handful of uploads a week
by support staff, not a bulk evidence pipeline.

### The accept/reject policy is borrowed, not invented

`scanVerdictBlocks` mirrors the existing `isDownloadAllowed` shape rather than
introducing a second policy vocabulary:

| verdict | strict | permissive | disabled |
|---|---|---|---|
| `INFECTED` | refuse | refuse | refuse |
| `ERROR` | refuse | store + warn | n/a |
| `CLEAN` | store | store | store |

`ERROR` is also what "ClamAV not configured" resolves to outside `disabled`
mode, so refusing under `strict` (the default) is the point: an operator who
has not wired up the scanner does not silently get an unscanned cross-tenant
upload path. It is extracted as a pure function so the policy is testable
without a storage backend or a live scanner.

Ordering is load-bearing and tested: every cheap rejection (empty / oversized /
not-webp) runs before the scan, so malformed uploads never occupy the scanner;
and the scan runs before the write, so refused bytes are never persisted.

## Why the client does the image processing

The canvas round-trip decodes, downscales to a 1200px longest edge, and
re-encodes as webp. Three things fall out of that, and only the first is
ergonomic:

1. It keeps realistic inputs inside the 512KB server cap. Support is uploading
   what a company emailed them, so a 12MP phone photo is a likely input.
2. **Re-encoding drops EXIF**, so camera metadata — including GPS — never
   reaches our storage at all, rather than being stripped after arrival.
3. It keeps image decoding out of the request path entirely. The server
   validates; it never decodes attacker-influenced bytes.

The server still re-checks the size and the RIFF/WEBP magic number. Non-webp
bytes are **refused rather than accepted**, because non-webp means the canvas
step was bypassed — so those bytes are unprocessed and may still carry EXIF.

## Serving

`GET /api/promotions/[id]/image`, deliberately NOT under `/api/t/[tenantSlug]/`.
The same image is shown to every tenant, so a tenant-scoped URL would be a lie
and would break the moment a second tenant rendered the same card. This mirrors
`/api/account/avatar/[userId]`, the existing non-tenant image route.

Auth is **any authenticated user** — the correct boundary rather than a lax one,
since the image is already visible to every signed-in user through the offers
feed. Anonymous access stays closed. A missing image 404s, which an `<img>`
treats as a load failure, so the card renders without artwork rather than with a
broken frame.

## Rendering

The offers card gets a fixed 64px `object-cover` thumbnail, hidden below `sm`
where the text needs the width more than the feed needs decoration. Fixed box +
`object-cover` means a badly-proportioned upload cannot stretch the row — every
card keeps the same rhythm whatever the source image. `alt` is empty on purpose:
the company and title sit immediately beside it, so announcing the image again
is noise to a screen reader.

## Decisions

- **Artwork attaches to a SAVED promotion.** The storage key derives from the
  promotion id, which does not exist until the draft is created. The field says
  so rather than showing a disabled control with no explanation.
- **The upload error surfaces the SERVER's message**, not a generic one — it is
  what distinguishes "too large" from "rejected by the malware scanner", and
  support needs to know which happened.
- **512KB cap, same as avatars.** A 1200px webp card image is ~40–150KB, so the
  ceiling is generous for the honest path while still bounding a
  canvas-bypassing client.
- **`Cache-Control: private, max-age=300`.** The key is deterministic per
  promotion, so a *replaced* image serves stale for the TTL; five minutes keeps
  that window short enough for a curation workflow.

## Follow-ups

- **Deleting a promotion does not delete its stored object.** `deletePromotion`
  refuses when leads exist and otherwise drops the row; the
  `promotions/<id>.webp` object is orphaned in storage. Harmless (unreachable
  without the row) but it accumulates — a sweep, or a delete hook, is the tidy
  fix.
- The image is not part of the drafts/publish gate: an unpublished promotion's
  artwork is still fetchable by id by any authenticated user who guesses it.
  Low-value content, but worth noting.
