/**
 * Unit tests — advisory-intent classifier (feat/ai-evals-safety).
 * Pure + deterministic; no mocks needed.
 */
import {
    classifyAdvisoryIntent,
    isHighStakes,
} from '@/app-layer/ai/safety/classify-intent';

describe('classifyAdvisoryIntent', () => {
    it('classifies dosage questions', () => {
        expect(classifyAdvisoryIntent('How much should I apply per hectare?')).toBe('dosage');
        expect(classifyAdvisoryIntent('What is the application rate for this?')).toBe('dosage');
        expect(classifyAdvisoryIntent('What dose of glyphosate do I need?')).toBe('dosage');
        expect(classifyAdvisoryIntent('Apply 2.5 L/ha — is that right?')).toBe('dosage');
        expect(classifyAdvisoryIntent('how many ml per acre of this product?')).toBe('dosage');
    });

    it('classifies chemical-mixing questions (verb + chemical noun)', () => {
        expect(classifyAdvisoryIntent('Can I tank mix this herbicide with that fungicide?')).toBe(
            'chemical-mixing',
        );
        expect(classifyAdvisoryIntent('Is it safe to combine this pesticide with another chemical?')).toBe(
            'chemical-mixing',
        );
        expect(classifyAdvisoryIntent('Are these two products compatible in one spray?')).toBe(
            'chemical-mixing',
        );
    });

    it('does NOT escalate a mix verb without a chemical noun', () => {
        expect(classifyAdvisoryIntent('Should I mix the soil before planting?')).toBe('general');
        expect(classifyAdvisoryIntent('How do I combine two fields into one plan?')).toBe('general');
    });

    it('classifies regulatory questions', () => {
        expect(classifyAdvisoryIntent('What is the PHI for organic certification?')).toBe('regulatory');
        expect(classifyAdvisoryIntent('What re-entry interval is legally required?')).toBe('regulatory');
        expect(classifyAdvisoryIntent('What is the maximum residue limit (MRL)?')).toBe('regulatory');
        expect(classifyAdvisoryIntent('Is this allowed under organic standard rules?')).toBe('regulatory');
        expect(classifyAdvisoryIntent('What is the withholding period?')).toBe('regulatory');
    });

    it('classifies everything else as general', () => {
        expect(classifyAdvisoryIntent('What is a good tip for healthy soil?')).toBe('general');
        expect(classifyAdvisoryIntent('When should I plant tomatoes?')).toBe('general');
        expect(classifyAdvisoryIntent('')).toBe('general');
    });

    it('gives dosage precedence over other buckets', () => {
        // Mentions both rate (dosage) and certification (regulatory) → dosage wins.
        expect(
            classifyAdvisoryIntent('What application rate keeps me within organic certification?'),
        ).toBe('dosage');
    });

    it('isHighStakes flags the three escalated intents', () => {
        expect(isHighStakes('dosage')).toBe(true);
        expect(isHighStakes('chemical-mixing')).toBe(true);
        expect(isHighStakes('regulatory')).toBe(true);
        expect(isHighStakes('general')).toBe(false);
    });
});
