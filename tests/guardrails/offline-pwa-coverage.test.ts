/**
 * Guardrail: offline operator PWA wiring + invariants.
 *
 * Locks the load-bearing pieces of the queue-and-sync PWA:
 *   1. A valid, installable web app manifest exists and is linked.
 *   2. The service worker NEVER caches the API and NEVER touches non-GET
 *      requests — offline writes are the outbox's job, not the SW's. A SW
 *      that cached /api or swallowed a PATCH would serve stale tenant data
 *      or silently drop a mutation.
 *   3. The outbox store is a single seam: UI goes through `useOfflineSync`,
 *      not `getOutboxStore()` directly (mirrors the terra-draw / react-
 *      window single-seam discipline).
 *   4. The SW registrar is mounted in the root layout.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(REPO_ROOT, rel));

// ─── 1 — manifest ──────────────────────────────────────────────────

describe('PWA manifest', () => {
    it('exists and is valid installable JSON', () => {
        expect(exists('public/manifest.webmanifest')).toBe(true);
        const m = JSON.parse(read('public/manifest.webmanifest'));
        expect(m.name).toBeTruthy();
        expect(m.display).toBe('standalone');
        expect(Array.isArray(m.icons)).toBe(true);
        expect(m.icons.length).toBeGreaterThan(0);
        expect(m.start_url).toBeTruthy();
    });

    it('is linked + the SW registrar is mounted in the root layout', () => {
        const layout = read('src/app/layout.tsx');
        expect(layout).toMatch(/manifest:\s*['"]\/manifest\.webmanifest['"]/);
        expect(layout).toMatch(/ServiceWorkerRegistrar/);
    });
});

// ─── 2 — service worker safety ─────────────────────────────────────

describe('service worker safety', () => {
    const sw = () => read('public/sw.js');

    it('exists', () => {
        expect(exists('public/sw.js')).toBe(true);
    });

    it('never caches the API + bails on non-GET', () => {
        const src = sw();
        // Explicit guards present.
        expect(src).toMatch(/method\s*!==\s*['"]GET['"]/);
        expect(src).toMatch(/\/api\//);
        // No cache write keyed on an /api/ request anywhere.
        expect(/cache\.put\([^)]*\/api\//.test(src)).toBe(false);
    });
});

// ─── 3 — outbox single seam ────────────────────────────────────────

function walk(dir: string): string[] {
    const out: string[] = [];
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(rel));
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
}

describe('outbox single seam', () => {
    it('only the offline lib references the raw outbox store', () => {
        const offenders = walk('src')
            .filter((rel) => !rel.startsWith(path.join('src', 'lib', 'offline')))
            .filter((rel) => /getOutboxStore|new LocalStorageOutboxStore|new InMemoryOutboxStore/.test(read(rel)));
        expect(offenders).toEqual([]);
    });

    it('the operator panel goes through useOfflineSync', () => {
        const panel = read('src/components/offline/OfflineFieldPanel.tsx');
        expect(panel).toMatch(/useOfflineSync/);
        expect(/getOutboxStore/.test(panel)).toBe(false);
    });
});
