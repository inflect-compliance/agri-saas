/**
 * The Meteobot embed host allowlist is the single source of truth shared by the
 * CSP `frame-src` and the stored-URL validator. If these drift, the app could
 * either persist a URL the browser refuses to frame, or (worse) frame a URL the
 * validator should have rejected. These tests pin the validator's contract.
 */
import {
    isAllowedMeteobotUrl,
    METEOBOT_FRAME_SRC,
    METEOBOT_EMBED_HOSTS,
} from '@/lib/security/meteobot';

describe('isAllowedMeteobotUrl', () => {
    it('accepts https meteobot.com apex and subdomains', () => {
        expect(isAllowedMeteobotUrl('https://meteobot.com/station/123')).toBe(true);
        expect(isAllowedMeteobotUrl('https://app.meteobot.com/s/abc')).toBe(true);
        expect(isAllowedMeteobotUrl('https://a.b.meteobot.com/x?q=1')).toBe(true);
    });

    it('rejects non-https schemes', () => {
        expect(isAllowedMeteobotUrl('http://meteobot.com/x')).toBe(false);
        expect(isAllowedMeteobotUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedMeteobotUrl('data:text/html,<h1>x</h1>')).toBe(false);
    });

    it('rejects other hosts, including lookalikes and suffix/prefix tricks', () => {
        expect(isAllowedMeteobotUrl('https://evil.com/x')).toBe(false);
        // apex embedded as a subdomain of an attacker domain
        expect(isAllowedMeteobotUrl('https://meteobot.com.evil.com/x')).toBe(false);
        // no dot boundary before the allowed host
        expect(isAllowedMeteobotUrl('https://notmeteobot.com/x')).toBe(false);
        // allowed host as a non-terminal label
        expect(isAllowedMeteobotUrl('https://meteobot.evil.com/x')).toBe(false);
    });

    it('rejects garbage and empty input without throwing', () => {
        expect(isAllowedMeteobotUrl('not a url')).toBe(false);
        expect(isAllowedMeteobotUrl('')).toBe(false);
        expect(isAllowedMeteobotUrl('meteobot.com')).toBe(false); // no scheme → not a valid absolute URL
    });
});

describe('METEOBOT_FRAME_SRC (CSP fragment) stays in sync with the allowlist', () => {
    it('covers apex + wildcard subdomain for every allowed host, all https', () => {
        expect(METEOBOT_EMBED_HOSTS.length).toBeGreaterThan(0);
        for (const host of METEOBOT_EMBED_HOSTS) {
            expect(METEOBOT_FRAME_SRC).toContain(`https://${host}`);
            expect(METEOBOT_FRAME_SRC).toContain(`https://*.${host}`);
        }
        for (const src of METEOBOT_FRAME_SRC) {
            expect(src.startsWith('https://')).toBe(true);
        }
    });
});
