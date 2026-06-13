/**
 * Guardrail: license hygiene (the product stays proprietary).
 *
 * Per ag-saas/PLAN.md + REPOS.md: concepts/schemas/algorithms from
 * GPL/AGPL farm projects may be reimplemented in our own code, but
 * literal code is NEVER copied. This ratchet scans our source for two
 * tell-tales of a copy-paste:
 *
 *   1. a GPL / AGPL / LGPL license header, and
 *   2. an import from a known GPL/AGPL farm package.
 *
 * Permissive deps (shpjs MIT, @tmcw/togeojson BSD-2, MapLibre BSD-3,
 * terra-draw MIT, InvenTree/Permastead schema ports with attribution)
 * are fine and not matched here. Prose that merely *says* "no GPL code"
 * is not a header and is not matched.
 */
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['src', 'scripts'];

// A real GPL/AGPL/LGPL *license header*, not a passing mention.
const GPL_HEADER =
    /SPDX-License-Identifier:\s*"?(?:LGPL|GPL|AGPL)[\w.+-]*|GNU\s+(?:Affero\s+|Lesser\s+)?General\s+Public\s+License|This program is free software[\s\S]{0,120}?GNU/i;

// An import/require from a known GPL/AGPL farm codebase.
const GPL_FARM_IMPORT =
    /(?:from|require\()\s*['"][^'"]*(farmos|litefarm|ekylibre|qrop|cropplanning|erpnext|frappe-?agriculture|nekazari-core)[^'"]*['"]/i;

describe('Guardrail: license hygiene (no GPL/AGPL code copied)', () => {
    it('no GPL/AGPL license headers or GPL farm-package imports in our source', async () => {
        const violations: string[] = [];

        for (const dir of SCAN_DIRS) {
            const cwd = path.join(ROOT, dir);
            if (!fs.existsSync(cwd)) continue;
            const files = await glob('**/*.{ts,tsx,js,mjs,cjs}', { cwd, posix: true });
            for (const rel of files) {
                const content = fs.readFileSync(path.join(cwd, rel), 'utf-8');
                if (GPL_HEADER.test(content)) {
                    violations.push(`${dir}/${rel}: contains a GPL/AGPL/LGPL license header`);
                }
                const imp = content.match(GPL_FARM_IMPORT);
                if (imp) {
                    violations.push(`${dir}/${rel}: imports from a GPL/AGPL farm package (${imp[1]})`);
                }
            }
        }

        if (violations.length > 0) {
            throw new Error(
                'License-hygiene violation. The product is proprietary — never copy GPL/AGPL code ' +
                '(farmOS, LiteFarm, Ekylibre, Qrop, ERPNext/frappe-agriculture, …). Reimplement the ' +
                'concept in our own code instead:\n' +
                violations.map((v) => `  ${v}`).join('\n'),
            );
        }
    });
});
