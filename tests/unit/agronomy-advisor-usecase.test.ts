/**
 * Unit test — agronomy-advisor usecase pass-through (feat/ai-evals-safety).
 *
 * The usecase is a thin delegate to `askAgronomyAdvisor`. We mock the
 * underlying guard module and assert the usecase forwards ctx/query/opts
 * verbatim and returns its result.
 */
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

const mockAsk = jest.fn();
jest.mock('@/app-layer/ai/safety/advisor', () => ({
    askAgronomyAdvisor: (...args: unknown[]) => mockAsk(...args),
}));

import { makeRequestContext } from '../helpers/make-context';
import { askAdvisor } from '@/app-layer/usecases/agronomy-advisor';

const ctx = makeRequestContext('ADMIN');

beforeEach(() => mockAsk.mockReset());

describe('askAdvisor usecase', () => {
    it('forwards ctx, query, and opts to askAgronomyAdvisor and returns its result', async () => {
        const result = { answer: 'x', refused: false };
        mockAsk.mockResolvedValue(result);

        const opts = { productItemId: 'item-1', topK: 3 };
        const out = await askAdvisor(ctx, 'how much per ha?', opts);

        expect(mockAsk).toHaveBeenCalledWith(ctx, 'how much per ha?', opts);
        expect(out).toBe(result);
    });

    it('defaults opts to an empty object', async () => {
        mockAsk.mockResolvedValue({ answer: 'y' });
        await askAdvisor(ctx, 'general tip?');
        expect(mockAsk).toHaveBeenCalledWith(ctx, 'general tip?', {});
    });
});
