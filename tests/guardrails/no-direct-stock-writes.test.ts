/**
 * Guardrail: the stock ledger has exactly one writer.
 *
 * StockTransaction is the append-only, hash-chained inventory ledger.
 * Every append MUST flow through `appendStockTransaction` in
 * `src/lib/inventory/stock-ledger.ts` so that the per-tenant hash chain
 * and the denormalised `InventoryLot.quantityOnHand` cache stay
 * consistent within one advisory-locked step. A direct
 * `db.stockTransaction.create(...)` from a usecase or repository would
 * write an unchained row (breaking `verifyStockChain`) and skip the
 * cache refresh.
 *
 * This ratchet scans the source tree for direct StockTransaction write
 * calls and fails on any found outside the one sanctioned writer. It is
 * the structural twin of the DB immutability trigger (which blocks
 * UPDATE/DELETE) — together they make "append-only, single-writer" a
 * property the codebase cannot regress out of silently.
 *
 * Mirrors the spirit of the AuditLog append-only enforcement.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = [path.join(REPO_ROOT, 'src')];

/** The ONLY file allowed to write StockTransaction rows. */
const SANCTIONED_WRITER = path.join(REPO_ROOT, 'src/lib/inventory/stock-ledger.ts');

/** Prisma write verbs on the stockTransaction model. */
const WRITE_RE =
    /\.stockTransaction\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

function walk(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            out.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('stock ledger — single writer', () => {
    const files = SCAN_DIRS.flatMap(walk);

    it('detector finds a non-trivial number of source files (sanity)', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('only src/lib/inventory/stock-ledger.ts writes StockTransaction rows directly', () => {
        const violations: string[] = [];
        for (const file of files) {
            if (file === SANCTIONED_WRITER) continue;
            const src = fs.readFileSync(file, 'utf8');
            const matches = [...src.matchAll(WRITE_RE)];
            if (matches.length > 0) {
                const rel = path.relative(REPO_ROOT, file);
                const verbs = [...new Set(matches.map((m) => m[1]))].join(', ');
                violations.push(`${rel} — direct stockTransaction.${verbs}`);
            }
        }
        if (violations.length > 0) {
            throw new Error(
                'Direct StockTransaction write(s) detected outside the sanctioned ledger writer:\n  ' +
                    violations.join('\n  ') +
                    '\n\nAppend via `appendStockTransaction(db, ctx, ...)` from ' +
                    '`@/lib/inventory/stock-ledger` instead — it extends the hash chain ' +
                    'and refreshes the lot on-hand cache atomically.',
            );
        }
        expect(violations).toEqual([]);
    });

    it('the sanctioned writer actually exists + writes the ledger (anti-staleness)', () => {
        expect(fs.existsSync(SANCTIONED_WRITER)).toBe(true);
        const src = fs.readFileSync(SANCTIONED_WRITER, 'utf8');
        expect(WRITE_RE.test(src)).toBe(true);
    });
});
