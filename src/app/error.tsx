'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Global Error Boundary for the Next.js App Router.
 * Automatically catches unhandled errors in server and client components
 * within the `/app` directory, preventing the app from crashing entirely.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Report to Sentry — wrapped in try/catch so the error boundary
        // itself never crashes (which causes "missing required error components")
        try {
            Sentry.captureException(error, {
                tags: { digest: error.digest || 'none' },
            });
        } catch {
            console.error('[error.tsx] Failed to report to Sentry:', error);
        }
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg-page p-6">
            <div className="max-w-md w-full text-center space-y-6 bg-bg-default p-8 rounded-xl shadow-lg border border-border-subtle">
                <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-bg-error">
                    <svg className="h-8 w-8 text-content-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                <div>
                    <h2 className="text-2xl font-bold text-content-emphasis mb-2">
                        Something went wrong
                    </h2>
                    <p className="text-sm text-content-muted">
                        We&apos;re sorry, an unexpected error has occurred. Our team has been notified.
                        {error.digest && (
                            <span className="block mt-2 text-xs font-mono bg-bg-muted text-content-default px-2 py-1 rounded inline-block">
                                Error ID: {error.digest}
                            </span>
                        )}
                    </p>
                </div>

                <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={() => reset()}
                        className="inline-flex justify-center w-full sm:w-auto px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-[var(--brand-emphasis)] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
                    >
                        Try again
                    </button>
                    <button
                        onClick={() => window.location.href = '/dashboard'}
                        className="inline-flex justify-center w-full sm:w-auto px-4 py-2 border border-border-default shadow-sm text-sm font-medium rounded-md text-content-default bg-bg-default hover:bg-bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
