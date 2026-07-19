# 2026-07-19 — Rent: one lease form, landlord PII, permission gating

**Commit:** `<pending>` feat(rent): shared lease form, lessor PII encryption, permission gating

## Design

Roadmap prompt C of 3 — the last of the rent/lease series.

1. **One form definition.** The Rent modal and `<ParcelLeasePanel>` each had
   their own `FormState`, `EMPTY_FORM`, `toYMD`/`parseDate` and validation, and
   they had drifted (different placeholders, different validation, one rendered
   dates via `formatDate` and the other via `.slice(0,10)`). Both now render the
   shared `<LeaseFormFields>`.
2. **The form is finished.** `lessorEik` and `notes` were already persisted and
   sanitised server-side but had **no inputs on either surface** — the ЕИК column
   in the CSV/PDF was structurally blank for Rent-page leases. Both are now real
   fields.
3. **Read-only users see read-only UI.** RentClient took no permissions at all
   (its server page fetched the context and discarded it), and the payments
   panel was mounted with a hardcoded `canWrite`.
4. **Landlord PII is encrypted at rest** — and the rent roll survived it.
5. **One Bulgarian term** for the counterparty.

## The encryption → aggregation consequence (the hard part)

`lessorName` / `lessorEik` joined the Epic-B manifest. That broke the rent roll,
because `getRentRoll` grouped by those columns in **raw SQL**, and:

- raw SQL bypasses the decryption client extension entirely (it's a
  `$allModels` query extension — `$queryRaw` is client-level), so the columns
  would come back as `v1:`/`v2:` ciphertext; and
- AES-GCM is **randomised**, so two leases from the same landlord produce
  *different* ciphertexts — `GROUP BY "lessorName"` would emit one group per
  lease instead of one per landlord, inflating `lessorCount` to
  `activeLeaseCount` and fragmenting every per-lessor row.

So the aggregation moved out of SQL into the usecase, over rows Prisma has
decrypted. Both queries moved (the `expiringSoon` one also selects the lessor —
easy to miss, it's a separate statement).

**That makes the fetch bound a correctness bound, not a page size.** Aggregating
a truncated set would silently under-report totals — worse than the old
behaviour. So the roll reads one row past `ROLL_LEASE_CAP` (2000), reports
`truncated` + `leaseCap` in its payload, and the Rent page says *"Showing the
first N leases — totals cover these only."* A loud partial beats a quiet lie.

The existing integration test is the proof: `lessorCount === 1` across three
leases in two units, per-unit lease counts, per-unit totals and payment
settlement all still hold **with encryption active** — i.e. totals parity
before/after, which is what the prompt asked for.

## Decisions

- **ЕГН: policy, not a column.** No `lessorEgn` field was added. The lease
  counterparty is identified by name + (for legal entities) ЕИК; adding a
  personal-ID column would invite operators to enter ЕГН where a company ID
  belongs. The ЕИК field carries an explicit hint — *"9 or 13 digits — legal
  entities only"* — steering personal IDs out of the free text, and `lessorName`
  is encrypted regardless. Existing precedent (`FarmProfile.egn`) keeps ЕГН on
  the tenant's OWN profile, where it's legally required for the ДНЕВНИК, not on
  third parties.
- **No `lessorKey` hash column.** A deterministic HMAC (the `User.emailHash`
  pattern) would have kept grouping in SQL, but it needs a new column, a
  backfill and a middleware seam — and app-layer grouping over a bounded,
  explicitly-reported set is simpler and honest. If the roll ever outgrows the
  cap, the hash column is the next move.
- **Bulgarian term: „Собственик".** The fork was „Арендодател" vs
  „Наемодател" — but `LeaseKind` is *already* ARENDA **or** NAEM and is labelled
  per row, so either choice mislabels half the register. „Собственик" is correct
  under both, it's what the existing placeholder already reached for („Име на
  собственика/арендодателя"), and it matches the cadastral owner — usually the
  same person. Applied across the table column, modal label, card, CSV and the
  hardcoded PDF headers. English keeps **"Lessor"**, which is already
  kind-neutral in English (there's no аренда/наем split to encode).
- **`documentRef` is gear-toggleable, default-off** — operators scan by owner
  and parcel; contract numbers are a lookup, not a scan. Adding the gear
  retired RentClient's stale `columns-dropdown-coverage` exemption.
- **The location chip reads the parcel catalogue, not `leases[0]`** — off a row
  it vanished exactly when the location had no leases, which is when it matters
  most. The parcel picker is now scoped to the active location filter too.

## Files

| File | Role |
|------|------|
| `src/components/agro/LeaseFormFields.tsx` | **New** — the one field set + `EMPTY_LEASE_FORM`, `toYMD`/`parseDate`, `leaseToForm`, `leaseFormToBody`, `validateLeaseForm`. Adds ЕИК + notes. |
| `.../rent/RentClient.tsx` | Consumes the shared form; permission-gated create/Fab/row-click/actions/delete; documentRef gear column; truncation hint; location chip + scoped parcel options. |
| `.../rent/page.tsx` | Passes `permissions.canWrite` (previously discarded the context). |
| `src/components/ui/map/ParcelLeasePanel.tsx` | Consumes the shared form; local duplicate state/helpers deleted. |
| `src/lib/security/encrypted-fields.ts` | `ParcelLease: ['lessorName', 'lessorEik']`. |
| `src/app-layer/usecases/rent-roll.ts` | Aggregation moved from raw SQL to the usecase; `ROLL_LEASE_CAP`, `truncated`, `leaseCap`. |
| `messages/{en,bg}.json` | „Собственик" sweep + ЕИК/notes/truncation keys. |
| `src/app-layer/reports/pdf/rent-roll.ts`, `.../reports/rent-roll/route.ts` | Hardcoded Bulgarian headers unified to „Собственик". |
| `tests/guardrails/sanitize-rich-text-coverage.test.ts` | `ParcelLease` classified (the usecase already sanitises at `mapLeaseData`). |
| `tests/guards/columns-dropdown-coverage.test.ts` | Stale rent exemption removed. |
