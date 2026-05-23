/**
 * Epic 60 — persistence + optimistic-state hook cluster.
 *
 * The two hooks have different failure modes so they get different
 * coverage:
 *
 *   - `useLocalStorage` — hydration safety (first render must equal
 *     the SSR fallback, even when storage has a value), cross-tab
 *     `storage` event sync, functional updater, corrupted-JSON fallback,
 *     SSR-guarded setter.
 *   - `useOptimisticUpdate` — optimistic overlay appears, persists
 *     across commit resolution until committed `value` prop changes,
 *     rolls back on throw, `isPending` lifecycle, functional updater.
 */

import { act, renderHook } from '@testing-library/react';

import {
    useLocalStorage,
    useOptimisticUpdate,
} from '@/components/ui/hooks';

// ── useLocalStorage ────────────────────────────────────────────────────

describe('useLocalStorage', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('first render returns initialValue even when storage holds a different value (hydration-safe)', () => {
        // Prime storage — the kind of state a returning user has.
        window.localStorage.setItem('k', JSON.stringify('persisted'));

        let firstRenderValue: string | null = null;
        const { result } = renderHook(() => {
            const [v] = useLocalStorage<string>('k', 'initial');
            if (firstRenderValue === null) firstRenderValue = v;
            return v;
        });

        // Guarantees the server-rendered HTML matches the client's
        // first render — no hydration mismatch warning.
        expect(firstRenderValue).toBe('initial');
        // After the hydrate effect, storage wins.
        expect(result.current).toBe('persisted');
    });

    it('returns initialValue when storage is empty', () => {
        const { result } = renderHook(() =>
            useLocalStorage<string>('empty-key', 'fallback'),
        );
        expect(result.current[0]).toBe('fallback');
    });

    it('persists updates to storage', () => {
        const { result } = renderHook(() =>
            useLocalStorage<number>('count', 0),
        );
        act(() => result.current[1](42));
        expect(result.current[0]).toBe(42);
        expect(window.localStorage.getItem('count')).toBe('42');
    });

    it('supports functional updaters', () => {
        const { result } = renderHook(() =>
            useLocalStorage<number>('count-fn', 5),
        );
        act(() => result.current[1]((prev) => prev + 1));
        act(() => result.current[1]((prev) => prev + 1));
        expect(result.current[0]).toBe(7);
        expect(window.localStorage.getItem('count-fn')).toBe('7');
    });

    it('falls back to initialValue when storage holds malformed JSON', () => {
        // A devtools edit, older-schema leftover, or a quota truncation.
        window.localStorage.setItem('corrupt', '{not valid json');

        const { result } = renderHook(() =>
            useLocalStorage<{ ok: boolean }>('corrupt', { ok: true }),
        );
        // First render uses initialValue (hydration-safe); the hydrate
        // effect tries to parse, fails, and stays on initialValue.
        expect(result.current[0]).toEqual({ ok: true });
    });

    it('re-hydrates when another tab writes to the same key (storage event)', () => {
        window.localStorage.setItem('shared', JSON.stringify('v1'));

        const { result } = renderHook(() =>
            useLocalStorage<string>('shared', 'initial'),
        );

        // After the hydrate effect, we're at v1.
        expect(result.current[0]).toBe('v1');

        // Simulate another tab writing a new value.
        act(() => {
            window.localStorage.setItem('shared', JSON.stringify('v2'));
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'shared',
                    newValue: JSON.stringify('v2'),
                    storageArea: window.localStorage,
                }),
            );
        });

        expect(result.current[0]).toBe('v2');
    });

    it('ignores storage events from a different storageArea', () => {
        const { result } = renderHook(() =>
            useLocalStorage<string>('iso', 'initial'),
        );

        // sessionStorage events must NOT drive the hook — we only care
        // about the localStorage area.
        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'iso',
                    newValue: JSON.stringify('other'),
                    storageArea: window.sessionStorage,
                }),
            );
        });

        expect(result.current[0]).toBe('initial');
    });

    it('respects syncAcrossTabs=false (no storage listener)', () => {
        const { result } = renderHook(() =>
            useLocalStorage<string>('nosync', 'initial', {
                syncAcrossTabs: false,
            }),
        );

        act(() => {
            window.localStorage.setItem('nosync', JSON.stringify('remote'));
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'nosync',
                    newValue: JSON.stringify('remote'),
                    storageArea: window.localStorage,
                }),
            );
        });

        expect(result.current[0]).toBe('initial');
    });

    it('honours a custom serializer / deserializer', () => {
        // Dates round-trip cleanly through ISO strings, not JSON's
        // default behaviour.
        const { result } = renderHook(() =>
            useLocalStorage<Date>('last-seen', new Date(0), {
                serialize: (d) => d.toISOString(),
                deserialize: (s) => new Date(s),
            }),
        );

        const d = new Date('2026-04-22T10:00:00Z');
        act(() => result.current[1](d));

        expect(window.localStorage.getItem('last-seen')).toBe(d.toISOString());
        expect(result.current[0].getTime()).toBe(d.getTime());
    });

    it('clears the stored value on storage-wide clear (event with key=null)', () => {
        window.localStorage.setItem('x', JSON.stringify('was-set'));
        const { result } = renderHook(() =>
            useLocalStorage<string>('x', 'fallback'),
        );
        expect(result.current[0]).toBe('was-set');

        // Another tab calls localStorage.clear() — the spec says
        // `key === null` in that case.
        act(() => {
            window.localStorage.clear();
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: null,
                    newValue: null,
                    storageArea: window.localStorage,
                }),
            );
        });

        expect(result.current[0]).toBe('fallback');
    });
});

