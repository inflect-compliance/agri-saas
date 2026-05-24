/**
 * Audit Coherence S9 (2026-05-24) — unit tests for the
 * activeMappingWindow predicate helper.
 *
 * Pure function — pin the Prisma where-clause shape so a future PR
 * can't quietly change the "currently active" semantic (e.g. flip
 * `validTo > now` to `validTo >= now`, or include rows whose
 * `validFrom` is in the future).
 */
import { activeMappingWindow } from '@/app-layer/repositories/RequirementMappingRepository';

describe('activeMappingWindow', () => {
    it('emits the (validFrom <= now) bound', () => {
        const now = new Date('2026-05-24T12:00:00Z');
        const where = activeMappingWindow(now);
        expect(where.validFrom).toEqual({ lte: now });
    });

    it('emits the OR-shape on validTo (null OR future)', () => {
        const now = new Date('2026-05-24T12:00:00Z');
        const where = activeMappingWindow(now);
        expect(where.OR).toEqual([
            { validTo: null },
            { validTo: { gt: now } },
        ]);
    });

    it('defaults `now` to the current wall-clock when omitted', () => {
        const before = Date.now();
        const where = activeMappingWindow();
        const after = Date.now();
        const usedNow = (where.validFrom as { lte: Date }).lte.getTime();
        expect(usedNow).toBeGreaterThanOrEqual(before);
        expect(usedNow).toBeLessThanOrEqual(after);
    });

    it('would exclude a row whose validTo === now (`gt` not `gte`)', () => {
        // A mapping whose validTo equals the wall-clock has expired
        // by the time we read it; the predicate is intentionally
        // strict to avoid edge-of-second boundary surprises in
        // gap-analysis reports.
        const now = new Date('2026-05-24T12:00:00Z');
        const where = activeMappingWindow(now);
        const futureClause = (where.OR as Array<{ validTo: unknown }>)[1];
        expect(futureClause).toEqual({ validTo: { gt: now } });
    });
});
