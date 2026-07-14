/** @jest-environment jsdom */
/**
 * SmartDefaultsBanner — the spray-window reasons MUST be translated at the UI
 * layer (regression: they used to render the server-generated English
 * `reasons[]` verbatim, so the Bulgarian app showed English subtitles). This
 * pins that the banner renders `reasonCodes` through `t(...)`, never the raw
 * English `reasons`.
 */
import { render, screen } from '@testing-library/react';

// Deterministic translator: echoes `spray:<key>` + interpolated params so the
// test can assert the translation path is used (and the raw English is NOT).
jest.mock('next-intl', () => ({
    useTranslations: () => (key: string, params?: Record<string, unknown>) =>
        params && Object.keys(params).length
            ? `spray:${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
            : `spray:${key}`,
}));

jest.mock('@/lib/format-date', () => ({ formatDate: () => '2026-07-14' }));

import { SmartDefaultsBanner } from '@/app/t/[tenantSlug]/(app)/locations/[locationId]/SmartDefaultsBanner';

describe('SmartDefaultsBanner spray reasons i18n', () => {
    it('renders reasonCodes through the translator, not the raw English reasons', () => {
        render(
            <SmartDefaultsBanner
                data={{
                    repeatLast: null,
                    byParcel: {},
                    defaultUnitId: null,
                    nextPlanting: null,
                    sprayWindow: {
                        status: 'CAUTION',
                        obsDate: '2026-07-14T00:00:00.000Z',
                        // English strings that must NOT appear in the DOM:
                        reasons: ['Wind 18.4 km/h — drift caution above 15 km/h'],
                        reasonCodes: [{ code: 'windCaution', params: { wind: 18.4, limit: 15 } }],
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any}
            />,
        );
        // Status + title use their own keys; the reason goes through t('sprayReason.windCaution').
        expect(screen.getByText(/spray:sprayReason\.windCaution\(wind=18\.4,limit=15\)/)).toBeInTheDocument();
        // The raw English reason string must never be rendered.
        expect(screen.queryByText(/drift caution above 15 km\/h/)).not.toBeInTheDocument();
    });

    it('renders nothing when there is no spray window and no planting', () => {
        const { container } = render(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <SmartDefaultsBanner data={{ sprayWindow: null, nextPlanting: null } as any} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
