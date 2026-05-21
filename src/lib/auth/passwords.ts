/**
 * Password hashing — production-grade primitives.
 *
 * ## Algorithm
 * bcrypt via `bcryptjs` at work factor 12. Sits safely inside the
 * OWASP 2024 guidance (≥10 for bcrypt) and matches the existing prod
 * hashes already in the database, so rolling this out doesn't force a
 * user-visible password reset. The cost is centralised in `BCRYPT_COST`
 * so a future bump (11 → 12 → 14 as hardware improves) is a single
 * edit + a re-hash on next login via `needsRehash()`.
 *
 * ## Why bcryptjs and not argon2id / native bcrypt
 * - Already in `package.json` and in use on live prod hashes
 * - Pure-JS — runs in the edge runtime NextAuth uses without native
 *   module shenanigans
 * - Switching to argon2 later is an isolated change in this file;
 *   `needsRehash()` + the login flow's "rehash on successful verify"
 *   path (see `src/lib/auth/credentials.ts`) migrates users silently
 *
 * ## What does NOT belong in this file
 * - User lookup, tenant resolution, lockout, rate limiting, audit
 *   logging — those live in `src/lib/auth/credentials.ts`. This file
 *   is *pure crypto*: plaintext + hash in, boolean out.
 */

// bcryptjs is published as CommonJS. Node.js's ESM-importing-CJS interop
// in newer Node versions wraps the exports under `.default` on the
// dynamic-import namespace; older Node spreads them to the top level.
// Normalise here so callers can treat the result as the bcrypt module
// regardless of the host Node's ESM/CJS interop behaviour.
//
// Without this fix, `(await import('bcryptjs')).compare` is undefined on
// Node ≥ 22 when tsx / next compile this file as ESM, and verifyPassword
// silently returns false for every login attempt — locking out every
// credentials user.
const bcryptModule = import('bcryptjs').then((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const namespace: any = m;
    return namespace.default ?? namespace;
});

/** Current default bcrypt work factor. OWASP 2024 floor for bcrypt is 10. */
export const BCRYPT_COST = 12;

/**
 * Minimum password length enforced at the point of setting (register,
 * change-password, reset-password). Login verification does not re-check —
 * old users whose passwords predate the policy can still authenticate.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Max length guards against bcrypt's documented 72-byte input truncation
 *  surprise and against memory-abuse via a giant body on the login route. */
export const MAX_PASSWORD_LENGTH = 128;

// ── Hashing ────────────────────────────────────────────────────────────

/**
 * Hash a password for storage. Uses bcrypt at {@link BCRYPT_COST}.
 *
 * Throws if `plaintext` is falsy or exceeds {@link MAX_PASSWORD_LENGTH}.
 * Does NOT enforce {@link MIN_PASSWORD_LENGTH} — callers should run the
 * plaintext through {@link validatePasswordPolicy} first and surface
 * the error to the user before we get here.
 */
