# 2026-06-08 — Entra ID Provider Hardening & Group Claims (EI-1)

**Commit:** `<sha>` feat(auth): Entra ID group claims in the JWT + provider config

## Why

Foundation for the Entra-group → IC-role mapping roadmap (EI-2/EI-3). Microsoft
sign-in worked, but the user's AAD security-group membership never reached the
IC token pipeline — so group-based role assignment had no input. EI-1 makes
`token.aadGroups` reliably populated at sign-in.

## What

- **`IdentityProviderType.ENTRA_ID`** (+ migration) — distinct from generic OIDC
  so the group-sync + SCIM paths gate on the type without inspecting config.
- **JWT extraction** (`auth.ts` `jwt` callback) — on `microsoft-entra-id`
  sign-in, reads `profile.groups` → `token.aadGroups`. **Overage path:** users
  in >200 groups get `_claim_names.groups` instead of `groups`; detect it and
  fetch the full list from Graph `/me/memberOf` using the issued access token
  (`token.aadGroupsOverage` telemetry flag). JWT module augmentation carries
  both fields; zero `as any` (auth-stack-pinning clean).
- **`entra-graph.ts`** — `fetchUserGroupsFromGraph` (cursor pagination + dedup +
  fail-open) and `lookupGroupFromGraph` (display-name resolution). Pure, a
  single injectable `fetchImpl` — exhaustively unit-tested without network.
- **`EntraProviderConfigSchema`** — `aadTenantId`/`clientId` (uuid),
  `groupClaimMode`, `enforceGroupGate`, `allowedDomains`. Stored in
  `TenantIdentityProvider.configJson` (type ENTRA_ID) via the
  `entra-provider` usecase + admin-gated `/api/t/[slug]/sso/entra` route.
- **AzureAD scope** — added `GroupMember.Read.All` so the overage Graph call has
  a usable access token. (The `groups` ID-token claim itself is governed by the
  tenant's App Registration Token Configuration, which IC cannot set — the
  wizard documents this.)
- **`admin/entra` wizard** — App-registration/token-config instructions + the
  provider config form.

## Decisions

- **Repo uses `admin/`, not `settings/identity/`** (the roadmap's path) — the
  wizard lives at `admin/entra` alongside `admin/sso`, matching the actual nav.
- **Fail-open everywhere on the Graph path** — a Graph outage resolves to `[]`
  and never blocks sign-in. Group-driven role *changes* are EI-2's concern;
  EI-1 only supplies the raw list.
- **Full jwt-callback integration test deferred to EI-4 Part A** (the fixture
  library). EI-1 unit-tests the load-bearing pure pieces (Graph pagination +
  config schema) directly.
