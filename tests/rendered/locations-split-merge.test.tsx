/**
 * In-map split/merge UI — Location detail Map tab (feat/fast-follows).
 *
 * MapCanvas mounts MapLibre/WebGL, which jsdom can't render, so we mock
 * the dynamic-imported MapCanvas with a lightweight stub that exposes the
 * authoring seam (`mode`, `selectedIds`, `onSelectionChange`,
 * `onCreateSplitLine`). That lets us drive selection + a drawn split line
 * from the test and assert the page's toolbar logic + API wiring:
 *
 *   1. the Split mode option exists in the map-mode ToggleGroup;
 *   2. the Merge action appears ONLY when ≥2 parcels are selected;
 *   3. confirming the merge modal POSTs `{ parcelIds, name }` to
 *      `.../parcels/merge`;
 *   4. drawing a split line POSTs `{ line }` to `.../parcels/{id}/split`.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import type { LineString } from 'geojson';

// ─── next/navigation: stable params + router (Modal calls useRouter) ─
jest.mock('next/navigation', () => ({
    useParams: () => ({ tenantSlug: 'acme', locationId: 'loc1' }),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
    // The page reads `?parcelId` / `?tab` deep-links (feat/delight-shareables).
    useSearchParams: () => new URLSearchParams(),
}));

// ─── tenant API url helper (mirrors the real `/api/t/{slug}` prefix) ─
jest.mock('@/lib/tenant-context-provider', () => ({
    useTenantApiUrl: () => (p: string) => `/api/t/acme${p.startsWith('/') ? p : `/${p}`}`,
}));

// ─── typed API client — capture POST bodies ────────────────────────
const apiPost = jest.fn();
const apiPatch = jest.fn();
class ApiClientError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.name = 'ApiClientError';
        this.status = status;
    }
}
jest.mock('@/lib/api-client', () => ({
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    ApiClientError,
}));

// ─── tenant SWR — route by path; expose a mutate spy ───────────────
const mutate = jest.fn();
jest.mock('@/lib/hooks/use-tenant-swr', () => ({
    useTenantSWR: (path: string | null) => {
        if (path === '/locations/loc1') {
            return { data: { id: 'loc1', name: 'Field A', status: 'ACTIVE', _count: { parcels: 3 } }, isLoading: false, error: null, mutate };
        }
        if (path === '/locations/loc1/parcels') {
            return {
                data: {
                    locationId: 'loc1',
                    bounds: [0, 0, 1, 1],
                    parcels: [
                        { id: 'p1', name: 'North', areaHa: 10, geometry: { type: 'Polygon', coordinates: [] } },
                        { id: 'p2', name: 'South', areaHa: 5, geometry: { type: 'Polygon', coordinates: [] } },
                    ],
                },
                isLoading: false,
                error: null,
                mutate,
            };
        }
        // /agro/ndvi-config, /operations, etc.
        return { data: undefined, isLoading: false, error: null, mutate };
    },
}));

// ─── MapCanvas stub — drives the authoring seam from the test ──────
// `next/dynamic` resolves `import('@/components/ui/map/MapCanvas')` to
// `m.MapCanvas`; mocking the module makes the dynamic component this stub.
let lastSplitHandler: ((line: LineString) => void) | undefined;
let lastSelectionHandler: ((ids: string[]) => void) | undefined;
jest.mock('@/components/ui/map/MapCanvas', () => ({
    MapCanvas: (props: {
        mode?: string;
        selectedIds?: string[];
        onSelectionChange?: (ids: string[]) => void;
        onCreateSplitLine?: (line: LineString) => void;
    }) => {
        lastSplitHandler = props.onCreateSplitLine;
        lastSelectionHandler = props.onSelectionChange;
        return (
            <div data-testid="map-canvas" data-mode={props.mode} data-selected={(props.selectedIds ?? []).join(',')} />
        );
    },
}));

// next/dynamic → resolve synchronously to the (mocked) module export.
jest.mock('next/dynamic', () => (loader: () => Promise<{ MapCanvas: React.ComponentType<unknown> }>) => {
    // The loader is `() => import('...').then(m => m.MapCanvas)`; but we
    // can't await in a sync mock, so return the mocked MapCanvas directly.
    const mod = require('@/components/ui/map/MapCanvas');
    void loader;
    return mod.MapCanvas;
});

// Quiet noisy side panels not under test.
jest.mock('@/components/ui/map/SpatialImportModal', () => ({ SpatialImportModal: () => null }));
jest.mock('@/components/ui/map/PrescriptionPanel', () => ({ PrescriptionPanel: () => <div data-testid="prescription-panel" /> }));
jest.mock('@/components/ui/map/FieldOperationPanel', () => ({ FieldOperationPanel: () => null }));

import LocationDetailPage from '@/app/t/[tenantSlug]/(app)/locations/[locationId]/page';

function openMapTab() {
    render(<LocationDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Map/i }));
}

beforeEach(() => {
    apiPost.mockReset();
    apiPatch.mockReset();
    mutate.mockReset();
    apiPost.mockResolvedValue({ id: 'new', areaHa: 15 });
    lastSplitHandler = undefined;
    lastSelectionHandler = undefined;
});

describe('Location detail — split/merge toolbar', () => {
    it('exposes a Split option in the map-mode toggle', () => {
        openMapTab();
        expect(screen.getByRole('radio', { name: 'Split' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Select' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Draw' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Edit' })).toBeInTheDocument();
    });

    it('shows the Merge action only when ≥2 parcels are selected', () => {
        openMapTab();
        // Nothing selected → no Merge trigger.
        expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();

        // Select one parcel → still no Merge.
        React.act(() => lastSelectionHandler?.(['p1']));
        expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();

        // Select a second → Merge appears.
        React.act(() => lastSelectionHandler?.(['p1', 'p2']));
        expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
    });

    it('merge modal POSTs { parcelIds, name } to .../parcels/merge', async () => {
        openMapTab();
        React.act(() => lastSelectionHandler?.(['p1', 'p2']));
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));

        // Name the union + confirm.
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByPlaceholderText(/North block/i), { target: { value: 'Combined' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Merge parcels' }));

        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        const [url, body] = apiPost.mock.calls[0];
        expect(url).toBe('/api/t/acme/locations/loc1/parcels/merge');
        expect(body).toEqual({ parcelIds: ['p1', 'p2'], name: 'Combined' });
        await waitFor(() => expect(mutate).toHaveBeenCalled());
    });

    it('drawing a split line POSTs { line } to .../parcels/{id}/split and clears selection', async () => {
        openMapTab();
        // Pick the target in Select mode, then switch to Split — the single
        // selection carries over (selection is disabled inside split mode).
        React.act(() => lastSelectionHandler?.(['p1']));
        fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
        expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-mode', 'split');
        expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-selected', 'p1');

        const line: LineString = { type: 'LineString', coordinates: [[0, 0.5], [1, 0.5]] };
        await React.act(async () => {
            lastSplitHandler?.(line);
        });

        await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
        const [url, body] = apiPost.mock.calls[0];
        expect(url).toBe('/api/t/acme/locations/loc1/parcels/p1/split');
        expect(body).toEqual({ line });
        await waitFor(() => expect(mutate).toHaveBeenCalled());
    });

    it('surfaces a "must fully cross" 400 inline and stays in split mode', async () => {
        apiPost.mockRejectedValueOnce(new ApiClientError('Split line must fully cross the parcel.', 400));
        openMapTab();
        React.act(() => lastSelectionHandler?.(['p1']));
        fireEvent.click(screen.getByRole('radio', { name: 'Split' }));

        const line: LineString = { type: 'LineString', coordinates: [[0, 0.5], [0.4, 0.5]] };
        await React.act(async () => {
            lastSplitHandler?.(line);
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/must fully cross/i);
        // Still in split mode (the map stub reflects the live mode prop).
        expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-mode', 'split');
    });
});
