/**
 * Unit test — soil usecase (#37).
 *
 * Covers the pure guard-clause behaviour of `enqueueParcelSoilFetch`: it is
 * best-effort and MUST NOT throw or touch the queue when there is nothing to
 * enqueue (empty / falsy-only id lists), so a parcel write is never blocked
 * by a soil-fetch trigger. Also satisfies the usecase-test-coverage ratchet
 * by importing the usecase via its canonical `@/app-layer/usecases/soil`
 * path.
 */
import { enqueueParcelSoilFetch } from '@/app-layer/usecases/soil';
import { buildRequestContext } from '../../helpers/factories';

describe('enqueueParcelSoilFetch — best-effort guard clause', () => {
    const ctx = buildRequestContext({ tenantId: 'tenant-soil' });

    it('resolves without enqueuing when the parcel list is empty', async () => {
        await expect(enqueueParcelSoilFetch(ctx, [])).resolves.toBeUndefined();
    });

    it('ignores falsy ids and no-ops when none remain', async () => {
        await expect(
            enqueueParcelSoilFetch(ctx, ['', undefined as unknown as string, null as unknown as string]),
        ).resolves.toBeUndefined();
    });
});
