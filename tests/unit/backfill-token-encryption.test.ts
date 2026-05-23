/**
 * Unit tests for the token encryption backfill script.
 *
 * Tests the pure logic functions exported from the backfill script
 * (needsMigration, roundtrip verification) without requiring a live database.
 */
import { encryptField, isEncryptedValue } from '@/lib/security/encryption';

// Import the needsMigration function from the script

const { needsMigration } = require('../../scripts/backfill-token-encryption');

interface AccountRow {
    id: string;
    access_token: string | null;
    refresh_token: string | null;
    accessTokenEncrypted: string | null;
    refreshTokenEncrypted: string | null;
    provider: string;
}

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
    return {
        id: 'test-id-1',
        access_token: null,
        refresh_token: null,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        provider: 'google',
        ...overrides,
    };
}

describe('backfill-token-encryption: needsMigration', () => {

    test('returns true for row with plaintext access_token and no encrypted column', () => {
        const row = makeRow({
            access_token: 'ya29.plain_access_token', // pragma: allowlist secret
        });
        expect(needsMigration(row)).toBe(true);
    });

    test('returns true for row with plaintext refresh_token and no encrypted column', () => {
        const row = makeRow({
            refresh_token: '1//plain_refresh_token',
        });
        expect(needsMigration(row)).toBe(true);
    });

    test('returns true for row with both plaintext tokens', () => {
        const row = makeRow({
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
        });
        expect(needsMigration(row)).toBe(true);
    });

    test('returns false for row with no tokens at all', () => {
        const row = makeRow();
        expect(needsMigration(row)).toBe(false);
    });

    test('returns false for row already fully encrypted', () => {
        const encAccess = encryptField('ya29.access');
        const encRefresh = encryptField('1//refresh');
        const row = makeRow({
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
            accessTokenEncrypted: encAccess,
            refreshTokenEncrypted: encRefresh,
        });
        expect(needsMigration(row)).toBe(false);
    });

    test('returns true for row with plaintext access but encrypted refresh (partial)', () => {
        const encRefresh = encryptField('1//refresh');
        const row = makeRow({
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
            accessTokenEncrypted: null,
            refreshTokenEncrypted: encRefresh,
        });
        expect(needsMigration(row)).toBe(true);
    });

    test('returns false for row with null tokens and null encrypted columns', () => {
        const row = makeRow({
            access_token: null,
            refresh_token: null,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
        });
        expect(needsMigration(row)).toBe(false);
    });
});

describe('backfill-token-encryption: encryption behaviour', () => {

    test('encrypted value is not plaintext', () => {
        const token = 'ya29.test_token_value_12345';
        const encrypted = encryptField(token);
        expect(encrypted).not.toBe(token);
        expect(encrypted).not.toContain(token);
        expect(isEncryptedValue(encrypted)).toBe(true);
    });

    test('idempotent migration: re-encrypting already-encrypted row is skipped', () => {
        const encAccess = encryptField('ya29.access');
        const encRefresh = encryptField('1//refresh');

        // This row is already done
        const row = makeRow({
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
            accessTokenEncrypted: encAccess,
            refreshTokenEncrypted: encRefresh,
        });

        // First check: already done
        expect(needsMigration(row)).toBe(false);

        // Simulate "rerun" scenario — still skipped
        expect(needsMigration(row)).toBe(false);
    });

    test('partial migration: row with one encrypted, one not, is detected', () => {
        const encRefresh = encryptField('1//refresh');

        const row = makeRow({
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
            accessTokenEncrypted: null, // not encrypted yet
            refreshTokenEncrypted: encRefresh, // already encrypted
        });

        expect(needsMigration(row)).toBe(true);
    });

    test('row with nulled plaintext and existing encrypted is considered done', () => {
        const encAccess = encryptField('ya29.access');
        const encRefresh = encryptField('1//refresh');

        const row = makeRow({
            access_token: null, // already nulled
            refresh_token: null, // already nulled
            accessTokenEncrypted: encAccess,
            refreshTokenEncrypted: encRefresh,
        });

        // No plaintext to migrate, and encrypted columns exist
        expect(needsMigration(row)).toBe(false);
    });
});
