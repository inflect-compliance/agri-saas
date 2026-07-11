/**
 * Roadmap-6 P3 — persistent SWR cache provider.
 *
 * The load-bearing behaviour: a list persisted to the per-tenant bucket
 * REHYDRATES on mount, so SWR renders it on the first paint WITHOUT the
 * fetcher having to resolve (the cold-start-refetch avoidance the whole
 * change exists for). Also covers per-tenant isolation and stale/
 * version self-eviction.
 */
/** @jest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import useSWR, { SWRConfig } from 'swr';
import {
    createPersistentCacheProvider,
    storageKey,
    SWR_CACHE_VERSION,
} from '@/lib/swr/persistent-cache';

interface Row {
    id: string;
    title: string;
}

/**
 * A probe whose fetcher NEVER resolves — so anything that renders MUST
 * have come from the rehydrated cache, not the network.
 */
function ListProbe({ swrKey }: { swrKey: string }) {
    const { data } = useSWR<Row[]>(swrKey, () => new Promise<Row[]>(() => {}));
    return (
        <ul>
            {(data ?? []).map((r) => (
                <li key={r.id}>{r.title}</li>
            ))}
        </ul>
    );
}

function seedBucket(namespace: string, entries: [string, unknown][], t = Date.now()) {
    window.localStorage.setItem(
        storageKey(namespace),
        JSON.stringify({ v: SWR_CACHE_VERSION, t, entries }),
    );
}

function renderWithProvider(namespace: string, swrKey: string) {
    return render(
        <SWRConfig value={{ provider: () => createPersistentCacheProvider({ namespace }) }}>
            <ListProbe swrKey={swrKey} />
        </SWRConfig>,
    );
}

describe('persistent SWR cache provider', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('rehydrates a cached list from disk on mount (no fetch)', () => {
        const key = '/api/t/acme/journal';
        seedBucket('acme', [[key, [{ id: '1', title: 'Cached aphid scout' }]]]);

        renderWithProvider('acme', key);

        // Rendered synchronously from the rehydrated cache — the fetcher
        // never resolves, so this can only be the persisted row.
        expect(screen.getByText('Cached aphid scout')).toBeInTheDocument();
    });

    it('keeps tenants isolated — one bucket never leaks into another', () => {
        const key = '/api/t/other/journal';
        // Seed ONLY tenant "acme"; render under tenant "other".
        seedBucket('acme', [['/api/t/acme/journal', [{ id: '1', title: 'Acme secret' }]]]);

        renderWithProvider('other', key);

        expect(screen.queryByText('Acme secret')).not.toBeInTheDocument();
    });

    it('self-evicts a bucket older than the max age', () => {
        const key = '/api/t/acme/journal';
        const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
        seedBucket('acme', [[key, [{ id: '1', title: 'Stale row' }]]], twoDaysAgo);

        render(
            <SWRConfig
                value={{
                    provider: () =>
                        createPersistentCacheProvider({
                            namespace: 'acme',
                            maxAgeMs: 24 * 60 * 60 * 1000,
                        }),
                }}
            >
                <ListProbe swrKey={key} />
            </SWRConfig>,
        );

        expect(screen.queryByText('Stale row')).not.toBeInTheDocument();
        // The stale bucket is proactively cleared from storage.
        expect(window.localStorage.getItem(storageKey('acme'))).toBeNull();
    });

    it('ignores a bucket written under a different schema version', () => {
        const key = '/api/t/acme/journal';
        window.localStorage.setItem(
            storageKey('acme'),
            JSON.stringify({
                v: SWR_CACHE_VERSION + 1,
                t: Date.now(),
                entries: [[key, [{ id: '1', title: 'Wrong version' }]]],
            }),
        );

        renderWithProvider('acme', key);

        expect(screen.queryByText('Wrong version')).not.toBeInTheDocument();
    });

    it('degrades gracefully when localStorage is unavailable (no throw)', () => {
        expect(() =>
            createPersistentCacheProvider({ namespace: 'acme', storage: null }),
        ).not.toThrow();
    });
});
