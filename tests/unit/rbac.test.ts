/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
/**
 * Unit tests for RBAC helpers (Chunk 1: unified Role enum).
 *
 * Tests the permission system with roles: ADMIN, EDITOR, READER, AUDITOR
 */

// @/env is already globally mocked via jest.config.js moduleNameMapper
jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('jsonwebtoken', () => ({
    sign: jest.fn(),
    verify: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        user: { findUnique: jest.fn() },
        tenantMembership: { findUnique: jest.fn(), findFirst: jest.fn() },
        scopeMembership: { findFirst: jest.fn() },
        scope: { findUnique: jest.fn() },
    },
}));

import {
    hasMinRole,
    canRead,
    canWrite,
    canAdmin,
    canAudit,
    canExport,
    canEdit,
    requireRole,
} from '@/lib/auth';

describe('RBAC Helpers (Chunk 1)', () => {
    // ─── hasMinRole ───

    describe('hasMinRole', () => {
        it('ADMIN >= all roles', () => {
            expect(hasMinRole('ADMIN', 'ADMIN')).toBe(true);
            expect(hasMinRole('ADMIN', 'EDITOR')).toBe(true);
            expect(hasMinRole('ADMIN', 'READER')).toBe(true);
            expect(hasMinRole('ADMIN', 'AUDITOR')).toBe(true);
        });

        it('EDITOR >= EDITOR, READER, AUDITOR but not ADMIN', () => {
            expect(hasMinRole('EDITOR', 'ADMIN')).toBe(false);
            expect(hasMinRole('EDITOR', 'EDITOR')).toBe(true);
            expect(hasMinRole('EDITOR', 'READER')).toBe(true);
            expect(hasMinRole('EDITOR', 'AUDITOR')).toBe(true);
        });

        it('AUDITOR >= AUDITOR, READER but not EDITOR or ADMIN', () => {
            expect(hasMinRole('AUDITOR', 'ADMIN')).toBe(false);
            expect(hasMinRole('AUDITOR', 'EDITOR')).toBe(false);
            expect(hasMinRole('AUDITOR', 'AUDITOR')).toBe(true);
            expect(hasMinRole('AUDITOR', 'READER')).toBe(true);
        });

        it('READER >= READER only', () => {
            expect(hasMinRole('READER', 'ADMIN')).toBe(false);
            expect(hasMinRole('READER', 'EDITOR')).toBe(false);
            expect(hasMinRole('READER', 'AUDITOR')).toBe(false);
            expect(hasMinRole('READER', 'READER')).toBe(true);
        });
    });

    // ─── Permission helpers ───

    describe('canRead', () => {
        it('all roles can read', () => {
            expect(canRead('OWNER')).toBe(true);
            expect(canRead('ADMIN')).toBe(true);
            expect(canRead('EDITOR')).toBe(true);
            expect(canRead('READER')).toBe(true);
            expect(canRead('AUDITOR')).toBe(true);
            // MECHANISATOR reads at the coarse tier so its own task data
            // loads; the route lockdown confines it to "My work".
            expect(canRead('MECHANISATOR')).toBe(true);
        });
    });

    describe('MECHANISATOR (restricted operator)', () => {
        it('reads but cannot write / admin / audit / export at the coarse tier', () => {
            expect(canRead('MECHANISATOR')).toBe(true);
            expect(canWrite('MECHANISATOR')).toBe(false);
            expect(canAdmin('MECHANISATOR')).toBe(false);
            expect(canAudit('MECHANISATOR')).toBe(false);
            expect(canExport('MECHANISATOR')).toBe(false);
        });

        it('sits at the lowest rung — never satisfies a write/admin min-role gate', () => {
            expect(hasMinRole('MECHANISATOR', 'EDITOR')).toBe(false);
            expect(hasMinRole('MECHANISATOR', 'ADMIN')).toBe(false);
            expect(hasMinRole('MECHANISATOR', 'READER')).toBe(true);
        });
    });

    describe('canWrite', () => {
        it('OWNER, ADMIN, and EDITOR can write', () => {
            // OWNER ⊃ ADMIN per CLAUDE.md — every ADMIN gate must accept OWNER.
            expect(canWrite('OWNER')).toBe(true);
            expect(canWrite('ADMIN')).toBe(true);
            expect(canWrite('EDITOR')).toBe(true);
        });

        it('READER and AUDITOR cannot write', () => {
            expect(canWrite('READER')).toBe(false);
            expect(canWrite('AUDITOR')).toBe(false);
        });
    });

    describe('canAdmin', () => {
        it('OWNER and ADMIN can admin (OWNER is strictly superior to ADMIN)', () => {
            expect(canAdmin('OWNER')).toBe(true);
            expect(canAdmin('ADMIN')).toBe(true);
            expect(canAdmin('EDITOR')).toBe(false);
            expect(canAdmin('READER')).toBe(false);
            expect(canAdmin('AUDITOR')).toBe(false);
        });
    });

    describe('canAudit', () => {
        it('OWNER, ADMIN, and AUDITOR can audit', () => {
            expect(canAudit('OWNER')).toBe(true);
            expect(canAudit('ADMIN')).toBe(true);
            expect(canAudit('AUDITOR')).toBe(true);
        });

        it('EDITOR and READER cannot audit', () => {
            expect(canAudit('EDITOR')).toBe(false);
            expect(canAudit('READER')).toBe(false);
        });
    });

    describe('canExport', () => {
        it('OWNER, ADMIN, EDITOR, and AUDITOR can export', () => {
            expect(canExport('OWNER')).toBe(true);
            expect(canExport('ADMIN')).toBe(true);
            expect(canExport('EDITOR')).toBe(true);
            expect(canExport('AUDITOR')).toBe(true);
        });

        it('READER cannot export', () => {
            expect(canExport('READER')).toBe(false);
        });
    });

    describe('canEdit (backward compat alias)', () => {
        it('delegates to canWrite', () => {
            expect(canEdit('ADMIN')).toBe(true);
            expect(canEdit('EDITOR')).toBe(true);
            expect(canEdit('READER')).toBe(false);
            expect(canEdit('AUDITOR')).toBe(false);
        });
    });

    // ─── requireRole ───

    describe('requireRole', () => {
        const makeSession = (role: any) => ({
            userId: 'u1',
            tenantId: 't1',
            email: 'test@test.com',
            role,
        });

        it('does not throw when role is sufficient', () => {
            expect(() => requireRole(makeSession('ADMIN'), 'ADMIN')).not.toThrow();
            expect(() => requireRole(makeSession('ADMIN'), 'EDITOR')).not.toThrow();
            expect(() => requireRole(makeSession('EDITOR'), 'EDITOR')).not.toThrow();
            expect(() => requireRole(makeSession('EDITOR'), 'READER')).not.toThrow();
        });

        it('throws forbidden when role is insufficient', () => {
            expect(() => requireRole(makeSession('READER'), 'EDITOR')).toThrow();
            expect(() => requireRole(makeSession('READER'), 'ADMIN')).toThrow();
            expect(() => requireRole(makeSession('AUDITOR'), 'EDITOR')).toThrow();
        });
    });
});
