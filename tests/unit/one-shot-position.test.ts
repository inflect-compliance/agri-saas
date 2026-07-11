/**
 * Unit tests for the one-shot geolocation fast-path — a single
 * getCurrentPosition fix (no continuous watch, lighter on the battery).
 */
import { getOneShotPosition } from '@/lib/geo/one-shot-position';

const realNavigator = global.navigator;
function setGeolocation(geo: unknown) {
    Object.defineProperty(global, 'navigator', {
        value: geo ? { geolocation: geo } : {},
        configurable: true,
        writable: true,
    });
}
afterEach(() => {
    Object.defineProperty(global, 'navigator', { value: realNavigator, configurable: true, writable: true });
});

describe('getOneShotPosition', () => {
    it('resolves a single {lon,lat} via getCurrentPosition (not watchPosition)', async () => {
        const getCurrentPosition = jest.fn((ok: (p: unknown) => void) =>
            ok({ coords: { longitude: 25.49, latitude: 42.73 } }),
        );
        const watchPosition = jest.fn();
        setGeolocation({ getCurrentPosition, watchPosition });

        await expect(getOneShotPosition()).resolves.toEqual({ lon: 25.49, lat: 42.73 });
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        expect(watchPosition).not.toHaveBeenCalled(); // one-shot, no battery-draining watch
    });

    it('passes conservative high-accuracy options with a timeout', async () => {
        const getCurrentPosition = jest.fn(
            (ok: (p: unknown) => void, _fail?: (e: unknown) => void, _opts?: PositionOptions) =>
                ok({ coords: { longitude: 1, latitude: 2 } }),
        );
        setGeolocation({ getCurrentPosition });
        await getOneShotPosition();
        const opts = getCurrentPosition.mock.calls[0][2];
        expect(opts).toMatchObject({ enableHighAccuracy: true });
        expect(opts?.timeout ?? 0).toBeGreaterThan(0);
    });

    it('rejects with the GeolocationPositionError on failure', async () => {
        const err = { code: 1, message: 'denied' };
        setGeolocation({ getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail(err) });
        await expect(getOneShotPosition()).rejects.toBe(err);
    });

    it('rejects when geolocation is unavailable', async () => {
        setGeolocation(null);
        await expect(getOneShotPosition()).rejects.toThrow(/unavailable/);
    });
});
