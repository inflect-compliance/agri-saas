/**
 * VR-5 — visual chain edges ratchet.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('VR-5 — chain edges', () => {
    it('the edge-kind inference module exists with the 6 automation kinds', () => {
        const p = 'src/lib/processes/edge-kind-inference.ts';
        expect(exists(p)).toBe(true);
        const src = read(p);
        for (const k of [
            'trigger-flow',
            'condition-pass',
            'condition-fail',
            'chain-delay',
            'sla-breach',
            'sla-pass',
        ]) {
            expect(src).toMatch(new RegExp(k));
        }
        expect(src).toMatch(/export function inferEdgeKind/);
    });

    it('ProcessEdge renders a per-kind automation style + chip', () => {
        const src = read('src/components/processes/ProcessEdge.tsx');
        expect(src).toMatch(/AUTOMATION_EDGE_STYLE/);
        expect(src).toMatch(/data-edge-kind-chip/);
    });
});
