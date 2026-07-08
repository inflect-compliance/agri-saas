/**
 * Job Queue — BullMQ Queue Abstraction
 *
 * Provides a type-safe enqueue interface for all async jobs.
 * Uses the shared Redis helper from `@/lib/redis` and the typed
 * job contracts from `./types`.
 *
 * Architecture:
 *   - Single BullMQ Queue instance (singleton, HMR-safe)
 *   - Type-safe `enqueue<T>(name, payload, options?)` function
 *   - Default retry/backoff from JOB_DEFAULTS
 *   - Jobs are serialized as JSON into Redis by BullMQ
 *
 * Usage:
 *   import { enqueue } from '@/app-layer/jobs/queue';
 *   await enqueue('health-check', { enqueuedAt: new Date().toISOString() });
 *   await enqueue('automation-runner', { tenantId: 'xyz', dryRun: false });
 *
 * @module app-layer/jobs/queue
 */
import { Queue, type JobsOptions, type ConnectionOptions } from 'bullmq';
import { createRedisClient } from '@/lib/redis';
import {
    QUEUE_NAME,
    SOIL_QUEUE_NAME,
    SOIL_QUEUE_JOBS,
    JOB_DEFAULTS,
    type JobName,
    type JobPayload,
} from './types';
import { logger } from '@/lib/observability/logger';

// ─── Singleton queues (survive HMR) ───

const globalForQueue = globalThis as unknown as {
    __bullmq_queue?: Queue;
    __bullmq_soil_queue?: Queue;
};

/**
 * Returns the shared BullMQ Queue instance.
 * Creates one lazily on first call.
 *
 * NOTE: Uses `createRedisClient()` (not the singleton) because
 * BullMQ manages its own connection lifecycle.
 */
export function getQueue(): Queue {
    if (!globalForQueue.__bullmq_queue) {
        const connection = createRedisClient();

        globalForQueue.__bullmq_queue = new Queue(QUEUE_NAME, {
            // `connection` is an ioredis@5.11 instance; bullmq bundles
            // its own (exact-pinned) ioredis@5.10 types, so the two
            // `Redis` type copies diverge on the `Connector` property
            // even though the runtime API is identical and bullmq uses
            // the instance we pass. Cast across the duplicate-type gap.
            connection: connection as ConnectionOptions,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 500,
                removeOnFail: 1000,
            },
        });

        logger.info('BullMQ queue initialized', {
            component: 'queue',
            queueName: QUEUE_NAME,
        });
    }

    return globalForQueue.__bullmq_queue;
}

/**
 * Returns the shared BullMQ Queue for soil-fetch jobs. Separate queue so the
 * worker can rate-limit soil provider calls (5/min) independently of every
 * other job. Same Redis connection lifecycle as `getQueue`.
 */
export function getSoilQueue(): Queue {
    if (!globalForQueue.__bullmq_soil_queue) {
        const connection = createRedisClient();
        globalForQueue.__bullmq_soil_queue = new Queue(SOIL_QUEUE_NAME, {
            connection: connection as ConnectionOptions,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 500,
                removeOnFail: 1000,
            },
        });
        logger.info('BullMQ soil queue initialized', {
            component: 'queue',
            queueName: SOIL_QUEUE_NAME,
        });
    }
    return globalForQueue.__bullmq_soil_queue;
}

/**
 * Enqueue a typed job.
 *
 * @param name — job name (must be a key of JobPayloadMap)
 * @param payload — typed payload (must match the job's payload type)
 * @param options — optional BullMQ job options (overrides defaults)
 * @returns the BullMQ Job instance
 *
 * @example
 *   await enqueue('health-check', { enqueuedAt: new Date().toISOString() });
 *   await enqueue('automation-runner', { tenantId: 'abc' }, { priority: 1 });
 */
export async function enqueue<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    options?: Partial<JobsOptions>,
) {
    const queue = SOIL_QUEUE_JOBS.has(name) ? getSoilQueue() : getQueue();
    const defaults = JOB_DEFAULTS[name];

    const job = await queue.add(name, payload, {
        attempts: defaults.attempts,
        backoff: defaults.backoff,
        removeOnComplete: defaults.removeOnComplete,
        removeOnFail: defaults.removeOnFail,
        ...options,
    });

    logger.info('job enqueued', {
        component: 'queue',
        jobName: name,
        jobId: job.id,
    });

    return job;
}

/**
 * Close the queue connection (for graceful shutdown).
 */
export async function closeQueue(): Promise<void> {
    if (globalForQueue.__bullmq_queue) {
        await globalForQueue.__bullmq_queue.close();
        globalForQueue.__bullmq_queue = undefined;
        logger.info('BullMQ queue closed', { component: 'queue' });
    }
    if (globalForQueue.__bullmq_soil_queue) {
        await globalForQueue.__bullmq_soil_queue.close();
        globalForQueue.__bullmq_soil_queue = undefined;
        logger.info('BullMQ soil queue closed', { component: 'queue' });
    }
}
