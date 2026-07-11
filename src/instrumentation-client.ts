/**
 * Next.js client instrumentation entry (runs once in the browser before the
 * app renders). The Next 16 replacement for `sentry.client.config.ts` — Next
 * auto-loads this module on the client, so no `withSentryConfig` wrapper is
 * needed.
 *
 * It wires the browser Sentry SDK (DSN-gated; a no-op without one) so that
 * `global-error.tsx`'s `captureException` and uncaught client errors actually
 * transmit. See `sentry-client.ts` for the sampling rationale.
 */
import { env } from '@/env';
import { initClientSentry } from '@/lib/observability/sentry-client';

initClientSentry(env.NEXT_PUBLIC_SENTRY_DSN, {
    release: env.NEXT_PUBLIC_SENTRY_RELEASE,
});