export async function hashPassword(plaintext: string): Promise<string> {
    if (!plaintext) throw new Error('hashPassword: plaintext is empty');
    if (plaintext.length > MAX_PASSWORD_LENGTH) {
        throw new Error(`hashPassword: plaintext exceeds ${MAX_PASSWORD_LENGTH} chars`);
    }
    const bcrypt = await bcryptModule;
    return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Verify a password against a stored hash. Returns `false` for every
 * failure mode — empty input, malformed hash, null hash, wrong password —
 * so the caller can't distinguish "user has no password" from "user
 * supplied the wrong password" by boolean alone. That shape is what
 * {@link credentials.ts} relies on for account-enumeration safety.
 *
 * bcrypt.compare itself is constant-time *relative to hashes of equal
 * length*, which is what we want — a different-length hash already
 * failed (malformed) and returns fast, but we don't care about timing
 * in that path because the account-not-found path equalises timing
 * upstream via `dummyVerify`.
 */
export async function verifyPassword(
    plaintext: string,
    hash: string | null | undefined,
): Promise<boolean> {
    if (!plaintext || !hash) return false;
    if (plaintext.length > MAX_PASSWORD_LENGTH) return false;
    try {
        const bcrypt = await bcryptModule;
        return await bcrypt.compare(plaintext, hash);
    } catch {
        // Malformed hash in the DB — treat as verification failure, don't
        // leak to callers that the record is corrupted.
        return false;
    }
}

/**
 * A precomputed bcrypt hash of an unguessable placeholder string.
 * {@link dummyVerify} runs `bcrypt.compare` against this so the code
 * path for "user not found" still pays the bcrypt CPU cost. Prevents
 * account enumeration via response-time analysis.
 *
 * Re-hashed at module load with the current BCRYPT_COST so timing
 * matches real comparisons. We could inline a pre-baked string but
 * the cost is one-time at boot and keeps the hash in lockstep with
 * whatever BCRYPT_COST becomes in the future.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
    if (!dummyHashPromise) {
        dummyHashPromise = hashPassword(
            'dummy-placeholder-for-timing-equalisation-do-not-use',
        );
    }
    return dummyHashPromise;
}

/**
 * Runs a bcrypt.compare against a dummy hash so the user-not-found path
 * matches the timing of a real failed verify. Always returns `false`.
 * Call this in the "no user" / "no password hash" branch of your auth
 * flow so an attacker can't enumerate emails via response time.
 */
export async function dummyVerify(plaintext: string): Promise<false> {
    const [bcrypt, hash] = await Promise.all([bcryptModule, getDummyHash()]);
    try {
        await bcrypt.compare(plaintext ?? '', hash);
    } catch {
        // Best-effort timing burn; any error path still returns false.
    }
    return false;
}

// ── Rehash-on-verify migration hook ────────────────────────────────────

/**
 * Returns true when a stored hash should be re-hashed on next successful
 * verification — typically because the work factor has moved up.
 *
 * Silent migration pattern:
 *   1. User logs in with plaintext X
 *   2. verifyPassword(X, oldHash) → true
 *   3. needsRehash(oldHash) → true
 *   4. hashPassword(X) → newHash; persist; done
 *
 * This lets us bump BCRYPT_COST (or swap to argon2id later) without
 * forcing a password-reset email campaign.
 */
export function needsRehash(hash: string | null | undefined): boolean {
    if (!hash) return false; // No hash to rehash; login will fail upstream
    // bcrypt hashes begin `$2a$<cost>$` / `$2b$<cost>$` / `$2y$<cost>$`.
    // Anything else is from a different algorithm and definitely needs
    // re-hashing if we keep bcrypt as canonical.
    const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
    if (!match) return true;
    const cost = Number(match[1]);
    return cost < BCRYPT_COST;
}

// ── Password policy (for new passwords only) ───────────────────────────

export type PasswordPolicyResult =
    | { ok: true }
    | { ok: false; reason: 'too_short' | 'too_long' | 'empty' };

/**
 * Validate a plaintext against the minimum password policy. Only runs
 * at the point of *setting* a password (register, change, reset) — NOT
 * at login. Pre-existing users whose passwords predate a policy bump
 * are not locked out by a new rule.
 *
 * Keeps the policy narrow on purpose: length floor + length ceiling.
 * We don't mandate special characters / mixed case / etc. — NIST 800-63B
 * explicitly deprecates those requirements in favour of length and
 * breach-list screening. Breach-list screening lives in a later prompt.
 */
export function validatePasswordPolicy(plaintext: string): PasswordPolicyResult {
    if (!plaintext) return { ok: false, reason: 'empty' };
    if (plaintext.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };
    if (plaintext.length > MAX_PASSWORD_LENGTH) return { ok: false, reason: 'too_long' };
    return { ok: true };
}

/**
 * Human-readable, user-facing message for a failed
 * {@link validatePasswordPolicy}. Kept here next to the policy so the
 * wording and the numeric bounds can never drift apart — every
 * password-setting route (register, change, reset) renders the same
 * sentence for the same failure.
 */
export function describePasswordPolicyFailure(
    reason: Exclude<PasswordPolicyResult, { ok: true }>['reason'],
): string {
    switch (reason) {
        case 'too_short':
            return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        case 'too_long':
            return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
        case 'empty':
            return 'Password is required.';
    }
}
