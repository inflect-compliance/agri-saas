/**
 * @jest-environment jsdom
 *
 * Mobile-data-entry PR-4 primitives:
 *   1. <Input type="number"> defaults inputMode="decimal" (number pad), overridable.
 *   2. <FileUpload capture> forwards `capture` to the file input (camera).
 *   3. <StepWizard> walks steps (Next/Back), shows progress dots, and Finish
 *      closes online / shows the offline-saved state when queued.
 *
 * useMediaQuery is forced to desktop so the StepWizard's Modal renders the
 * Radix Dialog (Vaul drag handlers throw in jsdom); next/navigation is stubbed.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/ui/hooks', () => {
    const actual = jest.requireActual('@/components/ui/hooks');
    return { ...actual, useMediaQuery: () => ({ device: 'desktop', width: 1024, height: 768, isMobile: false, isDesktop: true }) };
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

import { Input } from '@/components/ui/input';
import { FileUpload } from '@/components/ui/file-upload';
import { StepWizard, type StepWizardStep } from '@/components/ui/step-wizard';

describe('Input numeric ergonomics', () => {
    it('defaults inputMode="decimal" for type=number, overridable, off for text', () => {
        const { rerender } = render(<Input type="number" aria-label="qty" />);
        expect(screen.getByLabelText('qty')).toHaveAttribute('inputmode', 'decimal');

        rerender(<Input type="number" inputMode="numeric" aria-label="qty" />);
        expect(screen.getByLabelText('qty')).toHaveAttribute('inputmode', 'numeric');

        rerender(<Input type="text" aria-label="name" />);
        expect(screen.getByLabelText('name')).not.toHaveAttribute('inputmode');
    });
});

describe('FileUpload camera capture', () => {
    it('forwards capture="environment" to the file input', () => {
        const { container } = render(
            <FileUpload accept="images" capture="environment" onChange={() => {}} />,
        );
        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAttribute('capture', 'environment');
    });

    it('omits capture when not requested', () => {
        const { container } = render(<FileUpload accept="evidence" onChange={() => {}} />);
        expect(container.querySelector('input[type="file"]')).not.toHaveAttribute('capture');
    });
});

const STEPS: StepWizardStep[] = [
    { id: 'parcel', title: 'Pick parcel', content: <div>parcel picker</div> },
    { id: 'rate', title: 'Set rate', content: <input aria-label="rate" /> },
    { id: 'confirm', title: 'Confirm', content: <div>review &amp; confirm</div> },
];

function Harness({ onFinish }: { onFinish: () => Promise<{ queued?: boolean } | void> }) {
    const [open, setOpen] = useState(true);
    return (
        <StepWizard open={open} onOpenChange={setOpen} title="New spray job" steps={STEPS} onFinish={onFinish} finishLabel="Create job" />
    );
}

describe('StepWizard', () => {
    it('walks Next/Back with progress dots and finishes online', async () => {
        const onFinish = jest.fn().mockResolvedValue(undefined);
        render(<Harness onFinish={onFinish} />);

        // Step 1: heading + content; Back disabled; 3 progress dots.
        expect(screen.getByRole('heading', { name: 'Pick parcel' })).toBeInTheDocument();
        expect(screen.getByText('parcel picker')).toBeInTheDocument();
        expect(screen.getByTestId('wizard-back')).toBeDisabled();
        expect(screen.getByTestId('wizard-progress').querySelectorAll('li')).toHaveLength(3);

        // Next → step 2.
        fireEvent.click(screen.getByTestId('wizard-next'));
        expect(screen.getByRole('heading', { name: 'Set rate' })).toBeInTheDocument();
        expect(screen.getByTestId('wizard-back')).not.toBeDisabled();

        // Back → step 1.
        fireEvent.click(screen.getByTestId('wizard-back'));
        expect(screen.getByRole('heading', { name: 'Pick parcel' })).toBeInTheDocument();

        // Next, Next → last step shows Finish.
        fireEvent.click(screen.getByTestId('wizard-next'));
        fireEvent.click(screen.getByTestId('wizard-next'));
        const finish = screen.getByTestId('wizard-finish');
        expect(finish).toHaveTextContent('Create job');

        fireEvent.click(finish);
        await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
        // Closed online → heading gone.
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Confirm' })).not.toBeInTheDocument());
    });

    it('shows the offline-saved state when Finish returns queued', async () => {
        const onFinish = jest.fn().mockResolvedValue({ queued: true });
        render(<Harness onFinish={onFinish} />);
        fireEvent.click(screen.getByTestId('wizard-next'));
        fireEvent.click(screen.getByTestId('wizard-next'));
        fireEvent.click(screen.getByTestId('wizard-finish'));
        await waitFor(() => expect(screen.getByText(/Saved offline/i)).toBeInTheDocument());
    });

    it('gates Next when a step cannot advance', () => {
        const gated: StepWizardStep[] = [
            { id: 'a', title: 'Pick', content: <div>x</div>, canAdvance: false },
            { id: 'b', title: 'Done', content: <div>y</div> },
        ];
        function GatedHarness() {
            const [open, setOpen] = useState(true);
            return <StepWizard open={open} onOpenChange={setOpen} title="W" steps={gated} onFinish={async () => {}} />;
        }
        render(<GatedHarness />);
        expect(screen.getByTestId('wizard-next')).toBeDisabled();
    });
});
