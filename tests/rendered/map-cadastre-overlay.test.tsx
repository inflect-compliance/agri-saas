/**
 * Rendered test — MapCanvas cadastre (КККР) raster overlay.
 *
 * MapLibre/WebGL doesn't run under jsdom, so `react-map-gl/maplibre` is mocked
 * with lightweight components that expose the `<Source>` / `<Layer>` tree as
 * inspectable DOM. That lets us assert the load-bearing behaviour: passing a
 * `cadastreOverlay` mounts the `cadastre-wms` raster source (+ its raster
 * layer); removing it unmounts them; absent overlay renders nothing.
 */
import { render } from '@testing-library/react';
import * as React from 'react';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/components/ui/hooks', () => ({
    useReducedMotion: () => false,
}));

jest.mock('react-map-gl/maplibre', () => {
    const React = require('react');
    return {
        __esModule: true,
        default: ({ children }: { children?: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'map' }, children),
        Map: ({ children }: { children?: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'map' }, children),
        Source: ({ id, children }: { id: string; children?: React.ReactNode }) =>
            React.createElement('div', { 'data-source-id': id }, children),
        Layer: ({ id }: { id: string }) => React.createElement('div', { 'data-layer-id': id }),
        Marker: ({ children }: { children?: React.ReactNode }) =>
            React.createElement('div', null, children),
    };
});

import { MapCanvas } from '@/components/ui/map/MapCanvas';

const CADASTRE_TILE = '/api/t/acme/cadastre/wms/{z}/{x}/{y}';

describe('MapCanvas cadastre overlay', () => {
    it('renders no cadastre source when the overlay is absent', () => {
        const { container } = render(<MapCanvas parcels={[]} />);
        expect(container.querySelector('[data-source-id="cadastre-wms"]')).toBeNull();
    });

    it('mounts the cadastre raster source + layer when the overlay is passed', () => {
        const { container } = render(
            <MapCanvas parcels={[]} cadastreOverlay={{ tileUrl: CADASTRE_TILE }} />,
        );
        const source = container.querySelector('[data-source-id="cadastre-wms"]');
        expect(source).not.toBeNull();
        expect(container.querySelector('[data-layer-id="cadastre-wms-raster"]')).not.toBeNull();
    });

    it('does not mount the source when the tileUrl is empty', () => {
        const { container } = render(
            <MapCanvas parcels={[]} cadastreOverlay={{ tileUrl: '' }} />,
        );
        expect(container.querySelector('[data-source-id="cadastre-wms"]')).toBeNull();
    });

    it('unmounts the cadastre source when the overlay is toggled off', () => {
        const { container, rerender } = render(
            <MapCanvas parcels={[]} cadastreOverlay={{ tileUrl: CADASTRE_TILE }} />,
        );
        expect(container.querySelector('[data-source-id="cadastre-wms"]')).not.toBeNull();
        rerender(<MapCanvas parcels={[]} cadastreOverlay={null} />);
        expect(container.querySelector('[data-source-id="cadastre-wms"]')).toBeNull();
    });
});
