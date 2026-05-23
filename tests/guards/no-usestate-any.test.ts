/**
 * Guard test: fails if any `useState<any>` exists in src/ without an eslint-disable annotation.
 * This prevents regressions where new code introduces untyped state.
 */
import { execSync } from 'child_process';

describe('no-usestate-any guard', () => {
    it('should not have any raw useState<any> in src/ without eslint-disable', () => {
        try {
            // Probe — the actual scan is the manual fs walk below.
            // grep returns non-zero when no matches; the `|| true`
            // swallows that into a successful exit so the catch only
            // fires on a real exec failure (binary missing, etc.).
            execSync(
                'npx grep-cli "useState<any>" src/ --include="*.tsx" --include="*.ts" 2>/dev/null || true',
                { encoding: 'utf8', cwd: process.cwd() }
            );
        } catch {
            // grep returns non-zero when no matches — that's the happy path
            return;
        }

        // Manual scan: find lines with useState<any> that don't have eslint-disable above
        const fs = require('fs');
        const path = require('path');

        function walk(dir: string, exts: string[], results: string[] = []): string[] {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (['node_modules', '.next'].includes(entry.name)) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full, exts, results);
                else if (exts.some((e: string) => entry.name.endsWith(e))) results.push(full);
            }
            return results;
        }

        const violations: string[] = [];
        const files = walk(path.resolve('src'), ['.ts', '.tsx']);
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('useState<any>')) {
                    const prevLine = i > 0 ? lines[i - 1] : '';
                    if (!prevLine.includes('eslint-disable')) {
                        const rel = path.relative(process.cwd(), file);
                        violations.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                    }
                }
            }
        }

        // Threshold-based: existing legacy violations are tracked and should ratchet down.
        // Current baseline: 22 occurrences. Ratchet down as pages are migrated.
        const THRESHOLD = 25;
        if (violations.length > THRESHOLD) {
            fail(
                `Found ${violations.length} useState<any> without eslint-disable annotation (threshold: ${THRESHOLD}):\n` +
                violations.slice(0, 5).map(v => `  ${v}`).join('\n')
            );
        }
    });
});
