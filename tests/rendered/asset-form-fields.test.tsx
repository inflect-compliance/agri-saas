/**
 * Asset create/edit form field changes (2026-06-06):
 *   - Create: classification + data-residency are dropdowns; owner is a
 *     people-picker; a "Risk Assessment" section titles the C/I/A triple.
 *   - Edit: 'Assigned to' → 'Owner'; the free-text 'Owner (label)' and
 *     'External Ref' fields are gone; classification is a dropdown; the
 *     dropdown triggers are full-width (no truncation).
 *   - Detail: the 'Suggest Risks' action is gone; the C/I/A block is
 *     titled 'Risk Assessment'.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/assets',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { NewAssetFields } from '@/app/t/[tenantSlug]/(app)/assets/_form/NewAssetFields';
import { EditAssetFields } from '@/app/t/[tenantSlug]/(app)/assets/_form/EditAssetFields';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockForm(fields: Record<string, any>): any {
    return {
        fields,
        setField: jest.fn(),
        touchField: jest.fn(),
        fieldError: () => undefined,
        submitting: false,
        error: null,
        canSubmit: true,
        submit: jest.fn(),
        isDirty: false,
    };
}

const NEW_LABELS = {
    name: 'Name', type: 'Type', classification: 'Classification',
    classificationPlaceholder: '', owner: 'Owner', location: 'Location',
    dataResidency: 'Data Residency', residencyPlaceholder: '',
    confidentiality: 'Confidentiality', integrity: 'Integrity', availability: 'Availability',
};

describe('NewAssetFields (create)', () => {
    const form = mockForm({
        name: '', type: 'SYSTEM', status: 'ACTIVE', classification: '', ownerUserId: '',
        location: '', dataResidency: '', confidentiality: 3, integrity: 3, availability: 3,
    });

    it('classification + data-residency + owner + status are dropdowns (buttons), not text inputs', () => {
        withClient(<NewAssetFields form={form} labels={NEW_LABELS} tenantSlug="acme" />);
        for (const id of ['asset-classification-input', 'asset-data-residency-input', 'asset-owner-input', 'asset-status-select']) {
            const el = document.getElementById(id);
            expect(el).not.toBeNull();
            expect(el!.tagName.toLowerCase()).toBe('button'); // Combobox/UserCombobox trigger
        }
    });

    it('titles the C/I/A box "Asset Criticality" with sliders + a score', () => {
        const { container } = withClient(<NewAssetFields form={form} labels={NEW_LABELS} tenantSlug="acme" />);
        expect(screen.getByText('Asset Criticality')).not.toBeNull();
        // C/I/A are sliders now (not NumberSteppers)
        expect(container.querySelectorAll('input[type="range"]').length).toBe(3);
        expect(screen.getByTestId('asset-criticality-score')).not.toBeNull();
    });
});

describe('EditAssetFields (edit)', () => {
    const form = mockForm({
        name: 'A', type: 'SYSTEM', criticality: 'MEDIUM', status: 'ACTIVE',
        ownerUserId: '', owner: 'legacy', externalRef: 'EXT-1', classification: '', location: '',
        dataResidency: '', confidentiality: 3, integrity: 3, availability: 3,
    });

    it("renames 'Assigned to' → 'Owner' and drops 'Owner (label)' + 'External Ref'", () => {
        withClient(<EditAssetFields form={form} tenantSlug="acme" />);
        expect(screen.getByText('Owner')).not.toBeNull();
        expect(screen.queryByText('Assigned to')).toBeNull();
        expect(screen.queryByText('Owner (label)')).toBeNull();
        expect(screen.queryByText('External Ref')).toBeNull();
    });

    it('drops the Criticality dropdown and gains Data Residency (parity with create)', () => {
        const { container } = withClient(<EditAssetFields form={form} tenantSlug="acme" />);
        // Scope to field labels (the score badge also renders "Criticality").
        const labels = [...container.querySelectorAll('label.input-label')].map(
            (l) => l.textContent,
        );
        expect(labels).not.toContain('Criticality');
        expect(labels).toContain('Data Residency');
        expect(labels).toContain('Status');
    });

    it('classification is a dropdown (button) + all dropdown triggers are full-width', () => {
        const { container } = withClient(<EditAssetFields form={form} tenantSlug="acme" />);
        // Every Combobox trigger button carries w-full (truncation fix).
        const triggers = container.querySelectorAll('button.w-full');
        expect(triggers.length).toBeGreaterThanOrEqual(4); // type, criticality, status, classification
    });
});

describe('asset detail page source', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src/app/t/[tenantSlug]/(app)/assets/[id]/page.tsx'),
        'utf8',
    );
    it('no longer renders the Suggest Risks action', () => {
        expect(src).not.toMatch(/suggest-risks-btn/);
        expect(src).not.toMatch(/Suggest Risks/);
    });
    it('titles the criticality block "Asset Criticality" and shows only the score (no C/I/A breakdown)', () => {
        expect(src).toMatch(/Asset Criticality/);
        expect(src).not.toMatch(/Risk Assessment/);
        expect(src).toMatch(/AssetCriticalityBadge/);
        expect(src).not.toMatch(/label="Confidentiality"/);
    });
});
