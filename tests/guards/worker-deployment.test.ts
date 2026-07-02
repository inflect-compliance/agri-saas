/**
 * Structural ratchet — the BullMQ worker is actually deployed.
 *
 * REGRESSION CLASS
 * ----------------
 * The app enqueues background jobs and `schedules.ts` defines 12
 * repeatable crons (task-due reminders, evidence expiry, retention
 * sweeps, the notification digest, …). All of that depends on a
 * separate long-running process: `scripts/worker.ts` (the BullMQ
 * worker) plus `scripts/scheduler.ts` (registers the repeatables).
 *
 * For a long time NEITHER ran in any Docker Compose deployment:
 * `entrypoint.sh` started only `next start`, no Compose file had a
 * `worker` service, and the worker scripts were not even in the
 * production image. Every scheduled job silently never fired and
 * enqueued jobs piled up in Redis — while every test stayed green,
 * because nothing asserted the worker was deployed.
 *
 * This guard makes the worker's deployment non-optional:
 *   1. Every production-like Compose file has a `worker` service
 *      that runs the scheduler then the worker.
 *   2. The Dockerfile builds the worker bundle and ships it.
 *   3. `package.json` carries the `build:worker` script and the
 *      build script exists.
 *
 * Pure static analysis — reads the Compose files, Dockerfile and
 * package.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The production-like Compose files — each must run a worker. */
const PROD_COMPOSE_FILES = [
    'docker-compose.prod.yml',
    'deploy/docker-compose.prod.yml',
    'docker-compose.staging.yml',
];

interface ComposeService {
    command?: string | string[];
    entrypoint?: string | string[];
}
interface ComposeFile {
    services?: Record<string, ComposeService>;
}

/** Normalise a Compose `command`/`entrypoint` to a single string. */
function asText(v: string | string[] | undefined): string {
    return Array.isArray(v) ? v.join(' ') : (v ?? '');
}

describe('BullMQ worker is deployed', () => {
    describe.each(PROD_COMPOSE_FILES)('%s', (file) => {
        const compose = yaml.load(read(file)) as ComposeFile;
        const worker = compose.services?.worker;

        it('declares a `worker` service', () => {
            expect(worker).toBeDefined();
        });

        it('the worker runs the scheduler then the worker bundle', () => {
            const cmd = asText(worker?.command) + ' ' + asText(worker?.entrypoint);
            expect(cmd).toContain('dist/scheduler.mjs');
            expect(cmd).toContain('dist/worker.mjs');
        });

        it('the worker overrides the image ENTRYPOINT (not `next start`)', () => {
            // The image ENTRYPOINT is entrypoint.sh → next start. The
            // worker MUST override it, or it would run a second web
            // server instead of the worker.
            expect(worker?.entrypoint).toBeDefined();
        });
    });

    it('the Dockerfile builds the worker bundle and ships it', () => {
        const dockerfile = read('Dockerfile');
        expect(dockerfile).toMatch(/npm run build:worker/);
        // The COPY may carry a `--chown=<user>:<group>` flag (the
        // runtime image chowns at copy time to avoid a duplicate
        // recursive-chown layer) — accept it optionally.
        expect(dockerfile).toMatch(
            /COPY --from=builder (?:--chown=\S+ )?\/app\/dist \.\/dist/,
        );
        // build:worker must run before the dev-dependency prune —
        // esbuild is a devDependency.
        const buildIdx = dockerfile.indexOf('build:worker');
        const pruneIdx = dockerfile.indexOf('npm prune');
        expect(buildIdx).toBeGreaterThan(-1);
        expect(buildIdx).toBeLessThan(pruneIdx);
    });

    it('package.json carries the build:worker script', () => {
        const pkg = JSON.parse(read('package.json')) as {
            scripts?: Record<string, string>;
        };
        expect(pkg.scripts?.['build:worker']).toBeDefined();
    });

    it('the worker build script exists', () => {
        expect(fs.existsSync(path.join(ROOT, 'scripts/build-worker.mjs'))).toBe(true);
    });
});