// ── useOptimisticUpdate ────────────────────────────────────────────────

describe('useOptimisticUpdate', () => {
    it('shows the committed value when no commit is in flight', () => {
        const { result } = renderHook(() => useOptimisticUpdate<number>(10));
        expect(result.current.value).toBe(10);
        expect(result.current.isPending).toBe(false);
    });

    it('overlays the optimistic value during an in-flight commit, then keeps it until value changes', async () => {
        let release!: () => void;
        const commit = () =>
            new Promise<void>((resolve) => {
                release = () => resolve();
            });

        const { result, rerender } = renderHook(
            ({ value }: { value: number }) => useOptimisticUpdate<number>(value),
            { initialProps: { value: 10 } },
        );

        let updatePromise: Promise<void> | undefined;
        act(() => {
            updatePromise = result.current.update<void>(99, commit);
        });

        // Overlay shows immediately, before commit resolves.
        expect(result.current.value).toBe(99);
        expect(result.current.isPending).toBe(true);

        await act(async () => {
            release();
            await updatePromise;
        });

        // Commit succeeded; overlay stays because `value` prop hasn't
        // changed yet. This avoids the flicker between overlay and the
        // caller's refetch landing.
        expect(result.current.value).toBe(99);
        expect(result.current.isPending).toBe(false);

        // Caller refetched — new committed value propagates in.
        rerender({ value: 99 });
        expect(result.current.value).toBe(99);

        // Next render with a different value: overlay is already gone,
        // so committed value shows through cleanly.
        rerender({ value: 100 });
        expect(result.current.value).toBe(100);
    });

    it('rolls back on throw and re-throws so the caller can react', async () => {
        const { result } = renderHook(() => useOptimisticUpdate<number>(5));

        const boom = new Error('commit failed');
        let caught: unknown;

        await act(async () => {
            try {
                await result.current.update<void>(99, async () => {
                    throw boom;
                });
            } catch (e) {
                caught = e;
            }
        });

        expect(caught).toBe(boom);
        expect(result.current.value).toBe(5);
        expect(result.current.isPending).toBe(false);
    });

    it('calls onError with the rollback target on failure', async () => {
        const onError = jest.fn();
        const { result } = renderHook(() =>
            useOptimisticUpdate<string>('before', { onError }),
        );

        await act(async () => {
            await result.current
                .update<void>('after', async () => {
                    throw new Error('x');
                })
                .catch(() => {
                    /* swallow in test */
                });
        });

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][1]).toBe('before');
        expect(result.current.value).toBe('before');
    });

    it('supports a functional updater that sees the currently visible value', async () => {
        const { result } = renderHook(() =>
            useOptimisticUpdate<number>(0),
        );

        await act(async () => {
            await result.current.update<void>((prev) => prev + 1, async () => {
                // commit no-op
            });
        });

        // Overlay holds even after commit resolves (value prop still 0).
        expect(result.current.value).toBe(1);

        await act(async () => {
            // Second update operates on the visible overlay (1), not
            // on the stale committed value (0).
            await result.current.update<void>((prev) => prev + 1, async () => {
                // commit no-op
            });
        });

        expect(result.current.value).toBe(2);
    });

    it('tracks isPending across concurrent updates (last-write-wins overlay, count-based pending)', async () => {
        let release1!: () => void;
        let release2!: () => void;
        const p1 = new Promise<void>((r) => {
            release1 = () => r();
        });
        const p2 = new Promise<void>((r) => {
            release2 = () => r();
        });

        const { result } = renderHook(() => useOptimisticUpdate<number>(0));

        let awaited1: Promise<void> | undefined;
        let awaited2: Promise<void> | undefined;
        act(() => {
            awaited1 = result.current.update<void>(1, () => p1);
        });
        expect(result.current.value).toBe(1);
        expect(result.current.isPending).toBe(true);

        act(() => {
            awaited2 = result.current.update<void>(2, () => p2);
        });
        // Second update's overlay wins.
        expect(result.current.value).toBe(2);
        expect(result.current.isPending).toBe(true);

        await act(async () => {
            release1();
            await awaited1;
        });
        // One commit resolved; one still pending — overlay from the
        // latest call is still visible because no `value` change.
        expect(result.current.isPending).toBe(true);
        expect(result.current.value).toBe(2);

        await act(async () => {
            release2();
            await awaited2;
        });
        expect(result.current.isPending).toBe(false);
    });
});
