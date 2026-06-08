# Entra ID recorded fixtures

Redacted, real-shape samples captured from a **staging** Entra tenant during the
smoke verification in `docs/enterprise-sso.md`. They anchor the hermetic mocks
in `tests/helpers/entra.ts` to Microsoft's actual token / Graph shapes so a
future Graph-API drift fails CI instead of silently breaking production.

Files (currently seeded from Microsoft's **documented** shapes — no live capture
was available; replace each verbatim with a redacted real capture when one is,
per the EI audit/polish pass. Each carries a `_fixture_note` saying so):

- `memberOf-page.json` — a `GET /me/memberOf?$select=id` response page.
  Confirms `value: [{ "id", "@odata.type" }]` + the `@odata.nextLink` key.
- `overage-claim-names.json` — the `_claim_names` / `_claim_sources` block from a
  decoded ID token of a user in > ~200 groups (the overage marker).

`tests/unit/entra-recorded-fixtures.test.ts` runs both through the real parsing
code (`fetchUserGroupsFromGraph` + `resolveEntraGroupClaims`), so swapping in a
real capture that drifts from these shapes fails CI.

## Redaction rules (MANDATORY)

- Replace every GUID with a `0000…`-style placeholder (keep the 8-4-4-4-12 shape).
- **No access/bearer tokens, no client secrets, no user emails / names / UPNs.**
  These are live credentials / PII and would trip secret-scanning.
- Keep only the structural keys — the test asserts shape, not values.
