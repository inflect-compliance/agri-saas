/**
 * BullMQ Worker — Standalone Process Entrypoint
 *
 * Processes async jobs from the `inflect-jobs` queue.
 * Runs independently of the Next.js web server.
 *
 * Usage:
 *   npx tsx scripts/worker.ts
 *   # or in production:
 *   node --import tsx scripts/worker.ts
 *
 * Architecture:
 *   - Creates its own Redis connection (not the app singleton)
 *   - Registers processors for each typed job name
 *   - Delegates to existing business logic functions (preserving observability)
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - Structured logging via Pino
 *
 * @module scripts/worker
 */
import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import {
    QUEUE_NAME,
    SOIL_QUEUE_NAME,
    type JobName,
} from '../src/app-layer/jobs/types';

// ─── Standalone logger ───

const log = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss.l' } }
        : undefined,
});

// ─── Redis connection ───

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    log.fatal('REDIS_URL is not set. Cannot start worker.');
    process.exit(1);
}

// ─── GAP-03: production encryption-key fail-fast ───────────────────
//
// The Next.js server runs this check via `src/instrumentation.ts`,
// but BullMQ workers are a separate process — they bootstrap straight
// from this file and never load the instrumentation hook. Without a
// mirror check here, a worker process can boot in production with no
// encryption key, sit idle, and crash on the FIRST job that touches
// an encrypted column (Finding.description, Risk.treatmentNotes,
// PolicyVersion.contentText, …). Same blast-radius as the lazy-throw
// failure mode the audit flagged on the web tier, just shifted to
// background processing.
//
// Imports are dynamic so the worker doesn't pull the encryption
// module unless we're in production.
if (process.env.NODE_ENV === 'production') {
    (async () => {
        const { checkProductionEncryptionKey, runEncryptionSentinel } =
            await import('../src/lib/security/startup-encryption-check');

        const config = checkProductionEncryptionKey(process.env);
        if (!config.ok) {
            log.fatal('[startup] FATAL: ' + config.reason);
            process.exit(1);
        }

        const sentinel = await runEncryptionSentinel();
        if (!sentinel.ok) {
            log.fatal('[startup] FATAL: ' + sentinel.reason);
            process.exit(1);
        }

        log.info('encryption key check passed (presence + sentinel round-trip)');
    })();
}

function createWorkerConnection(): Redis {
    return new Redis(REDIS_URL!, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 10000,
        connectionName: 'inflect-worker',
    });
}

// ═══════════════════════════════════════════════════════════════════
// Job Processing — Executor Registry Delegation
//
// All job dispatch is handled by the executor registry in the
// app-layer. The worker simply delegates to it. Adding a new job
// only requires registering it in executor-registry.ts — no
// worker changes needed.
//
// The registry is imported lazily (dynamic import) so that Prisma
// and other heavy modules are only loaded when the first job runs.
// ═══════════════════════════════════════════════════════════════════

// ─── Worker Bootstrap ───

log.info({ queueName: QUEUE_NAME, redisUrl: REDIS_URL.replace(/\/\/.*@/, '//***@') }, 'starting worker');

// Wire the automation bus to BullMQ so any domain event emitted from
// inside a job (e.g. a usecase running inside a scheduled sweep)
// fans back into the dispatch queue. Safe to call before executors
// register — the bus accepts a dispatcher at any point.
(async () => {
    const { installAutomationBusDispatcher } = await import(
        '../src/app-layer/automation/bus-bootstrap'
    );
    const { installRlsTripwire } = await import(
        '../src/lib/db/rls-middleware'
    );
    const { prisma } = await import('../src/lib/prisma');
    installAutomationBusDispatcher();
    installRlsTripwire(prisma);
    // Swap the mailer to SMTP when configured — the worker runs the
    // notification outbox + digests, which send email. Without this the
    // worker stays on the console sink and those emails never deliver.
    const { initMailerFromEnv } = await import('../src/lib/mailer');
    initMailerFromEnv();
    log.info('automation bus dispatcher + RLS tripwire + mailer installed');
})();

const connection = createWorkerConnection();

// Shared processor — dispatches to the executor registry. Reused by both the
// main worker and the dedicated soil worker (they differ only in the queue
// they drain and their rate limiter).
async function processJob(job: Job) {
    const jobName = job.name as JobName;

    // Lazy-import the executor registry on first job
    const { executorRegistry } = await import('../src/app-layer/jobs/executor-registry');

    if (!executorRegistry.has(jobName)) {
        log.warn({ jobName, jobId: job.id }, 'no executor registered for job — skipping');
        return { skipped: true, reason: `no executor for "${jobName}"` };
    }

    const startTime = performance.now();

    log.info({ jobName, jobId: job.id, payload: job.data }, 'processing job');

    // GAP-22: forward the BullMQ Job's progress channel so
    // executors that report mid-run progress (currently
    // tenant-dek-rotation) surface it via `GET .../?jobId=…`
    // without depending on bullmq from the executor side.
    const result = await executorRegistry.execute(jobName, job.data, {
        updateProgress: (p) => job.updateProgress(p as object | number),
    });
    const durationMs = Math.round(performance.now() - startTime);

    if (!result.success) {
        log.error({
            jobName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            durationMs,
            errorMessage: result.errorMessage,
        }, 'job processing failed');

        throw new Error(result.errorMessage || `Job "${jobName}" failed`);
    }

    log.info({
        jobName,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        durationMs,
        itemsScanned: result.itemsScanned,
        itemsActioned: result.itemsActioned,
    }, 'job processed successfully');

    return result;
}

const worker = new Worker(
    QUEUE_NAME,
    processJob,
    {
        connection,
        concurrency: 5,
        limiter: {
            max: 50,
            duration: 60000,
        },
    },
);

// Dedicated soil-fetch worker — its own queue + a 5/min limiter so we honour
// the SoilGrids beta REST fair-use budget without throttling other jobs.
const soilWorker = new Worker(
    SOIL_QUEUE_NAME,
    processJob,
    {
        connection: createWorkerConnection(),
        concurrency: 2,
        limiter: {
            max: 5,
            duration: 60000,
        },
    },
);

// ─── Worker Events ───

worker.on('ready', () => {
    log.info({
        queueName: QUEUE_NAME,
        note: 'Dispatch via executor-registry (lazy-loaded on first job)',
    }, 'worker ready — listening for jobs');
});

soilWorker.on('ready', () => {
    log.info({ queueName: SOIL_QUEUE_NAME, note: 'rate-limited 5/min' }, 'soil worker ready');
});
soilWorker.on('failed', (job, error) => {
    log.error({ jobName: job?.name, jobId: job?.id, err: error }, 'soil job failed');
});
soilWorker.on('error', (error) => {
    log.error({ err: error }, 'soil worker error');
});

worker.on('failed', (job, error) => {
    log.error({
        jobName: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    }, 'job failed (BullMQ event)');
});

worker.on('stalled', (jobId) => {
    log.warn({ jobId }, 'job stalled — will be retried');
});

worker.on('error', (error) => {
    log.error({
        err: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    }, 'worker error');
});

// ─── Graceful Shutdown ───

async function shutdown(signal: string) {
    log.info({ signal }, 'shutdown signal received — closing worker');

    try {
        await Promise.all([worker.close(), soilWorker.close()]);
        await connection.quit();
        log.info('worker shut down gracefully');
        process.exit(0);
    } catch (error) {
        log.error({ err: error }, 'error during shutdown');
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info('worker process started — press Ctrl+C to stop');
