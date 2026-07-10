/**
 * Parameterized cross-tenant route-guard harness.
 *
 * Generalises the `exchange-route-guard` pattern: replay tenant A's request
 * context against a resource OWNED BY tenant B (ids in the path and/or body)
 * and assert the wrapped handler returns 403/404 AND performs zero mutation —
 * the wire contract a client actually sees. Seed a new privileged route by
 * adding a `CrossTenantGuardSpec` — no bespoke describe/it boilerplate.
 *
 * The caller mounts the module mocks (getTenantCtx → foreign tenant, the
 * repository/usecase returning foreign-owned rows); this factory owns the
 * assertions.
 */
import { describe, expect, it } from '@jest/globals';
import type { NextRequest } from 'next/server';

export interface CrossTenantGuardSpec {
    /** Human label, e.g. 'PATCH /exchange/listings/[listingId]'. */
    name: string;
    /**
     * The real route handler under test. Declared as a METHOD signature so its
     * parameters are checked bivariantly — route handlers type `ctx.params` with
     * their own specific param keys (`{ tenantSlug, listingId }`), which a strict
     * function-type field would reject.
     */
    handler(req: NextRequest, ctx: { params: Promise<Record<string, string>> }): Promise<Response>;
    /** Build the request (optionally carrying a body with foreign ids). */
    makeReq: (body?: unknown) => NextRequest;
    /** Path params, including a FOREIGN resource id. */
    params: Record<string, string>;
    /** Request body for mutating routes (foreign ids may appear here too). */
    body?: unknown;
    /** Arrange the repo/usecase to return a row OWNED BY ANOTHER tenant. */
    arrangeForeignRow: () => void;
    /** Arrange the repo/usecase to return "not found". */
    arrangeMissing: () => void;
    /** The mutation spy that MUST NOT fire on a cross-tenant attempt. */
    mutationSpy: () => { mock: { calls: unknown[] } };
    /** Expected status for the foreign-owned case (default 403). */
    foreignStatus?: number;
    /** Expected status for the missing case (default 404). */
    missingStatus?: number;
}

/** Register the two cross-tenant assertions for one privileged route. */
export function assertCrossTenantGuard(spec: CrossTenantGuardSpec): void {
    const foreign = spec.foreignStatus ?? 403;
    const missing = spec.missingStatus ?? 404;

    describe(`cross-tenant guard — ${spec.name}`, () => {
        it(`returns ${foreign} + zero mutation when the resource belongs to another tenant`, async () => {
            spec.arrangeForeignRow();
            const res = await spec.handler(spec.makeReq(spec.body), {
                params: Promise.resolve(spec.params),
            });
            expect(res.status).toBe(foreign);
            expect(spec.mutationSpy().mock.calls).toHaveLength(0);
        });

        it(`returns ${missing} when the resource does not exist`, async () => {
            spec.arrangeMissing();
            const res = await spec.handler(spec.makeReq(spec.body), {
                params: Promise.resolve(spec.params),
            });
            expect(res.status).toBe(missing);
        });
    });
}
