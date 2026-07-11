# 2026-07-10 — Invite redemption for first-time users

**Commit:** `<sha> fix(invite): redeem in the jwt callback with the email-resolved User.id`

## Problem

A brand-new invitee (no prior Agrent account) who accepted a workspace
invite via Google landed on `/no-tenant` ("No access yet") — authenticated
but with no membership — and their invite link was dead.

## Root cause

Invite redemption ran in the NextAuth **`signIn`** callback, calling
`redeemInvite({ userId: user.id, … })`. For a **first-time** OAuth user, the
`signIn` callback's `user.id` is the identity-provider subject (Google
`sub`), **not** our `User.id`: with the Prisma adapter, the `User` row is
created only *after* `signIn` returns. So:

1. `redeemInvite` step 1 committed `acceptedAt` → **the invite was burnt**.
2. Step 4 upserted `TenantMembership` with `userId = <google sub>`.
   `TenantMembership.user` is an FK to `User.id`; no such row existed →
   **FK violation → the transaction threw**.
3. `ensureTenantMembershipFromInvite` **swallowed** the error (sign-in must
   not fail) → the user proceeded with no membership → `/no-tenant`, with an
   invite that could no longer be redeemed.

Returning invitees dodged the bug only because the `signIn` account-linking
branch resolved their *real* id by email. Every integration test
pre-created the user and passed a real `user.id`, so the production ordering
(id = subject, row not yet created) was never exercised.

## Fix

Move redemption to the **`jwt` callback**, which fires *after* the adapter
persists the `User` row. New module
`src/lib/auth/invite-redemption.ts::redeemPendingInvites` resolves the
persisted `User.id` **by email** (`hashForLookup`), then redeems — for OAuth
and credentials alike. It runs *before* `applyMembershipClaims`, so the
fresh membership is in the token on the same sign-in and the user lands
straight in the tenant. The `signIn` callback keeps only account-linking;
its two redemption call-sites are removed.

## Files

| File | Role |
|------|------|
| `src/lib/auth/invite-redemption.ts` | New — `redeemPendingInvites`, resolves id by email, best-effort, never throws |
| `src/auth.ts` | Removed `ensure*FromInvite` helpers + redemption from `signIn`; wired `redeemPendingInvites` into the `jwt` initial-sign-in block |
| `tests/integration/invite-redemption-new-user.test.ts` | New — the previously-uncovered first-time-user path + a test proving the old (non-persisted id) path creates no membership |
| `CLAUDE.md` | Access-control section updated: redemption is in the `jwt` callback, resolved by email |

## Decisions

- **Resolve by email, not by a passed id.** The id is the whole problem; the
  email is the invite's binding key and is stable across the
  subject-vs-`User.id` gap. `applyMembershipClaims` already resolves the
  user by email, so this is consistent.
- **Keep the swallow semantics.** A redemption/mail failure must never fail
  sign-in; `redeemPendingInvites` logs and returns. The regression test
  asserts an email mismatch resolves (does not throw).
- **Burn-on-claim retained.** Step 1's standalone `acceptedAt` commit (leaked-
  token protection) is unchanged; once the id is correct, redemption
  succeeds on the first attempt so the burn is no longer a foot-gun.
- **Recovery for already-stranded users:** re-invite them. Their `User` row
  now exists, so the next sign-in redeems cleanly.
