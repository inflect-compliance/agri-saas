/**
 * Unit test — cadastre-owners usecase feature gate.
 *
 * The heavy path (КАИС fetch → extract → replace-all) is covered by the pure
 * extractor tests (`cadastre-ownership.test.ts`) + verified against the real
 * Банско register. Here we pin the SERVER-side gate: with no
 * `CADASTRE_OPENDATA_INDEX_URL` configured the usecase is a no-op and never
 * touches the network or DB — so a best-effort trigger from the import job is
 * safe when the feature is off. Also satisfies the usecase-test-coverage
 * ratchet by importing via the canonical `@/app-layer/usecases/cadastre-owners`.
 */
// Mock the DB client — the disabled path returns before any query, and this
// keeps the real prisma connection from leaking an open handle in the test.
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
    fetchAndStoreCadastreOwners,
    isCadastreOwnersEnabled,
} from '@/app-layer/usecases/cadastre-owners';

describe('cadastre-owners usecase — feature gate', () => {
    it('isCadastreOwnersEnabled is false when CADASTRE_OPENDATA_INDEX_URL is unset (test env)', () => {
        expect(isCadastreOwnersEnabled()).toBe(false);
    });

    it('fetchAndStoreCadastreOwners is a disabled no-op when the feature URL is unset', async () => {
        await expect(fetchAndStoreCadastreOwners('02676')).resolves.toEqual({ status: 'disabled' });
    });
});
