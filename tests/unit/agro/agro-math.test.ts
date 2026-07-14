/**
 * Unit tests for the pure agronomic math — GDD accumulation
 * (`src/lib/agro/gdd.ts`) + the spray-window / disease-risk evaluators
 * (`src/lib/agro/rules.ts`). No DB, no mocks.
 */
import { dailyGdd, accumulateGdd } from '@/lib/agro/gdd';
import {
    evaluateSprayWindow,
    evaluateDiseaseRisk,
    computeSprayWindows,
    DEFAULT_SPRAY_THRESHOLDS,
    type SprayHour,
} from '@/lib/agro/rules';

describe('dailyGdd (average method, cap + floor)', () => {
    it('simple average above base', () => {
        // (20+10)/2 - 8 = 7
        expect(dailyGdd(20, 10, { baseTempC: 8 })).toBe(7);
    });
    it('floors tmin at base (cold night contributes nothing below base)', () => {
        // tmin 2 floored to base 8 → (20+8)/2 - 8 = 6
        expect(dailyGdd(20, 2, { baseTempC: 8 })).toBe(6);
    });
    it('caps tmax at capTempC', () => {
        // tmax 40 capped to 30 → (30+12)/2 - 8 = 13
        expect(dailyGdd(40, 12, { baseTempC: 8, capTempC: 30 })).toBe(13);
    });
    it('never negative when the whole day is below base', () => {
        expect(dailyGdd(5, 1, { baseTempC: 10 })).toBe(0);
    });
});

describe('accumulateGdd', () => {
    it('sums per-day GDD with a running cumulative', () => {
        const r = accumulateGdd(
            [
                { date: '2026-04-01', tempMaxC: 18, tempMinC: 8 },  // (18+8)/2-5 = 8
                { date: '2026-04-02', tempMaxC: 20, tempMinC: 10 }, // (20+10)/2-5 = 10
                { date: '2026-04-03', tempMaxC: 4, tempMinC: 1 },   // below base → 0
            ],
            { baseTempC: 5 },
        );
        expect(r.days.map((d) => d.gdd)).toEqual([8, 10, 0]);
        expect(r.days.map((d) => d.cumulative)).toEqual([8, 18, 18]);
        expect(r.totalGdd).toBe(18);
    });
    it('empty observation list → zero', () => {
        expect(accumulateGdd([], { baseTempC: 5 })).toEqual({ totalGdd: 0, days: [] });
    });
});

describe('evaluateSprayWindow', () => {
    it('GOOD when all within limits', () => {
        const r = evaluateSprayWindow({ windMaxKmh: 8, precipMm: 0, tempMeanC: 18 });
        expect(r.status).toBe('GOOD');
    });
    it('CAUTION on moderate wind', () => {
        const r = evaluateSprayWindow({ windMaxKmh: 18, precipMm: 0, tempMeanC: 18 });
        expect(r.status).toBe('CAUTION');
        expect(r.reasons.join(' ')).toMatch(/Wind 18/);
    });
    it('UNSUITABLE on high wind (dominates caution)', () => {
        const r = evaluateSprayWindow({ windMaxKmh: 30, precipMm: 0, tempMeanC: 18 });
        expect(r.status).toBe('UNSUITABLE');
    });
    it('UNSUITABLE on rain wash-off', () => {
        expect(evaluateSprayWindow({ windMaxKmh: 5, precipMm: 5, tempMeanC: 18 }).status).toBe('UNSUITABLE');
    });
    it('UNSUITABLE when temperature is out of range', () => {
        expect(evaluateSprayWindow({ windMaxKmh: 5, precipMm: 0, tempMeanC: 35 }).status).toBe('UNSUITABLE');
        expect(evaluateSprayWindow({ windMaxKmh: 5, precipMm: 0, tempMeanC: 2 }).status).toBe('UNSUITABLE');
    });
    it('missing inputs never fabricate a warning', () => {
        expect(evaluateSprayWindow({}).status).toBe('GOOD');
    });
    it('respects custom thresholds', () => {
        const r = evaluateSprayWindow({ windMaxKmh: 12 }, { ...DEFAULT_SPRAY_THRESHOLDS, windCautionKmh: 10 });
        expect(r.status).toBe('CAUTION');
    });
});

