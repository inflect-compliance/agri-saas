/**
 * EI-1 group-claim resolution, extracted from the NextAuth `jwt` callback
 * (EI-4).
 *
 * Why a separate module:
 *   - **Testability** — the `jwt` callback in `auth.ts` is a large closure that
 *     pulls in Prisma, membership claims, MFA lookups and session recording.
 *     Pulling the group-resolution decision out into a pure, dependency-injected
 *     function lets EI-4 unit-test the load-bearing path (direct claim vs Graph
 *     overage vs fail-open) without standing up NextAuth.
 *   - **Observability home** — the overage Graph fetch is the one Entra path
 *     that does network I/O at sign-in. Centralising it here gives the EI-4
 *     metrics (`recordEntraGroupResolution`) + structured logging a single,
 *     obvious seam instead of being inlined in the auth config.
 *
 * The module is loaded via dynamic `import()` from the `jwt` callback so it
 * (and its OTel-API + Graph dependencies) never bundles into the edge runtime.
 */
import { fetchUserGroupsFromGraph } from '@/lib/auth/entra-graph';
import { edgeLogger } from '@/lib/observability/edge-logger';
import { recordEntraGroupResolution } from '@/lib/observability/metrics';

/** The Entra-relevant shape of a NextAuth `profile` for a Microsoft sign-in. */
export interface EntraProfileClaims {
    /** Inline AAD security-group object IDs (present for users in ≤ ~200 groups). */
    groups?: string[];
    /**
     * Overage indicator — Entra omits the `groups` claim for users in > ~200
     * groups and sets `_claim_names.groups` to a source pointer instead. Its
     * presence (with an access token) triggers the Graph `/me/memberOf` fetch.
     */
    _claim_names?: { groups?: string };
}

export interface EntraGroupResolution {
    /** Resolved AAD security-group object IDs (possibly empty — fail-open). */
    groups: string[];
    /** True when the list came from the Graph overage fallback, not the token. */
    overage: boolean;
}

export interface ResolveEntraGroupClaimsDeps {
    /** Injectable `fetch` for the Graph call (defaults to global `fetch`). */
    fetchImpl?: typeof fetch;
    /** Injectable clock for the fetch-duration metric (defaults to `Date.now`). */
    now?: () => number;
}

/**
 * Resolve a user's AAD security-group membership at sign-in.
 *
 * - **Overage** (`_claim_names.groups` present AND an access token is available):
 *   fetch the full membership from Graph. The Graph helper fails open to `[]`,
 *   so a Graph outage never blocks sign-in — it just yields no groups (and an
 *   `outcome: 'empty'` metric so operators can alert on it).
 * - **Normal**: use the inline `groups` claim (empty array if absent).
 *
 * Records exactly one `recordEntraGroupResolution` per call.
 */
export async function resolveEntraGroupClaims(
    input: { profile: unknown; accessToken?: string },
    deps: ResolveEntraGroupClaimsDeps = {},
): Promise<EntraGroupResolution> {
    const p = (input.profile ?? {}) as EntraProfileClaims;
    const now = deps.now ?? Date.now;

    if (p._claim_names?.groups && input.accessToken) {
        const started = now();
        const fetched = await fetchUserGroupsFromGraph(
            input.accessToken,
            deps.fetchImpl,
        );
        const graphFetchDurationMs = now() - started;
        const groups = fetched.map((g) => g.id);
        const outcome = groups.length > 0 ? 'resolved' : 'empty';

        recordEntraGroupResolution({
            source: 'graph_overage',
            outcome,
            groupCount: groups.length,
            graphFetchDurationMs,
        });
        edgeLogger.info('Entra group overage resolved via Graph', {
            component: 'entra',
            overage: true,
            outcome,
            groupCount: groups.length,
            graphFetchDurationMs,
        });
        return { groups, overage: true };
    }

    const groups = Array.isArray(p.groups) ? p.groups : [];
    recordEntraGroupResolution({
        source: 'token',
        outcome: groups.length > 0 ? 'resolved' : 'empty',
        groupCount: groups.length,
    });
    return { groups, overage: false };
}
