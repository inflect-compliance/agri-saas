/**
 * Cross-tenant route guard — admin session revocation.
 *
 * A tenant-B admin must NOT be able to revoke a session owned by tenant A,
 * even with a valid sessionId: the revoke lookup is tenant-scoped, so a foreign
 * session is invisible and the route returns 404 (never leaking existence)
 * without touching `revokeSessionById`. Driven through the shared
 * `assertCrossTenantGuard` harness (Roadmap-5 PR4).
 */
const getTenantCtxMock = jest.fn();
jest.mock('@/app-layer/context', () => ({
    __esModule: true,
    getTenantCtx: (...a: unknown[]) => getTenantCtxMock(...a),
}));

const findOwnTenantSessionMock = jest.fn();
const revokeSessionByIdMock = jest.fn();
jest.mock('@/lib/security/session-tracker', () => ({
    __esModule: true,
    findOwnTenantSession: (...a: unknown[]) => findOwnTenantSessionMock(...a),
    revokeSessionById: (...a: unknown[]) => revokeSessionByIdMock(...a),
    listActiveSessionsForTenant: jest.fn(),
    listActiveSessionsForUserInTenant: jest.fn(),
}));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { NextRequest } from 'next/server';
import { DELETE as DELETE_SESSION } from '@/app/api/t/[tenantSlug]/admin/sessions/route';
import { makeRequestContext } from '../helpers/make-context';
import { assertCrossTenantGuard } from '../helpers/cross-tenant-guard';

function delReq(): NextRequest {
    return new NextRequest('http://localhost/api/t/tenant-b/admin/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        // The sessionId belongs to tenant A; the caller is a tenant-B admin.
        body: JSON.stringify({ sessionId: 'sess-owned-by-tenant-a' }),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    // Caller is a legitimate tenant-B ADMIN (has admin.members) — the guard we
    // exercise is the tenant-scoped session lookup, not the permission check.
    getTenantCtxMock.mockResolvedValue(
        makeRequestContext('ADMIN', { tenantId: 'tenant-b', userId: 'admin-b' }),
    );
});

assertCrossTenantGuard({
    name: 'DELETE /admin/sessions (foreign session id in body)',
    handler: DELETE_SESSION,
    makeReq: () => delReq(),
    params: { tenantSlug: 'tenant-b' },
    // A foreign session is invisible under the caller's tenantId → null.
    arrangeForeignRow: () => findOwnTenantSessionMock.mockResolvedValue(null),
    arrangeMissing: () => findOwnTenantSessionMock.mockResolvedValue(null),
    mutationSpy: () => revokeSessionByIdMock,
    // Tenant-scoped lookup returns 404 (not 403) for a foreign row — by design,
    // so the route never leaks whether the id exists in another tenant.
    foreignStatus: 404,
    missingStatus: 404,
});
