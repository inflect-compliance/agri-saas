/**
 * VR-4 — automation inspector panel ratchet.
 *
 * Locks the inline rule editor + its mode/kind-gated mount in ProcessInspector.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('VR-4 — automation inspector', () => {
    it('the panel component exists and edits the rule (not the node)', () => {
        const p = 'src/components/processes/AutomationInspectorPanel.tsx';
        expect(exists(p)).toBe(true);
        const src = read(p);
        // edits flow to the rule endpoint, per-kind branches present
        expect(src).toMatch(/CACHE_KEYS\.automation\.rules\.detail/);
        for (const kind of ['trigger', 'condition', 'action', 'slaGate']) {
            expect(src).toMatch(new RegExp(`'${kind}'`));
        }
    });

    it('ProcessInspector mounts it gated on automation mode + node kind', () => {
        const src = read('src/components/processes/ProcessInspector.tsx');
        expect(src).toMatch(/useIsAutomationMode/);
        expect(src).toMatch(/isAutomationNodeKind/);
        expect(src).toMatch(/AutomationInspectorPanel/);
    });
});
