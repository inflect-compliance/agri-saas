# 2026-07-21 — Promotion leads: consent, encryption, and RLS

**Commit:** _(this PR)_ `feat(promotions): consent, encryption and RLS for promotion leads`

Prompt B of the promotions roadmap, **scoped to the gaps**. B4 (lead delivery)
is deliberately NOT here — see "Scope" below.

## Scope: why B1–B3 only

While Prompt A was in review, a parallel sequence landed the `Company`
catalogue, and its note states its own plan: *"no admin UI, no image pipeline,
no lead digest — those depend on this shape being right."* It also records the
chosen delivery design (a digest job emailing the advertiser's `contactEmail`)
and defers `deliveredAt` to that PR.

B4 as originally written (an admin lead surface plus a farmer-facing "My
requests" view) would have duplicated that work and contradicted a design
already committed to in the schema. So this PR takes the three subpoints that
are genuinely unclaimed — and which are the security half:

| | |
|---|---|
| **B1** consent | ✅ here |
| **B2** encryption + retention | ✅ here |
| **B3** RLS | ✅ here |
| **B4** delivery | ⛔ owned by the digest PR |

The three shipped together in one migration because they reshape the same
table, and splitting them would have meant three windows in which the table is
still readable cross-tenant.

## The defect that mattered most

`PromotionLead` was **outside the RLS ratchet, silently**.

`tests/guardrails/rls-coverage.test.ts` builds its inventory from models that
have a `tenantId` column. `PromotionLead` keys on `inquirerTenantId` — a plain
FK, deliberately not an RLS column — so it never entered that inventory. The
result: a table holding one tenant's contact PII, readable by any tenant's
session, invisible to the guard whose entire job is to catch that.

It now sits on a third, explicitly-registered axis, alongside the existing
`ORG_SCOPED_MODELS` precedent:

```
tenantId axis        → tenant_isolation (+ _insert)      ← the ratchet's inventory
app.user_id axis     → org_isolation / …_self_isolation  ← ORG_SCOPED_MODELS
inquirerTenantId     → promotion_lead_inquirer_isolation ← CROSS_TENANT_SCOPED_MODELS (new)
```

The policy is **symmetric** — `USING` and `WITH CHECK` are both the strict
own-tenant predicate. Unlike `UserSession`'s deliberately asymmetric shape,
there is no nullable-row case to read permissively here (`inquirerTenantId` is
`NOT NULL`), and a `USING`-only policy would still allow a session to *write* a
row attributed to another tenant. The integration test asserts exactly that
(re-attributing an own lead to another tenant must fail).

## Consent

`consentedAt` is `NOT NULL`. That is the point: the column IS the enforcement,
not a flag beside it. A lead without recorded consent is one we may not lawfully
forward, so it must be unrepresentable rather than merely discouraged.

Enforced at two levels on purpose:

- `z.literal(true)` at the HTTP edge — an omitted or `false` consent is a schema
  error, not something the usecase must remember to check.
- an explicit re-check in `createPromotionLead`, because the usecase is
  reachable from jobs and future callers that never pass through that schema.

The migration adds the column **nullable, backfills, then tightens**. Production
holds zero leads, but a bare `NOT NULL` would fail on any populated dev/demo
database. Existing rows backfill from `createdAt` — the honest reading is
"consent unrecorded at this time", and retention ages them out.

### The privacy link

The consent notice names the company and states plainly what is shared. The
**link** is rendered only when `NEXT_PUBLIC_PRIVACY_URL` is configured.

This app ships **no privacy page** — I checked; there is no such route and no
legal URL anywhere. Hard-coding `/privacy` would have shipped a 404 from the
very consent notice meant to inform the farmer, which is the same class of
broken promise Prompt A existed to remove. The notice carries the substance
regardless; the link appears when an operator has something real to point at.

**Carry-over: there is no privacy policy page.** Consent is recorded and the
notice is accurate, but a deployment that wants the link must set the env var.

## Encryption, and the key it uses

`PromotionLead: ['requestMessage']` joins the Epic B manifest. The message routinely
names the farm, the field and what they are short of, and exists to be forwarded
to a third party.

**It is NOT in `GLOBAL_KEK_MODELS`, and that is the load-bearing decision.**
`Company`'s contact fields are global-KEK because support writes them while
operating inside the platform tenant. A lead is the mirror image: the farmer's
own words, written in the farmer's tenant context, so it encrypts under *that
tenant's* DEK and keeps per-tenant key isolation. Adding it to the global set
would bind one tenant's PII to a key the whole platform can read — precisely
the trap the `Company` note warns against for tenant-scoped models.

### The field is `requestMessage`, not `message` — and that is load-bearing

The first attempt added `PromotionLead: ['message']` and **broke an unrelated
test**: a `Notification.message` came back as `v1:…`.

Cause: the middleware's fan-out ENCRYPT path (`encryptDataNodeAllModels`, used
when a nested write's target model is structurally unknown) matches keys against
`ALL_ENCRYPTED_FIELD_NAMES` — a FLAT set across the whole manifest. It cannot
tell which model a key belongs to. The DECRYPT fan-out is safe by construction
(a plaintext value has no `v1:` prefix, so it is skipped); **the encrypt fan-out
has no equivalent guard.**

`message` is carried by `Notification`, `ExchangeInquiry` and `InsuranceLead` —
none encrypted. So the generic name wrote ciphertext into unrelated columns.
CI caught it **twice, independently**: the automation suite failed on a
`Notification.message` coming back as `v1:…`, and the `exchange-two-sided` E2E
failed on the inquiry flow (`ExchangeInquiry.message`). `InsuranceLead.message`
had nothing watching it at all — it would have corrupted silently.

Fix: a model-unique Prisma field name, with `@map("message")` keeping the
physical column so there is no data migration.

**Wider finding, not fixed here.** The repo has ~248 such name collisions
already (`description` on 182 models, `notes` on 54). They are evidently
tolerated because the fan-out path is rare — the app would be visibly broken
otherwise. I deliberately did NOT ship a ratchet over them: a 248-entry baseline
that churns whenever any model gains a `description` would be noise implying a
severity the codebase's own behaviour contradicts. What ships instead is a
narrow test pinning the specific hazard (`message` must never enter the
manifest). **Worth a separate look:** whether the fan-out encrypt path should
gain a model check, which would retire the whole class.

**Consequence, deliberate and inherited by the digest PR:** a reader outside the
inquiring tenant cannot decrypt a lead. The digest job must group leads by
`inquirerTenantId` and resolve each tenant's context before reading `requestMessage`.
That is more work than a global key, and it is the correct trade.

## Retention

`deletedAt` + `@@index([deletedAt, createdAt])` so a sweep can find undeleted
leads past the window without a scan. **The sweep itself is not wired here** —
soft-delete is the mechanism, and the schedule belongs with the digest PR that
first gives leads a lifecycle beyond "created". Documented as a carry-over
rather than shipped as a column with no reader.

## Files

| File | Role |
|---|---|
| `prisma/schema/promotions.prisma` | `consentedAt` (NOT NULL), `deletedAt`, retention index |
| `prisma/migrations/20260721090000_promotion_lead_consent_rls/` | columns + backfill + RLS policies |
| `src/lib/security/encrypted-fields.ts` | `PromotionLead: ['requestMessage']` (model-unique — see above) |
| `src/app-layer/schemas/promotions.schemas.ts` | `consent: z.literal(true)` |
| `src/app-layer/usecases/promotions.ts` | consent gate + `consentedAt` at creation |
| `offers/AskForOfferModal.tsx` | consent checkbox, privacy notice, conditional link |
| `src/env.ts` | optional `NEXT_PUBLIC_PRIVACY_URL` |
| `tests/guardrails/rls-coverage.test.ts` | `CROSS_TENANT_SCOPED_MODELS` + assertions |
| `tests/integration/promotion-lead-rls.test.ts` | cross-tenant read/insert/update denial + bypass |

## Decisions

- **One migration, not three.** Splitting would leave the table cross-tenant
  readable between them.
- **`z.literal(true)`, not `z.boolean()`.** Declining is not a variation of the
  request; it is not a request we may act on.
- **Symmetric policy.** `inquirerTenantId` is NOT NULL, so the asymmetric
  nullable-tenant shape used by `UserSession` would only widen the write path.
- **Per-tenant DEK over global KEK**, accepting that the digest must resolve
  tenant context — isolation is worth more than reader convenience.
- **The privacy link is conditional.** A hard-coded link to a page that does not
  exist would repeat the defect this roadmap is removing.
