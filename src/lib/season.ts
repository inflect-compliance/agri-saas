/**
 * Calendar-season framing for the home greeting (feat/delight-personality).
 *
 * Northern-hemisphere meteorological seasons (the product's users — incl.
 * Bulgaria — are northern). Pure + deterministic so it unit-tests without a
 * clock; the caller passes the current month (the greeting derives it from
 * the browser clock, client-side, since season tracks the user's locale not
 * the server's).
 */

export type CalendarSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/** Season from a 0-based month index (0 = January … 11 = December). */
export function calendarSeason(month: number): CalendarSeason {
    // Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn.
    if (month === 11 || month <= 1) return 'winter';
    if (month <= 4) return 'spring';
    if (month <= 7) return 'summer';
    return 'autumn';
}

/** Greeting band from a 0–23 hour: <12 morning, <18 afternoon, else evening. */
export function timeOfDay(hour: number): TimeOfDay {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}
