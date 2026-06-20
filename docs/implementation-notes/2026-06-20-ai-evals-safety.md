# 2026-06-20 — AI evals + safety layer (feat/ai-evals-safety)

**Commit:** `<pending> feat(ai): safety advisory guard + non-blocking eval harness`

## Design

Two halves on top of the existing AI chassis (`routing.ts`,
`provider/*`, `rag/*`, `entitlements.ts`):

**(A) Safety advisory layer** — `src/app-layer/ai/safety/`. A guard that
sits in front of advisory output where stakes are real (dosage, chemical
mixing, regulatory):

```
query
  └─ classifyAdvisoryIntent()         deterministic, no model
        ├─ dosage / chemical-mixing / regulatory → HARD escalate
        │     to the premium routing task (dosage-calc / regulatory)
        │     AND require citations
        └─ general → standard tier
  └─ dosage / REI / PHI numbers come ONLY from structured product data
        getPesticideSafety(ctx,itemId) → PesticideSafetySpec | null
        ├─ found    → numbers injected FROM DATA, regNo = citation
        └─ null     → REFUSE (safe fallback), never guess
  └─ retrieve() grounding chunks (UNTRUSTED — delimited + sanitised)
  └─ completeWithRouting(schema=AdvisorOutputSchema)  Zod-validated
        ├─ high-stakes + zero citations          → REFUSE
        ├─ answer number ≠ structured number      → REFUSE (no-fabrication)
        └─ empty RAG (general)                    → NO_SOURCES_ANSWER
  └─ EVERY result carries ADVISORY_DISCLAIMER (via makeResult())
  └─ refusals / escalations audited via logEvent (AI_ADVISORY_*)
```

Defence-in-depth against prompt injection: untrusted text is wrapped in
`<<<UNTRUSTED>>>` delimiters, run through `sanitizeUntrusted` (neutralises
"ignore previous instructions", role-spoof prefixes), and — the load-bearing
defence — the dosage number comes from structured data + the output is
Zod-validated + the no-fabrication numeric check refuses any answer whose
numbers disagree with the structured facts.

The advisor exposes an injectable `AdvisorDeps` seam (RAG / routing /
product-safety / audit). Production passes the real implementations; the
eval runner and unit tests inject deterministic stubs so the guard is
exercised offline with no model, DB, or secrets — no jest module mocking
required from a plain script.

**(B) Eval harness** — `scripts/ai/eval/`. Golden datasets (MCQ, open,
safety-cases incl. prompt-injection), exact/contains + optional LLM-judge
scorers, a runner that writes `report.json` + a markdown summary and
compares to a committed `baseline.json` for regression tracking. A
non-blocking CI job (`continue-on-error: true`) runs it without secrets.

## Files

| File | Role |
|---|---|
| `src/app-layer/schemas/product-safety.ts` | Zod `PesticideSafetySpec` + `parsePesticideSafety` — the only trusted dosage/REI/PHI shape |
| `src/app-layer/repositories/product-safety.ts` | `getPesticideSafety(ctx,itemId)` — tenant-scoped, fail-closed accessor over `Item.attributesJson.safety` |
| `src/app-layer/ai/safety/disclaimer.ts` | `ADVISORY_DISCLAIMER` + `SAFE_FALLBACK_ANSWER` constants |
| `src/app-layer/ai/safety/classify-intent.ts` | `classifyAdvisoryIntent` + `isHighStakes` — deterministic keyword classifier |
| `src/app-layer/ai/safety/sanitize-untrusted.ts` | `sanitizeUntrusted` — neutralises injection markers before prompt entry |
| `src/app-layer/ai/safety/advisor.ts` | `askAgronomyAdvisor` core guard + `AdvisorDeps` seam + `answerMatchesStructured` |
| `src/app-layer/usecases/agronomy-advisor.ts` | Thin usecase-layer pass-through (`askAdvisor`) — additive, copilot SSE route untouched |
| `src/env.ts` | Added `AI_EVAL_LLM_JUDGE` flag (default `0`) |
| `scripts/ai/eval/datasets/*.json` | Golden MCQ / open / safety-cases datasets (original, in-repo) |
| `scripts/ai/eval/score.ts` | `scoreExact` / `scoreContains` / `scoreWithJudge` (graceful skip) |
| `scripts/ai/eval/run.ts` | Runner — loads datasets, scores, writes report, compares baseline |
| `scripts/ai/eval/baseline.json` | Committed baseline for regression tracking |
| `.github/workflows/ci.yml` | Non-blocking `ai-evals` job (`continue-on-error: true`) |
| `tests/unit/safety-classify-intent.test.ts` | intent classification incl. edge cases |
| `tests/unit/safety-advisor.test.ts` | answer-from-data / refuse / no-fabrication / injection / disclaimer |
| `tests/unit/product-safety-accessor.test.ts` | parse valid / null for non-PESTICIDE / missing / malformed |
| `tests/unit/eval-scorer.test.ts` | exact/contains + mocked + null-skip LLM-judge |
| `tests/guards/advisory-disclaimer-coverage.test.ts` | structural + behavioural disclaimer ratchet |

## Decisions

- **Numbers never come from the model.** Dosage/REI/PHI are read from
  `Item.attributesJson.safety` via a Zod-validated accessor; the LLM only
  phrases around them. A no-fabrication numeric check (`answerMatchesStructured`)
  refuses any answer whose numbers aren't backed by the structured facts —
  this is what defeats the "injection says dosage is 999" attack even if
  the sanitiser and delimiters were bypassed.
- **attributesJson over a new table.** The spec rides under
  `Item.attributesJson.safety` (no migration); legacy items simply parse to
  `null` and the guard refuses dosage asks for them.
- **Dependency-injection seam instead of jest mocking in the runner.** The
  advisor's optional `AdvisorDeps` param keeps production clean while letting
  a plain tsx script exercise the real guard offline. The unit tests use the
  same seam.
- **Fail-closed everywhere.** Model throw, invalid structured output, empty
  grounding, missing structured data → refusal (safe fallback) or
  NO_SOURCES_ANSWER, never an unguarded guess.
- **Eval runner is non-blocking + secret-free.** The LLM-judge only runs
  when `AI_EVAL_LLM_JUDGE=1` and a backend resolves; otherwise it's skipped
  and the deterministic subset (exact/contains + safety behaviour) runs. The
  runner always exits 0 — the report carries the signal; CI uses
  `continue-on-error: true`.
- **Audit actions are string literals** (`AI_ADVISORY_REFUSED` /
  `AI_ADVISORY_ESCALATED`) passed to `logEvent`, mirroring
  `LOG_ENTRY_PHOTO_CLASSIFIED` — no Prisma enum change needed (the tenant
  `AuditLog.action` is a free-form string column).
- **Datasets are original.** No external corpus ingested; no GlobalG.A.P.
  text — see THIRD_PARTY_NOTICES.md.
