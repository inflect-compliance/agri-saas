/**
 * EI-2 — pure resolution of an IC role from a user's Entra group membership.
 *
 * Split out as a dependency-free function so both EI-2 (admin-UI "what role
 * would this user get?" preview) and EI-3 (sign-in enforcement) share one
 * deterministic ranking, and so it's exhaustively unit-testable.
 */
import type { Role } from '@prisma/client';

export interface GroupRoleMapping {
    aadGroupId: string;
    role: Role;
    priority: number;
}

export interface ResolvedGroupRole {
    /** The winning role, or null when the user matched no mapped group. */
    role: Role | null;
    /** Every mapped group the user is actually in (for audit + the gate). */
    matchedGroupIds: string[];
}

/**
 * Role seniority, used only as a deterministic tie-breaker when two matched
 * mappings share the same `priority`. NOT an authority model — the admin's
 * explicit `priority` is the primary signal. OWNER is ranked for completeness
 * even though it is never a mappable target (see the Zod schema).
 */
const ROLE_SENIORITY: Record<Role, number> = {
    OWNER: 4,
    ADMIN: 3,
    EDITOR: 2,
    READER: 1,
    AUDITOR: 0,
    // Never an SSO-mappable target (excluded from ENTRA_MAPPABLE_ROLES),
    // ranked lowest for completeness only.
    MECHANISATOR: 0,
};

/**
 * Resolve the IC role a user earns from their AAD security-group membership.
 *
 * Winner selection, in order: highest `priority`, then most-senior role, then
 * lowest `aadGroupId` (lexicographic) so the result is fully deterministic.
 * Returns `{ role: null }` when no mapping matches — the caller decides what
 * that means (no change, or denial under `enforceGroupGate`).
 */
export function resolveRoleFromGroups(
    aadGroups: readonly string[],
    mappings: readonly GroupRoleMapping[],
): ResolvedGroupRole {
    const groupSet = new Set(aadGroups);
    const matched = mappings.filter((m) => groupSet.has(m.aadGroupId));
    if (matched.length === 0) return { role: null, matchedGroupIds: [] };

    const winner = [...matched].sort(
        (a, b) =>
            b.priority - a.priority ||
            ROLE_SENIORITY[b.role] - ROLE_SENIORITY[a.role] ||
            a.aadGroupId.localeCompare(b.aadGroupId),
    )[0];

    return { role: winner.role, matchedGroupIds: matched.map((m) => m.aadGroupId) };
}
