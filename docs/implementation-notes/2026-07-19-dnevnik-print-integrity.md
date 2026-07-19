# 2026-07-19 — ДНЕВНИК print integrity (right data, right columns) + ratchet

**Commit:** see PR — `fix(dnevnik): print integrity for the БАБХ diary + structural ratchet`

## Design

The БАБХ diary generator (`src/app-layer/reports/pdf/farm-record-diary.ts`)
is the legally-filed record; a July 2026 audit found three "wrong data"
classes in its observation section:

1. **Soft-deleted rows printed.** The OBSERVATION query filtered
   tenant + period only — a deleted (mistaken) entry still printed in the
   legal register. Fixed with `deletedAt: null`. The cert-snapshot query
   deliberately KEEPS soft-deleted `INPUT_APPLICATION` entries (sentinel
   `diary-allow: soft-deleted`): the spray line prints from
   `OperationParcel` regardless, and the certs frozen at completion are
   more accurate than a live-membership fallback.
2. **Wrong-field rows printed.** Observations were tenant-wide, so field
   B's scouting printed in field A's per-field register. Now: entries
   linked (via `LogLocation`) to another location are excluded; entries
   with no location link are farm-wide notes and stay included.
3. **Raw HTML in a printed cell.** `notes` are sanitized *rich-text HTML*
   (Epic C.5); they printed verbatim (`<p>` tags) in the „Болест" column.
   New `htmlNotesToPlainText` (block boundaries → spaces, then the shared
   `sanitizePlainText` strip+decode, then whitespace collapse) flattens
   them; blank → `null` → empty cell. `title` is already plain at the
   usecase boundary and passes through unchanged.

Also: the silent `take: 100` became the named, documented
`MAX_OBSERVATION_ROWS = 500` — a legal register must not quietly truncate.

## The ratchet

`tests/guardrails/farm-record-diary-integrity.test.ts` locks the three
invariants structurally, each with a mutation self-test:

- every `logEntry.findMany` in the generator filters `deletedAt: null`
  or carries the `diary-allow: soft-deleted` sentinel (and the
  OBSERVATION query specifically must be the *filtered* one);
- the „Болест" cell only receives notes through `htmlNotesToPlainText`;
- header↔cell agreement in count (11/12/5/12/4) **and meaning** — the
  builders' values are asserted under the official header *text*
  (product under „Употребено средство…", operator cert under
  „чл. 84, ал. 2", agronomist under „ал. 1", disease under „Болест",
  pest under „Неприятел"), so a column reorder must move header and
  builder together to stay green.

DB-backed proof in `tests/integration/farm-record-diary.test.ts`
(via the exported `gatherFarmRecordData`): live unlinked + this-location
entries print; soft-deleted and other-location entries don't; HTML
flattens. Runs in CI (skips without a DB, per the `DB_AVAILABLE` gate).

## Files

| File | Role |
|---|---|
| `src/app-layer/reports/pdf/farm-record-diary.ts` | filters + location scope + `htmlNotesToPlainText` + `MAX_OBSERVATION_ROWS` |
| `tests/guardrails/farm-record-diary-integrity.test.ts` | the ratchet (source scan + column pins + self-tests) |
| `tests/integration/farm-record-diary.test.ts` | DB proof of the gathering rules |
| `tests/pdf/farm-record-diary.test.ts` | `buildObservationRows` parity tests |

## Decisions

- **Cert snapshots survive entry soft-delete** (sentinel, not filter):
  frozen-at-completion certs describe the event; live fallback would be
  wrong-in-time. Revisit only if entry deletion comes to mean "the
  operation never happened" (it can't — operations live on
  `OperationParcel`).
- **Farm-wide (unlinked) observations print in every field's register**
  — best-effort inclusion beats silently dropping unlinked scouting
  notes; linking an entry to a field is what scopes it.
- **Sanitizer reuse over a new dependency**: `htmlNotesToPlainText`
  wraps the existing `sanitizePlainText` rather than adding an
  html-to-text package; the only extra behavior needed was block-level
  spacing.
