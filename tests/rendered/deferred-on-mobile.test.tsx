/**
 * DeferredOnMobile renders children eagerly under test (jsdom resolves
 * matchMedia to "mobile", so without this escape hatch every heavy-chart
 * rendered test would see the deferred placeholder instead of the chart).
 * The prod mobile-deferral path is verified manually / in the field.
 */
import { render, screen } from '@testing-library/react';
import { DeferredOnMobile } from '@/components/ui/DeferredOnMobile';

describe('DeferredOnMobile', () => {
    it('renders children eagerly (not the placeholder) under test', () => {
        render(
            <DeferredOnMobile placeholder={<div data-testid="placeholder" />}>
                <div data-testid="heavy-child">chart</div>
            </DeferredOnMobile>,
        );
        expect(screen.getByTestId('heavy-child')).toBeInTheDocument();
        expect(screen.queryByTestId('placeholder')).not.toBeInTheDocument();
    });
});
