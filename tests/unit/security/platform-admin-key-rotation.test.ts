/**
 * R-4 closure: PLATFORM_ADMIN_API_KEY rotation.
 *
 * Asserts verifyPlatformApiKey accepts EITHER the current or the
 * previous key during a rotation window. Keeps the constant-time
 * compare semantics across both branches.
 */

import { NextRequest } from 'next/server';
import {
    PlatformAdminError,
} from '@/lib/auth/platform-admin';

const HEADER = 'x-platform-admin-key';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const KEY_C = 'c'.repeat(40);

function makeReq(headerValue: string | undefined): NextRequest {
    const headers = new Headers();
    if (headerValue !== undefined) headers.set(HEADER, headerValue);
    return { headers } as unknown as NextRequest;
}

const savedCurrent = process.env.PLATFORM_ADMIN_API_KEY;
const savedPrevious = process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS;

describe('verifyPlatformApiKey — rotation (R-4)', () => {
    beforeEach(() => {
        delete process.env.PLATFORM_ADMIN_API_KEY;
        delete process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS;
        // Reset env module cache because env.ts validates at first read.
        jest.resetModules();
    });

    afterAll(() => {
        if (savedCurrent === undefined) delete process.env.PLATFORM_ADMIN_API_KEY;
        else process.env.PLATFORM_ADMIN_API_KEY = savedCurrent;
        if (savedPrevious === undefined) delete process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS;
        else process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS = savedPrevious;
    });

    it('accepts the current key when no previous is set', () => {
        process.env.PLATFORM_ADMIN_API_KEY = KEY_A;
        // Force re-import to reload env.ts with the test key.
        jest.isolateModules(() => {
            const mod = require('@/lib/auth/platform-admin');
            expect(() => mod.verifyPlatformApiKey(makeReq(KEY_A))).not.toThrow();
        });
    });

    it('rejects with 401 when only the current key is set and key mismatches', () => {
        process.env.PLATFORM_ADMIN_API_KEY = KEY_A;
        jest.isolateModules(() => {
            const mod = require('@/lib/auth/platform-admin');
            expect(() => mod.verifyPlatformApiKey(makeReq(KEY_B))).toThrow(
                mod.PlatformAdminError,
            );
        });
    });

    it('accepts EITHER current or previous during rotation', () => {
        process.env.PLATFORM_ADMIN_API_KEY = KEY_A;
        process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS = KEY_B;
        jest.isolateModules(() => {
            const mod = require('@/lib/auth/platform-admin');
            expect(() => mod.verifyPlatformApiKey(makeReq(KEY_A))).not.toThrow();
            expect(() => mod.verifyPlatformApiKey(makeReq(KEY_B))).not.toThrow();
        });
    });

    it('rejects keys that match neither current nor previous', () => {
        process.env.PLATFORM_ADMIN_API_KEY = KEY_A;
        process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS = KEY_B;
        jest.isolateModules(() => {
            const mod = require('@/lib/auth/platform-admin');
            expect(() => mod.verifyPlatformApiKey(makeReq(KEY_C))).toThrow(
                mod.PlatformAdminError,
            );
        });
    });

    it('throws 503 when current is unset, regardless of previous', () => {
        // Operator dropped current but forgot to drop previous — the
        // routes should still be 503 because we treat current as the
        // master switch.
        process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS = KEY_B;
        jest.isolateModules(() => {
            const mod = require('@/lib/auth/platform-admin');
            try {
                mod.verifyPlatformApiKey(makeReq(KEY_B));
                throw new Error('Expected 503 throw');
            } catch (err) {
                expect(err).toBeInstanceOf(mod.PlatformAdminError);
                expect((err as PlatformAdminError).status).toBe(503);
            }
        });
    });
});
