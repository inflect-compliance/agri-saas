/** @jest-environment jsdom */
/**
 * The SW "Update ready — refresh" prompt: it surfaces as a non-blocking
 * status banner and applies the update only on the operator's explicit tap
 * (consent), never on its own.
 */
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { UpdateAvailableBanner } from '@/components/pwa/UpdateAvailableBanner';

describe('UpdateAvailableBanner', () => {
    it('surfaces a non-blocking status prompt with a refresh action', () => {
        const onApply = jest.fn();
        render(<UpdateAvailableBanner onApply={onApply} />);
        // role="status" = polite/non-blocking (not an alert/modal).
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByText('ready')).toBeInTheDocument();
        // No update is applied until the operator consents.
        expect(onApply).not.toHaveBeenCalled();
    });

    it('applies the update only on the explicit refresh tap', () => {
        const onApply = jest.fn();
        render(<UpdateAvailableBanner onApply={onApply} />);
        fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
        expect(onApply).toHaveBeenCalledTimes(1);
    });
});
