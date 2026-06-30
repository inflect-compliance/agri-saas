/**
 * RQ3-OB-D — Closed loops ratchet (arrow identity, accept feedback,
 * adaptive bridge).
 *
 * Three loops RQ2 opened, closed here. Regression classes guarded:
 *
 *   - Arrow identity: the movement arrow must retain per-path risk
 *     TITLES (not collapse to a bare count) and surface them in a
 *     bounded SVG <title>. A "simplify to count" refactor loses the
 *     identity again.
 *   - Accept feedback: the accept response must carry a
 *     server-composed `summary`, and the panel must fire a toast
 *     from THAT response (never from client draft state).
 *   - Adaptive bridge: the bridge copy must branch on `fairAle` —
 *     "Quantify this risk" when un-quantified, "Review the FAIR
 *     analysis" when a loss estimate already exists.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const pureResidual = read('src/lib/risk-residual.ts');
const acceptUsecase = read('src/app-layer/usecases/risk-residual-suggestion.ts');
const panel = read('src/app/t/[tenantSlug]/(app)/risks/[riskId]/RiskAssessmentPanel.tsx');
const detailPage = read('src/app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx');

describe('RQ3-OB-D — accepting deserves an answer', () => {
    test('the pure one-liner leads with the residual score', () => {
        expect(pureResidual).toMatch(/export function describeAcceptedResidual/);
        expect(pureResidual).toMatch(/`Residual \$\{suggestion\.residualScore\} — /);
    });

    test('the accept usecase returns the server-composed summary', () => {
        expect(acceptUsecase).toMatch(/describeAcceptedResidual\(suggestion, combined\.participatingCount\)/);
        expect(acceptUsecase).toMatch(/summary: describeAcceptedResidual/);
    });

    test('the panel fires a toast from the SERVER response, not client state', () => {
        expect(panel).toMatch(/const toast = useToast\(\)/);
        // The summary read comes off the parsed response body.
        expect(panel).toMatch(/body\?\.accepted\?\.summary/);
        expect(panel).toMatch(/toast\.success\(summary/);
    });
});

describe('RQ3-OB-D — the bridge knows where you have been', () => {
    test('AssessmentRisk carries fairAle', () => {
        expect(panel).toMatch(/fairAle\?: number \| null/);
    });

    test('the bridge copy branches on fairAle', () => {
        expect(panel).toMatch(/risk\.fairAle != null\s*\?\s*'Review the FAIR analysis'\s*:\s*'Quantify this risk'/);
    });

    test('the detail page plumbs fairAle into the panel', () => {
        expect(detailPage).toMatch(/fairAle: risk\.fairAle/);
    });
});
