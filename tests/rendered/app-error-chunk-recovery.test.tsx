/** @jest-environment jsdom */
/**
 * The (app) error boundary auto-recovers from a stale-chunk load failure
 * (ChunkLoadError) — reloading once onto fresh assets — instead of stranding
 * the operator on "Something went wrong". It never loops (10s guard) and never
 * recovers a genuine (non-chunk) error. This is the fix for the client-side
 * "something went wrong" a stale-service-worker client hits after a deploy.
 *
 * jsdom's `location.reload` is a non-configurable, read-only property that can't
 * be spied/redefined (see service-worker-registrar-update.test), so — like that
 * test — we assert the observable behaviour (render output + the shared
 * `chunkReloadAt` guard stamp) and swallow jsdom's "Not implemented: navigation".
 */
import { render, screen } from '@testing-library/react';

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import AppSectionError from '@/app/t/[tenantSlug]/(app)/error';

const RELOAD_KEY = 'chunkReloadAt';

function chunkError(): Error {
    const e = new Error('Loading chunk 42 failed');
    e.name = 'ChunkLoadError';
    return e;
}

describe('AppSectionError — stale-chunk recovery', () => {
    const OLD_ENV = process.env.NODE_ENV;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        sessionStorage.clear();
        // Exercising the reload calls jsdom's unimplemented location.reload(),
        // which logs "Not implemented: navigation". Swallow only that.
        errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            if (String(args[0]).includes('Not implemented: navigation')) return;
            process.stderr.write(String(args[0]) + '\n');
        });
    });
    afterEach(() => {
        errorSpy.mockRestore();
        (process.env as { NODE_ENV?: string }).NODE_ENV = OLD_ENV;
    });

    it('recovers a ChunkLoadError in production: renders nothing + stamps the reload guard', () => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
        const { container } = render(<AppSectionError error={chunkError()} reset={jest.fn()} />);
        expect(screen.queryByTestId('app-section-error')).not.toBeInTheDocument();
        expect(container).toBeEmptyDOMElement();
        // The reload path ran (guard was stamped).
        expect(sessionStorage.getItem(RELOAD_KEY)).toBeTruthy();
    });

    it('shows the error UI (no recovery) for a genuine, non-chunk error', () => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
        render(<AppSectionError error={new Error('boom')} reset={jest.fn()} />);
        expect(screen.getByTestId('app-section-error')).toBeInTheDocument();
        expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
    });

    it('does not loop — a chunk error within 10s of a prior reload shows the error UI', () => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
        sessionStorage.setItem(RELOAD_KEY, String(Date.now())); // just reloaded
        render(<AppSectionError error={chunkError()} reset={jest.fn()} />);
        expect(screen.getByTestId('app-section-error')).toBeInTheDocument();
    });

    it('does not recover outside production (dev/test)', () => {
        (process.env as { NODE_ENV?: string }).NODE_ENV = 'test';
        render(<AppSectionError error={chunkError()} reset={jest.fn()} />);
        expect(screen.getByTestId('app-section-error')).toBeInTheDocument();
        expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
    });
});
