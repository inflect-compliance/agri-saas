/**
 * Rendered tests for the AI suggestion surfaces. Locks the two
 * non-negotiable invariants: every AI card shows a CONFIDENCE badge
 * (icon + text, not colour-only) AND the "verify with an agronomist"
 * human-review disclaimer. Plus a jest-axe pass.
 */
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AiSuggestionCard } from '@/components/ag/ai-suggestion-card';
import { CopilotCard, type CopilotData } from '@/components/ag/copilot-card';

const DISCLAIMER = /verify with an agronomist/i;

describe('AiSuggestionCard', () => {
    it('renders the confidence badge + the human-review disclaimer', () => {
        render(
            <AiSuggestionCard title="Test" confidence="high">
                <p>body</p>
            </AiSuggestionCard>,
        );
        expect(screen.getByText(/High confidence/i)).toBeInTheDocument();
        expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    });

    it('always shows the disclaimer even without a confidence', () => {
        render(
            <AiSuggestionCard title="Test">
                <p>body</p>
            </AiSuggestionCard>,
        );
        expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    });

    it('exposes the region as a labelled landmark (a11y)', async () => {
        const { container } = render(
            <AiSuggestionCard title="Agronomy copilot" confidence="medium">
                <p>body</p>
            </AiSuggestionCard>,
        );
        expect(screen.getByRole('region', { name: /AI suggestion/i })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('CopilotCard', () => {
    const data: CopilotData = {
        explanation: 'High winds make spraying drift-prone today.',
        factors: ['Wind 28 km/h', 'Wheat at sowing'],
        whatIf: 'Improves when wind drops below 15 km/h.',
        confidence: 'high',
    };

    it('renders explanation, factors, what-if, confidence + disclaimer', async () => {
        const { container } = render(<CopilotCard data={data} />);
        expect(screen.getByText(/High winds make spraying/i)).toBeInTheDocument();
        expect(screen.getByText('Wind 28 km/h')).toBeInTheDocument();
        expect(screen.getByText(/drops below 15/i)).toBeInTheDocument();
        expect(screen.getByText(/High confidence/i)).toBeInTheDocument();
        expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('renders nothing when there is no data', () => {
        const { container } = render(<CopilotCard data={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });
});
