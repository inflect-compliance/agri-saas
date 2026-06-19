/**
 * Calendar-season + time-of-day framing (feat/delight-personality). Pure
 * logic behind the home greeting — locks the northern-hemisphere season
 * boundaries and the morning/afternoon/evening bands.
 */
import { calendarSeason, timeOfDay } from '@/lib/season';

describe('calendarSeason (northern hemisphere)', () => {
    it('maps each month to its meteorological season', () => {
        expect(calendarSeason(0)).toBe('winter'); // Jan
        expect(calendarSeason(1)).toBe('winter'); // Feb
        expect(calendarSeason(2)).toBe('spring'); // Mar
        expect(calendarSeason(4)).toBe('spring'); // May
        expect(calendarSeason(5)).toBe('summer'); // Jun
        expect(calendarSeason(7)).toBe('summer'); // Aug
        expect(calendarSeason(8)).toBe('autumn'); // Sep
        expect(calendarSeason(10)).toBe('autumn'); // Nov
        expect(calendarSeason(11)).toBe('winter'); // Dec
    });
});

describe('timeOfDay', () => {
    it('bands the hour into morning/afternoon/evening', () => {
        expect(timeOfDay(0)).toBe('morning');
        expect(timeOfDay(11)).toBe('morning');
        expect(timeOfDay(12)).toBe('afternoon');
        expect(timeOfDay(17)).toBe('afternoon');
        expect(timeOfDay(18)).toBe('evening');
        expect(timeOfDay(23)).toBe('evening');
    });
});
