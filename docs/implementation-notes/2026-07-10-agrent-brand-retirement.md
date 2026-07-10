# 2026-07-10 — Agrent brand retirement (infra + PWA identity)

**Commit:** `<sha> chore(brand): retire the inflect brand from infra strings + PWA home-screen`

## Design

The in-app visual rebrand landed earlier; this closes the gaps a mobile-first
user actually keeps — the installed-PWA identity — plus the safe internal
strings and the outbound-webhook wire contract.

The guiding rule for the ~470 `/inflect/i` occurrences: **rename only what is
safe to rename; baseline the load-bearing survivors with a reason.** Renaming
a storage-key prefix, an encryption salt, a cookie name, or a queue name would
break real state (persisted prefs, decryption of existing ciphertext, in-flight
invites, queued jobs), so those stay and are documented in the ratchet.

## Files

| File | Role |
|------|------|
| `public/icon.svg` | Regenerated — the Agrent seedling in metallic gold on the dark shell (was the green AgriSaaS mark) |
| `public/icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | NEW — PNG set rendered from the SVG (iOS ignores SVG manifest icons) |
| `public/manifest.webmanifest` | name/short_name → Agrent; theme_color → dark shell `#0b1220`; PNG icon entries |
| `src/app/layout.tsx` | apple-touch-icon + `themeColor` metadata |
| `public/sw.js` | CACHE_VERSION bump (`agri-v2`→`agrent-v1`) so installed clients re-precache the new icon; push-notification title rebrand |
| `src/lib/redis.ts` | connection names `inflect-app`/`inflect-worker` → `agrent-*` |
| `src/components/processes/ProcessPalette.tsx` | drag MIME `x-inflect-process-step` → `x-agrent-process-step` (both sides in-repo) |
| `src/env.ts`, `src/lib/mailer.ts` | SMTP_FROM default → `noreply@agrent.bg`; prod WARN when running on the built-in default sender |
| `src/app-layer/events/webhook-headers.ts` | Dual-emit `X-Agrent-*` alongside legacy `X-Inflect-*` (gated by `AUDIT_STREAM_LEGACY_HEADERS`, default on) |
| `src/app-layer/automation/action-executor.ts` | inline `X-Inflect-Signature` routed through `buildOutboundHeaders()` |
| `src/app-layer/ai/llm-client.ts`, `web-push.ts`, `messages/{en,bg}.json` | user-facing brand strings → Agrent |
| `tests/guards/no-legacy-brand.test.ts` | NEW ratchet — scans src/deploy/messages/public for `/inflect/i` + stale AgriSaaS manifest name |

## Decisions

- **Dual-emit, don't rename, the wire headers.** Tenant SIEMs consume
  `X-Inflect-Signature` / `-Batch-Id` / `-Idempotency-Key`. Renaming unilaterally
  breaks them, so `X-Agrent-*` is emitted ALONGSIDE with identical values;
  `AUDIT_STREAM_LEGACY_HEADERS=0` drops the legacy set once consumers migrate.
  Both call sites (audit-stream + action-executor) go through the one
  `buildOutboundHeaders`.
- **theme_color is the dark shell, not gold.** The app is `data-theme="dark"`
  by default; a gold status bar would fight the shell. Gold (`#D4AF37`) is the
  ACCENT in the mark, `#0b1220` is the chrome — cohesive install.
- **Survivor categories are load-bearing, not laziness.** Storage keys
  (`inflect:`), cookies (`inflect_*`), encryption salts/HKDF-info
  (`inflect-data-*`), queue names (`inflect-soil`), OTel resource names, and the
  legacy headers all break real state if renamed. The ratchet allowlists each
  with the reason; new un-reasoned refs fail CI (self-tested).
- **VM paths + GHCR org are NOT scripted-renamed** — operator-side, covered by
  the migration note added to CLAUDE.md §Production VM in the deploy-provenance
  PR (Roadmap-5 PR2).
- **CACHE_VERSION bump is required, not cosmetic** — the SW precaches
  `icon.svg`; without the bump, installed clients keep the old green mark until
  their cache expires. The `activate` handler deletes non-matching caches.
