/**
 * Rendered tests for the PestSuggestionCard (feat/ai-vision). Locks the
 * non-negotiable advisory invariants: a CONFIDENCE indicator (% text),
 * the hard "not a diagnosis" disclaimer, the lab-vs-field caveat, and a
 * visible low-confidence flag — plus the absence of any "apply" mutation.
 */
import { render, screen } from '@testing-library/react';
import { PestSuggestionCard, type PestSuggestionData } from '@/components/ag/pest-suggestion-card';

const base: PestSuggestionData = {
    identifiedPest: 'Potato — Early blight',
    confidence: 0.88,
    recommendation: 'Isolate affected plants and confirm with an agronomist.',
    modelVersion: 'cropnet-v1+abcd1234',
    backend: 'onnx',
    lowConfidence: false,
    disclaimer: 'AI suggestion — verify with an agronomist, not a diagnosis',
    at: '2026-06-20T00:00:00.000Z',
};

describe('PestSuggestionCard', () => {
    it('renders the pest, the confidence percentage, the disclaimer + the field caveat', () => {
        render(<PestSuggestionCard data={base} />);
        expect(screen.getByText('Potato — Early blight')).toBeInTheDocument();
        expect(screen.getByText('88%')).toBeInTheDocument();
        expect(
            screen.getByText(/verify with an agronomist, not a diagnosis/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/field photos are noisier than lab images/i)).toBeInTheDocument();
    });

    it('flags a low-confidence result visibly', () => {
        render(<PestSuggestionCard data={{ ...base, confidence: 0.3, lowConfidence: true }} />);
        expect(screen.getAllByText(/low confidence/i).length).toBeGreaterThan(0);
        // The disclaimer is still present on low-confidence results.
        expect(
            screen.getByText(/verify with an agronomist, not a diagnosis/i),
        ).toBeInTheDocument();
    });

    it('exposes a confidence progressbar (not colour-only)', () => {
        render(<PestSuggestionCard data={base} />);
        expect(screen.getByRole('progressbar', { name: /confidence/i })).toBeInTheDocument();
    });

    it('has no "apply" affordance (advisory only)', () => {
        render(<PestSuggestionCard data={base} />);
        expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    });

    it('renders nothing when data is absent', () => {
        const { container } = render(<PestSuggestionCard data={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});
