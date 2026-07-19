/**
 * One expiry clock for parcel leases (аренда/наем).
 *
 * Every surface reads its windows + tier classifier from here so they tell the
 * same story BY CONSTRUCTION rather than by coincidence: the daily
 * notification sweep, the rent-roll usecase / reports route / PDF+CSV exports,
 * the badge on each row of the Rent table, and the badge in the summary card.
 *
 * Three horizons, one classifier:
 *   - ALERT_DAYS  (30) — red tier AND the daily sweep's reminder window. A lease
 *                        ending within a month is urgent (renew or vacate); when
 *                        the sweep fires the notification, the badge is red.
 *   - WARN_DAYS   (60) — amber tier: a heads-up before it turns urgent.
 *   - REPORT_DAYS (90) — the reporting horizon: the roll / card / exports list
 *                        leases ending within this window under "expiring soon".
 *
 * Server-safe: no client imports (the tone map is a plain string record).
 */

/** Red tier + the daily sweep's notification window (days before endDate). */
export const ALERT_DAYS = 30;
/** Amber tier: expiring within two months. */
export const WARN_DAYS = 60;
/** Reporting horizon: the "expiring soon" list window on the roll / card / exports. */
export const REPORT_DAYS = 90;

export type LeaseExpiryTier = 'expired' | 'alert' | 'warn' | 'ok';

/**
 * Classify a lease by whole days until its `endDate`. A null/undefined
 * `daysLeft` (no end date — an open-ended lease) is `ok`.
 */
export function leaseExpiryTier(daysLeft: number | null | undefined): LeaseExpiryTier {
    if (daysLeft == null) return 'ok';
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= ALERT_DAYS) return 'alert';
    if (daysLeft <= WARN_DAYS) return 'warn';
    return 'ok';
}

/** StatusBadge `variant` per tier — shared so the table and card badges match. */
export const LEASE_EXPIRY_TONE: Record<LeaseExpiryTier, 'error' | 'warning' | 'neutral' | 'success'> = {
    expired: 'neutral',
    alert: 'error',
    warn: 'warning',
    ok: 'success',
};

/** Whole days from `now` until `endDate` (negative once past). */
export function daysUntil(endDate: Date | string, now: Date = new Date()): number {
    const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
    return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
