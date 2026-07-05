/**
 * Visual editor reachability ratchet (PR-B).
 *
 * The VR roadmap shipped three pieces of dead code + an unreachable feature.
 * This ratchet keeps them WIRED so they can't silently revert to inert:
 *   - the live-execution overlay provider + run-mode provider are MOUNTED;
 *   - the edge-kind inference is CALLED on connect (not dead);
 *   - AUTOMATION canvas mode is CREATABLE from the UI;
 *   - a Run Mode toggle exists.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CANVAS = 'src/components/processes/PersistedProcessCanvas.tsx';
const DOCBAR = 'src/components/processes/CanvasDocumentBar.tsx';

describe('visual editor reachability', () => {
    it('mounts the run-mode + overlay providers (VR-6 was dead code)', () => {
        const src = read(CANVAS);
        expect(src).toMatch(/<RunModeProvider>/);
        expect(src).toMatch(/<CanvasOverlayProvider/);
    });

    it('calls inferEdgeKind on connect (VR-5 was dead code)', () => {
        const src = read(CANVAS);
        expect(src).toMatch(/inferEdgeKind\(/);
        // and the inferred kind reaches the new edge's data
        expect(src).toMatch(/edgeKind: inferred/);
    });

    it('AUTOMATION canvas mode is creatable from the UI', () => {
        const src = read(CANVAS);
        expect(src).toMatch(/handleNew\("AUTOMATION"\)/);
        expect(src).toMatch(/persistedCanvas\.cmdNewAutomation/);
    });

    it('exposes a Run Mode toggle in the document bar', () => {
        const src = read(DOCBAR);
        expect(src).toMatch(/useRunMode/);
        expect(src).toMatch(/run-mode-toggle/);
    });
});
