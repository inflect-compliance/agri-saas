/**
 * CI Guardrail Tests — Issue → Task Migration
 *
 * These tests scan the codebase to ensure that legacy Issue model references
 * do not creep back in. They enforce "Tasks are the only work item."
 */
import fs from 'fs';
import path from 'path';
import { readPrismaSchema } from '../helpers/prisma-schema';

const SRC_DIR = path.resolve(__dirname, '../../src');

function grepFiles(pattern: RegExp, dir: string, extensions: string[]): { file: string; line: number; content: string }[] {
    const results: { file: string; line: number; content: string }[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '.next', '.git', 'dist'].includes(entry.name)) continue;
                walk(full);
            } else if (extensions.some(ext => entry.name.endsWith(ext))) {
                const content = fs.readFileSync(full, 'utf-8');
                content.split('\n').forEach((line, i) => {
                    if (pattern.test(line)) {
                        results.push({ file: path.relative(SRC_DIR, full), line: i + 1, content: line.trim() });
                    }
                });
            }
        }
    };
    walk(dir);
    return results;
}

// Allowed files that contain legacy Issue references as shims/compatibility wrappers
const ALLOWED_LEGACY_FILES = [
    'repositories/IssueRepository.ts',     // thin re-export
    'repositories/EvidenceBundleRepository.ts', // stubbed
    'usecases/issue.ts',                   // delegation wrapper
    'policies/issue.policies.ts',          // policy stubs
    'events/audit.ts',                     // event names
];

function isAllowed(file: string): boolean {
    return ALLOWED_LEGACY_FILES.some(allowed => file.replace(/\\/g, '/').endsWith(allowed));
}

describe('Issue → Task Migration Guardrails', () => {
    test('Prisma schema must NOT contain Issue model', () => {
        const schema = readPrismaSchema();
        const issueModels = schema.match(/^model\s+(Issue|IssueLink|IssueComment|IssueWatcher|IssueEvidenceBundle)\s*\{/gm);
        expect(issueModels).toBeNull();
    });

    test('No code references db.issue (raw Prisma Issue model access)', () => {
        const hits = grepFiles(/\bdb\.issue\b(?!s)/, SRC_DIR, ['.ts', '.tsx'])
            .filter(h => !isAllowed(h.file));
        if (hits.length > 0) {
            const summary = hits.map(h => `  ${h.file}:${h.line}  ${h.content}`).join('\n');
            fail(`Found ${hits.length} references to db.issue (should use db.task):\n${summary}`);
        }
    });

    test('No code references db.issueLink/db.issueComment/db.issueWatcher', () => {
        const hits = grepFiles(/\bdb\.(issueLink|issueComment|issueWatcher|issueEvidenceBundle)\b/, SRC_DIR, ['.ts', '.tsx'])
            .filter(h => !isAllowed(h.file));
        if (hits.length > 0) {
            const summary = hits.map(h => `  ${h.file}:${h.line}  ${h.content}`).join('\n');
            fail(`Found references to legacy Issue sub-models:\n${summary}`);
        }
    });

    test('No new Prisma model with "Issue" in the name', () => {
        const schema = readPrismaSchema();
        const models = schema.match(/^model\s+\w*Issue\w*\s*\{/gm);
        expect(models).toBeNull();
    });

    test('Issue API routes only delegate to Task usecases (no standalone logic)', () => {
        const issueRoutesDir = path.join(SRC_DIR, 'app/api/t/[tenantSlug]/issues');
        if (!fs.existsSync(issueRoutesDir)) return; // routes already removed

        const hits = grepFiles(/from\s+['"].*repositories.*Issue/i, issueRoutesDir, ['.ts'])
            .filter(h => !h.content.includes('@/app-layer/usecases/issue'));
        expect(hits.length).toBe(0);
    });

    test('Tasks are the only work item: no model creates Issue-based entities', () => {
        const hits = grepFiles(/prisma\.issue\.create|prisma\.issueLink\.create|prisma\.issueComment\.create/, SRC_DIR, ['.ts', '.tsx']);
        expect(hits.length).toBe(0);
    });
});
