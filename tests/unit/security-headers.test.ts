/**
 * Unit tests for src/lib/security/headers.ts
 *
 * Verifies security header values for both production and non-production.
 */
import { getSecurityHeaders, applySecurityHeaders } from '@/lib/security/headers';

describe('getSecurityHeaders', () => {
    describe('production', () => {
        const headers = getSecurityHeaders(true);

        test('sets HSTS with max-age 1 year, includeSubDomains, preload', () => {
            expect(headers['Strict-Transport-Security']).toBe(
                'max-age=31536000; includeSubDomains; preload'
            );
        });

        test('sets X-Frame-Options to DENY', () => {
            expect(headers['X-Frame-Options']).toBe('DENY');
        });

        test('sets X-Content-Type-Options to nosniff', () => {
            expect(headers['X-Content-Type-Options']).toBe('nosniff');
        });

        test('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
            expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        });

        test('sets Permissions-Policy to deny sensitive APIs', () => {
            expect(headers['Permissions-Policy']).toContain('camera=()');
            expect(headers['Permissions-Policy']).toContain('microphone=()');
            // geolocation is allowed for our OWN origin (the operator field
            // map's locate-me / live-tracking); still denied cross-origin.
            expect(headers['Permissions-Policy']).toContain('geolocation=(self)');
        });

        test('sets Cross-Origin-Opener-Policy to same-origin', () => {
            expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
        });

        test('sets Cross-Origin-Resource-Policy to same-origin', () => {
            expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
        });
    });

    describe('non-production', () => {
        const headers = getSecurityHeaders(false);

        test('sets HSTS max-age to 0', () => {
            expect(headers['Strict-Transport-Security']).toBe('max-age=0');
        });

        test('still sets all other security headers', () => {
            expect(headers['X-Frame-Options']).toBe('DENY');
            expect(headers['X-Content-Type-Options']).toBe('nosniff');
            expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        });
    });
});

describe('applySecurityHeaders', () => {
    test('applies all headers to a Headers object', () => {
        const h = new Headers();
        applySecurityHeaders(h, true);

        expect(h.get('X-Frame-Options')).toBe('DENY');
        expect(h.get('X-Content-Type-Options')).toBe('nosniff');
        expect(h.get('Strict-Transport-Security')).toContain('max-age=31536000');
        expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(h.get('Permissions-Policy')).toContain('camera=()');
        expect(h.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
        expect(h.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    });
});
