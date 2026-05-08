'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';

/**
 * Error boundary for the tenant-scoped app shell.
 *
 * Catches errors that occur inside any page within (app)/ — e.g. tasks,
 * controls, policies — and renders a recovery UI *inside* the sidebar layout.
 * Without this, errors bubble up to the root error.tsx, which unmounts
 * the entire app shell (leaving users on a blank page with no navigation).
 *
 * Architecture:
 *   root layout → [tenantSlug]/layout (server) → (app)/layout (client)
 *                                                  ↳ error.tsx  ← THIS FILE
 *   This sits below the sidebar / navbar but above page content.
 */
export default function AppSectionError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[AppSectionError]', error);
    }, [error]);

    return (
        <div className="space-y-6 animate-fadeIn">
            <Card className="text-center max-w-xl mx-auto mt-12">
                <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-bg-error mb-4">
                    <svg className="h-7 w-7 text-content-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                <Heading level={1} className="mb-2">
                    Something went wrong
                </Heading>

                <p className="text-sm text-content-muted mb-6">
                    This page encountered an error. You can try again or navigate to
                    another section using the sidebar.
                    {error.digest && (
                        <span className="block mt-2 text-xs font-mono text-content-subtle">
                            Error ID: {error.digest}
                        </span>
                    )}
                </p>

                <div className="flex gap-3 justify-center">
                    <Button
                        variant="primary"
                        onClick={() => reset()}
                    >
                        Try again
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => window.location.href = '/dashboard'}
                    >
                        Go to Dashboard
                    </Button>
                </div>
            </Card>
        </div>
    );
}
