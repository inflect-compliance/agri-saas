# 2026-06-09 — SharePoint integration audit & polish

**Commit:** `<sha>` chore(integrations): SharePoint audit/polish (SP-1..SP-5 follow-up)

## Why

Skeptical review of the complete SharePoint integration (SP-1..SP-5). Findings
triaged; the genuine correctness/security/UX issues fixed here, the overblown
ones discarded with rationale.

## Fixed

- **Delta-sync evidence proliferation (P1).** Change detection used `eTag`,
  which Graph bumps on *metadata* edits too — so a view/move could trigger a
  spurious re-import (a new evidence row). Switched to **`cTag`** (the content
  tag, falling back to `eTag` when absent) so only real content changes
  re-import. `cTag` is now stored in the sync mapping + on import.
- **`listChildren` cross-drive cursor (P2/sec).** A caller-supplied `pageUrl`
  is now rejected unless it targets the requested drive — a crafted nextLink
  can't redirect the browse to another drive.
- **`SharePointExportButton` render-phase side-effect (P3).** `void probe()`
  was called during render; moved to `useEffect` (React-correct, strict-mode safe).
- **Webhook observability (P3).** Dropped/malformed Graph notifications are now
  logged instead of silently `continue`d.
- **Evidence-detail "View in SharePoint" link (deferred from SP-3).** `getEvidence`
  now surfaces the SP source URL + sync status from the mapping; the evidence
  detail sheet renders a "View in SharePoint ↗" row for SP-sourced evidence.
- **Health query bound** lowered 5000 → 2000.

## Discarded (with rationale)

- **"Browse routes lack rate-limiting"** — false: tenant-scoped GETs are already
  edge-rate-limited via GAP-17 `API_READ_LIMIT`.
- **"OAuth state cookie parsing is fragile"** — the state is a UUID (no dots) and
  tenant slugs are kebab-case; the first-dot split + empty-string guard is sound.
- **Token-refresh optimistic lock + Graph subscription nonce** — over-engineering
  for short-lived, reusable-within-window tokens and a secret-`clientState`/
  stored-`spSubscriptionId` model. Documented as known limitations below.

## Known limitations (documented, not bugs)

- **Concurrent token refresh** can momentarily race two refreshes; both tokens
  work for the window, and the worst case is one extra refresh — acceptable.
- **Webhook replay before unlink** is bounded by the secret `clientState` +
  the stored `spSubscriptionId` (cleared immediately on unlink). Graph
  notifications carry no signature beyond `clientState`.
- **Delta re-import creates a new evidence version row** (the mapping re-points
  to the latest). This is intentional version history; in-place file replacement
  is a possible future refinement.
- **Evidence-binary bundling (SP-5 export)**, **DOCX policy sync (SP-4)**,
  **sub-folder export targeting (SP-5)**, and **per-policy `spConnectionId`
  (SP-4)** remain documented follow-ups.

## Files

| File | Change |
| --- | --- |
| `providers/sharepoint/{types,import,client}.ts` | cTag change-detection + cross-drive cursor guard. |
| `app/api/webhooks/sharepoint/route.ts` | Log dropped notifications. |
| `usecases/evidence.ts` + `evidence/EvidenceDetailSheet.tsx` | "View in SharePoint" link. |
| `audits/packs/[packId]/SharePointExportButton.tsx` | `useEffect` probe. |
| `providers/sharepoint/health.ts` | Bound 5000→2000. |
