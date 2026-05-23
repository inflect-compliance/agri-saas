/* eslint-disable @typescript-eslint/no-explicit-any -- test
 * mocks, fixtures, and adapter shims that mirror runtime contracts
 * (Prisma extensions, NextRequest mocks, JSON-loaded fixtures,
 * spy harnesses). Per-line typing has poor cost/benefit ratio in
 * test files; the file-level disable is the codebase's standard
 * pattern for these surfaces (see also
 * tests/guards/helm-chart-foundation.test.ts and
 * tests/integration/audit-middleware.test.ts). */
import { toApiErrorResponse, badRequest, internal } from '@/lib/errors/types';
import { ZodError } from 'zod';

describe('Error Types & Utilities', () => {
    describe('toApiErrorResponse', () => {
        it('transforms AppErrors correctly into ApiErrorResponse', () => {
            const error = badRequest('Invalid inputs', { field: 'name' });
            const { payload, status } = toApiErrorResponse(error, 'test-req-id');

            expect(status).toBe(400);
            expect(payload.error.code).toBe('BAD_REQUEST');
            expect(payload.error.message).toBe('Invalid inputs');
            expect(payload.error.requestId).toBe('test-req-id');
            expect(payload.error.details).toEqual({ field: 'name' });
        });

        it('hides messages for un-exposed internal AppErrors', () => {
            const error = internal('Database connection failed'); // defaults to expose: false
            const { payload, status } = toApiErrorResponse(error, 'test-req-id');

            expect(status).toBe(500);
            expect(payload.error.code).toBe('INTERNAL');
            expect(payload.error.message).not.toContain('Database'); // should use standard fallback
            expect(payload.error.message).toBe('An error occurred'); // Fallback from the internal type switch
        });

        it('structures ZodErrors correctly', () => {
            const zError = new ZodError([
                { code: 'invalid_type', path: ['email'], message: 'Required', expected: 'string', input: undefined }
            ]);
            const { payload, status } = toApiErrorResponse(zError, 'zod-req');

            expect(status).toBe(400);
            expect(payload.error.code).toBe('VALIDATION_ERROR');
            expect(payload.error.details).toHaveLength(1);
            expect((payload.error.details as any)[0].path).toEqual(['email']);
        });

        it('structures generic primitive errors gracefully as 500 INTERNAL', () => {
            const nativeError = new Error('I am a leaky primitive error with a stack trace!');
            const { payload, status } = toApiErrorResponse(nativeError, 'primitive-req');

            expect(status).toBe(500);
            expect(payload.error.code).toBe('INTERNAL');
            expect(payload.error.message).toBe('An unexpected internal server error occurred');
            expect(payload.error.details).toBeUndefined(); // Ensure no leak
        });

        it('maps Prisma P2002 errors to 409 CONFLICT', () => {
            // Mocking a prisma error structure dynamically without requiring the Prisma engine
            const pError = { code: 'P2002', meta: { target: ['email'] } };
            const { payload, status } = toApiErrorResponse(pError, 'prisma-req');

            expect(status).toBe(409);
            expect(payload.error.code).toBe('CONFLICT');
            expect(payload.error.details).toEqual(['email']);
        });
    });
});
