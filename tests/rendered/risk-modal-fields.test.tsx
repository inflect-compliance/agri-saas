/**
 * Risk create/edit modal changes (2026-06-06), 10 fixes:
 *   R1 Matrix label · R2 no AI Assessment button · R3 create owner picker ·
 *   R4 link-controls reads {rows} + no truncation · R5 create "Risk
 *   Evaluation" title · R6 edit matches create's evaluation box · R7 create
 *   Treatment dropdown · R8 edit category/treatment full-width · R9 edit
 *   "Assigned to" → "Owner" · R10 create Treatment notes.
 *
 * Rendered checks for the shared evaluation box + the edit modal; source
 * checks for the create modal (heavy useQuery deps) + page + i18n.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/risks',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import { CreateRiskSchema } from '@/lib/schemas';
import { RiskEvaluationFields } from '@/app/t/[tenantSlug]/(app)/risks/_shared/RiskEvaluationFields';
import { EditRiskModal } from '@/app/t/[tenantSlug]/(app)/risks/[riskId]/_modals/EditRiskModal';

beforeEach(() => {
    global.fetch = jest.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
    ) as unknown as typeof fetch;
});

function withClient(node: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TooltipProvider>{node}</TooltipProvider>
        </QueryClientProvider>,
    );
}

const SRC_ROOT = path.join(__dirname, '..', '..', 'src/app/t/[tenantSlug]/(app)/risks');
const read = (p: string) => fs.readFileSync(path.join(SRC_ROOT, p), 'utf8');

describe('RiskEvaluationFields (shared, R5/R6)', () => {
    it('renders the "Risk Evaluation" title, two range sliders, and a live score', () => {
        const { container } = render(
            <TooltipProvider>
                <RiskEvaluationFields
                    likelihood={4}
                    impact={3}
                    onLikelihood={() => {}}
                    onImpact={() => {}}
                />
            </TooltipProvider>,
        );
        expect(screen.getByText('Risk Evaluation')).not.toBeNull();
        expect(container.querySelectorAll('input[type="range"]').length).toBe(2);
        expect(screen.getByText('12')).not.toBeNull(); // 4 × 3
        expect(screen.getByText('Medium')).not.toBeNull();
    });

    it('honours idPrefix for stable element ids', () => {
        render(
            <TooltipProvider>
                <RiskEvaluationFields idPrefix="risk-edit" likelihood={1} impact={1} onLikelihood={() => {}} onImpact={() => {}} />
            </TooltipProvider>,
        );
        expect(document.getElementById('risk-edit-likelihood')).not.toBeNull();
        expect(document.getElementById('risk-edit-impact')).not.toBeNull();
    });
});

describe('EditRiskModal (R6/R8/R9)', () => {
    function renderEdit() {
        return withClient(
            <EditRiskModal
                open
                setOpen={() => {}}
                form={{ title: 'Risk A', likelihood: 2, impact: 2, category: '', treatment: '', ownerUserId: '' }}
                setForm={() => {}}
                saving={false}
                error={null}
                tenantSlug="acme"
                categoryOptions={[{ value: 'Technical', label: 'Technical' }]}
                treatmentOptions={[{ value: 'TREAT', label: 'Treat' }]}
                onCancel={() => {}}
                onSubmit={() => {}}
            />,
        );
    }

    it('uses the shared "Risk Evaluation" box (not the old NumberStepper) and renames the owner label', () => {
        renderEdit();
        expect(screen.getByText('Risk Evaluation')).not.toBeNull();
        expect(document.querySelectorAll('input[type="range"]').length).toBe(2);
        expect(screen.getByText('Owner')).not.toBeNull();
        expect(screen.queryByText('Assigned to')).toBeNull();
    });

    it('category + treatment dropdowns are full-width (no truncation)', () => {
        renderEdit();
        const fullWidth = document.querySelectorAll('button.w-full');
        expect(fullWidth.length).toBeGreaterThanOrEqual(2); // category + treatment
    });
});

describe('NewRiskModal source (R3/R4/R7/R10)', () => {
    const src = read('NewRiskModal.tsx');
    it('R3 — owner is a UserCombobox bound to ownerUserId, labelled "Owner"', () => {
        expect(src).toMatch(/<UserCombobox[\s\S]*id="risk-owner"/);
        expect(src).toMatch(/label="Owner"/);
        expect(src).not.toMatch(/label="Treatment owner"/);
    });
    it('R4 — link-controls reads the {rows} shape, and the name span is not truncated', () => {
        expect(src).toMatch(/data\?\.rows/);
        expect(src).not.toMatch(/truncate text-content-emphasis/);
    });
    it('R7 + R10 — Treatment dropdown + Treatment notes present', () => {
        expect(src).toMatch(/id="risk-treatment"/);
        expect(src).toMatch(/id="risk-treatment-notes"/);
        expect(src).toMatch(/RISK_TREATMENT_OPTIONS/);
    });
});

describe('CreateRiskSchema retains the create-modal fields (R3 + strip-bug)', () => {
    it('no longer strips ownerUserId / category / description / nextReviewAt', () => {
        const parsed = CreateRiskSchema.parse({
            title: 'Server outage',
            description: 'A description',
            category: 'Technical',
            likelihood: 4,
            impact: 3,
            ownerUserId: 'u-9',
            treatment: 'TREAT',
            treatmentNotes: 'mitigation plan',
            nextReviewAt: '2026-12-01',
        });
        expect(parsed.ownerUserId).toBe('u-9');
        expect(parsed.category).toBe('Technical');
        expect(parsed.description).toBe('A description');
        expect(parsed.nextReviewAt).toBe('2026-12-01');
        expect(parsed.treatment).toBe('TREAT');
        expect(parsed.treatmentNotes).toBe('mitigation plan');
    });
});

describe('Risks page + i18n (R1/R2)', () => {
    it('R2 — the AI Assessment button is gone', () => {
        const src = read('RisksClient.tsx');
        expect(src).not.toMatch(/ai-risk-btn/);
        expect(src).not.toMatch(/AI Assessment/);
    });
    it('the L × I column is removed from the risk table', () => {
        const src = read('RisksClient.tsx');
        expect(src).not.toMatch(/id: 'lxi'/);
        expect(src).not.toMatch(/L ?× ?I/);
    });
    it('R1 — the matrix toggle label is "Matrix"', () => {
        const messages = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', 'messages/en.json'), 'utf8'),
        );
        // find the Risks namespace (has heatmap + register siblings)
        const ns = Object.values(messages).find(
            (v): v is Record<string, string> =>
                !!v && typeof v === 'object' && 'heatmap' in (v as object) && 'register' in (v as object),
        );
        expect(ns?.heatmap).toBe('Matrix');
    });
});
