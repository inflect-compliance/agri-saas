/**
 * One-shot geolocation — a single "where am I" fix via `getCurrentPosition`.
 *
 * The map's live-tracking uses a continuous, high-accuracy `watchPosition`,
 * which keeps the GPS radio on and drains battery. A quick locate shouldn't
 * cost a full watch, so this resolves ONE position and stops. `watchPosition`
 * stays the tool for active tracking.
 */

export interface LonLat {
    lon: number;
    lat: number;
}

/**
 * Resolve the device's current position once. Rejects with the
 * `GeolocationPositionError` (or an Error if the API is unavailable) so the
 * caller can surface a permission / failure message.
 */
export function getOneShotPosition(options: PositionOptions = {}): Promise<LonLat> {
    return new Promise<LonLat>((resolve, reject) => {
        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            reject(new Error('geolocation unavailable'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lon: pos.coords.longitude, lat: pos.coords.latitude }),
            (err) => reject(err),
            // High accuracy for a field fix; a slightly stale cached fix (30s)
            // is fine for "where am I" and returns instantly if warm.
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000, ...options },
        );
    });
}
