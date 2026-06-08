/**
 * EI-4 Part A — Entra ID test fixture library.
 *
 * The EI-1 group-claim path has three shapes worth exercising end-to-end:
 *   1. a normal sign-in with the inline `groups` claim,
 *   2. an overage sign-in (> ~200 groups) where Entra omits `groups` and the
 *      real list comes from Graph `/me/memberOf` (paginated),
 *   3. a Graph outage where the fetch fails and the path fails open to `[]`.
 *
 * These builders give every Entra/group test the same fixtures so they don't
 * each hand-roll the profile/account/Graph-response shapes (which drift).
 */

/** A normal Entra ID `profile` with the AAD `groups` claim inline. */
export function buildEntraProfile(
    groupIds: string[] = ['11111111-1111-1111-1111-111111111111'],
): { groups: string[]; oid: string; tid: string } {
    return {
        groups: groupIds,
        oid: '00000000-0000-0000-0000-0000000000aa',
        tid: '00000000-0000-0000-0000-0000000000bb',
    };
}

/**
 * An overage Entra ID `profile` — the user is in > ~200 groups, so Entra omits
 * the `groups` claim and sets `_claim_names.groups` to a source pointer. The
 * real membership is only reachable via Graph.
 */
export function buildEntraOverageProfile(): {
    _claim_names: { groups: string };
    oid: string;
    tid: string;
} {
    return {
        _claim_names: { groups: 'src1' },
        oid: '00000000-0000-0000-0000-0000000000aa',
        tid: '00000000-0000-0000-0000-0000000000bb',
    };
}

/** A NextAuth `account` for a `microsoft-entra-id` sign-in. */
export function buildEntraAccount(
    overrides: Partial<{ access_token: string }> = {},
): { provider: string; access_token: string } {
    // Fixed dummy token for Entra test fixtures, not a real credential.
    return { provider: 'microsoft-entra-id', access_token: 'graph-access-token', ...overrides }; // pragma: allowlist secret
}

/**
 * A mock `fetch` that serves paginated Graph `/me/memberOf` responses. Each
 * page yields its `ids` as `{ value: [{ id }] }`; set `next: true` to emit an
 * `@odata.nextLink` so the caller paginates to the following page.
 *
 * Returns a `jest.fn` so callers can assert call counts / headers.
 */
export function graphMemberOfFetch(
    pages: Array<{ ids: string[]; next?: boolean }>,
): jest.Mock {
    let i = 0;
    return jest.fn(async () => {
        const page = pages[i] ?? { ids: [] };
        const body: Record<string, unknown> = {
            value: page.ids.map((id) => ({ id })),
        };
        if (page.next) body['@odata.nextLink'] = `https://graph.microsoft.com/next/${i}`;
        i++;
        return { ok: true, json: async () => body } as unknown as Response;
    });
}

/** A mock `fetch` that returns a non-OK response — exercises the fail-open path. */
export function graphFailFetch(): jest.Mock {
    return jest.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
}

/** A mock `fetch` that throws (transport error) — also fail-open. */
export function graphThrowFetch(): jest.Mock {
    return jest.fn(async () => {
        throw new Error('network');
    });
}