describe('computeSprayWindows', () => {
    // A good (suitable) hour: calm, dry, temperate.
    const good = (hour: number): SprayHour => ({ hour, windKmh: 8, precipMm: 0, tempC: 18 });
    // A bad hour and the three ways an hour turns unsuitable.
    const windy = (hour: number): SprayHour => ({ hour, windKmh: 20, precipMm: 0, tempC: 18 });
    const wet = (hour: number): SprayHour => ({ hour, windKmh: 8, precipMm: 0.5, tempC: 18 });
    const cold = (hour: number): SprayHour => ({ hour, windKmh: 8, precipMm: 0, tempC: 2 });

    it('merges consecutive suitable hours into one exclusive-end window', () => {
        const w = computeSprayWindows([good(6), good(7), good(8), good(9)]);
        expect(w).toEqual([{ startHour: 6, endHour: 10 }]);
    });

    it('splits into separate windows across an unsuitable hour', () => {
        const w = computeSprayWindows([good(6), good(7), windy(8), good(9), good(10)]);
        expect(w).toEqual([
            { startHour: 6, endHour: 8 },
            { startHour: 9, endHour: 11 },
        ]);
    });

    it('splits across a non-consecutive gap (missing hour)', () => {
        // 6,7 suitable, 8 absent entirely, 9 suitable → two windows.
        const w = computeSprayWindows([good(6), good(7), good(9)]);
        expect(w).toEqual([
            { startHour: 6, endHour: 8 },
            { startHour: 9, endHour: 10 },
        ]);
    });

    it('treats wind / rain / cold hours (and missing fields) as unsuitable', () => {
        expect(computeSprayWindows([windy(6)])).toEqual([]);
        expect(computeSprayWindows([wet(6)])).toEqual([]);
        expect(computeSprayWindows([cold(6)])).toEqual([]);
        // Missing a required field ⇒ not suitable, never a fabricated window.
        expect(computeSprayWindows([{ hour: 6, windKmh: 8, precipMm: 0 }])).toEqual([]);
    });

    it('empty input ⇒ no windows', () => {
        expect(computeSprayWindows([])).toEqual([]);
    });

    it('sorts unordered hours before merging', () => {
        const w = computeSprayWindows([good(9), good(6), good(8), good(7)]);
        expect(w).toEqual([{ startHour: 6, endHour: 10 }]);
    });

    it('drops windows that have fully passed (fromHour)', () => {
        // Window 6–10 (exclusive); now is 10 ⇒ fully passed, dropped.
        const w = computeSprayWindows([good(6), good(7), good(8), good(9)], DEFAULT_SPRAY_THRESHOLDS, { fromHour: 10 });
        expect(w).toEqual([]);
    });

    it('clips a window in progress to start at fromHour', () => {
        // Window 6–10; now is 8 ⇒ show 8–10 only.
        const w = computeSprayWindows([good(6), good(7), good(8), good(9)], DEFAULT_SPRAY_THRESHOLDS, { fromHour: 8 });
        expect(w).toEqual([{ startHour: 8, endHour: 10 }]);
    });

    it('keeps a future window intact and drops a past one (fromHour)', () => {
        const w = computeSprayWindows(
            [good(6), good(7), windy(8), good(14), good(15)],
            DEFAULT_SPRAY_THRESHOLDS,
            { fromHour: 12 },
        );
        expect(w).toEqual([{ startHour: 14, endHour: 16 }]);
    });

    it('respects custom thresholds', () => {
        // At windCautionKmh 6, an 8 km/h hour is no longer suitable.
        const w = computeSprayWindows([good(6), good(7)], { ...DEFAULT_SPRAY_THRESHOLDS, windCautionKmh: 6 });
        expect(w).toEqual([]);
    });
});

describe('evaluateDiseaseRisk', () => {
    const warmWet = (date: string) => ({ date, precipMm: 1, tempMeanC: 18 });
    const dry = (date: string) => ({ date, precipMm: 0, humidityMean: 40, tempMeanC: 18 });

    it('LOW with no sustained warm-wet period', () => {
        const r = evaluateDiseaseRisk([warmWet('d1'), dry('d2'), warmWet('d3')]);
        expect(r.level).toBe('LOW');
        expect(r.maxConsecutive).toBe(1);
        expect(r.conduciveDays).toBe(2);
    });
    it('MODERATE at 2 consecutive conducive days', () => {
        const r = evaluateDiseaseRisk([warmWet('d1'), warmWet('d2'), dry('d3')]);
        expect(r.level).toBe('MODERATE');
        expect(r.maxConsecutive).toBe(2);
    });
    it('HIGH at 3+ consecutive conducive days', () => {
        const r = evaluateDiseaseRisk([warmWet('d1'), warmWet('d2'), warmWet('d3')]);
        expect(r.level).toBe('HIGH');
    });
    it('high humidity (no rain) also counts as leaf wetness', () => {
        const humid = (date: string) => ({ date, precipMm: 0, humidityMean: 95, tempMeanC: 20 });
        const r = evaluateDiseaseRisk([humid('d1'), humid('d2'), humid('d3')]);
        expect(r.level).toBe('HIGH');
    });
    it('cold-but-wet days are NOT conducive', () => {
        const coldWet = (date: string) => ({ date, precipMm: 2, tempMeanC: 4 });
        expect(evaluateDiseaseRisk([coldWet('d1'), coldWet('d2'), coldWet('d3')]).level).toBe('LOW');
    });
});
