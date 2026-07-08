/**
 * Unit test — soil-fetch job/queue wiring (#37).
 *
 * Documents + locks the rate-limit-related configuration: the soil-fetch job
 * runs on its OWN queue (so the worker's 5/min limiter applies only to it),
 * and its retry policy gives the throttled SoilGrids beta API room before
 * giving up (leaving the parcel "soil pending").
 *
 * The Worker limiter itself lives in `scripts/worker.ts` (a process
 * entrypoint, not import-testable here); this guards the queue routing +
 * retry contract the limiter depends on.
 */
import {
    SOIL_QUEUE_JOBS,
    SOIL_QUEUE_NAME,
    QUEUE_NAME,
    JOB_DEFAULTS,
} from '@/app-layer/jobs/types';

describe('soil-fetch queue configuration', () => {
    it('routes soil-fetch to the dedicated (rate-limited) queue', () => {
        expect(SOIL_QUEUE_JOBS.has('soil-fetch')).toBe(true);
        expect(SOIL_QUEUE_NAME).not.toBe(QUEUE_NAME);
    });

    it('retries provider throttling with a long backoff before giving up', () => {
        const d = JOB_DEFAULTS['soil-fetch'];
        expect(d.attempts).toBeGreaterThanOrEqual(3);
        expect(d.backoff.type).toBe('exponential');
        expect(d.backoff.delay).toBeGreaterThanOrEqual(10000);
    });
});
