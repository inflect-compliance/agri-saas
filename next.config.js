const createNextIntlPlugin = require('next-intl/plugin');

// Bump EventEmitter cap before Next loads any HTTP/socket modules so the
// undici keep-alive socket pool doesn't trigger spurious
// MaxListenersExceededWarning lines for per-socket
// unpipe/error/close/finish listeners that accumulate across pooled
// requests. Set here (not in src/instrumentation.ts) because the dev
// server starts listening on the port before instrumentation.ts runs,
// so sockets created during early bootstrap miss the bump otherwise.
require('node:events').EventEmitter.defaultMaxListeners = Math.max(
    require('node:events').EventEmitter.defaultMaxListeners ?? 10,
    50,
);

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const defaultOptions = {
    // GAP-05 — Next 15 promoted `serverComponentsExternalPackages`
    // out of `experimental` and renamed it to `serverExternalPackages`.
    // The list itself is unchanged from the v14 era; these packages
    // use native deps (worker_threads, native HTTP clients, dynamic
    // require) that don't survive Next's webpack bundling.
    serverExternalPackages: [
        'pdfkit',
        // Pino & transports — use native worker_threads / dynamic require
        'pino',
        'pino-pretty',
        'thread-stream',
        // OpenTelemetry — heavy native instrumentation modules
        '@opentelemetry/api',
        '@opentelemetry/resources',
        '@opentelemetry/sdk-trace-node',
        '@opentelemetry/sdk-metrics',
        '@opentelemetry/exporter-trace-otlp-http',
        '@opentelemetry/exporter-metrics-otlp-http',
        '@opentelemetry/semantic-conventions',
        // Sentry — optional error reporting
        '@sentry/nextjs',
        '@sentry/node',
        // AWS SDK — native HTTP client, credential resolution
        '@aws-sdk/client-s3',
        '@aws-sdk/s3-request-presigner',
    ],
    experimental: {
        // optimizePackageImports remains experimental in Next 15.
        optimizePackageImports: [
            'lucide-react',
            '@tanstack/react-query',
        ],
    },
    async headers() {
        return [
            {
                // Apply these headers to all routes globally.
                // NOTE: Content-Security-Policy is set dynamically in middleware.ts
                // (per-request nonce) and is NOT included here.
                source: '/(.*)',
                headers: [
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff',
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin',
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY',
                    },
                    {
                        key: 'Permissions-Policy',
                        // geolocation=(self) so the operator parcel map's
                        // "locate me" / live-tracking (navigator.geolocation)
                        // works on our own origin; camera/microphone stay
                        // closed (photo capture uses file-input `capture`).
                        value: 'camera=(), microphone=(), geolocation=(self), browsing-topics=()',
                    },
                    {
                        key: 'Cross-Origin-Opener-Policy',
                        value: 'same-origin',
                    },
                    {
                        key: 'Cross-Origin-Resource-Policy',
                        value: 'same-origin',
                    },
                    {
                        // Note: Only add max-age and preload if you guarantee HTTPS.
                        key: 'Strict-Transport-Security',
                        value: process.env.NODE_ENV === 'production' 
                            ? 'max-age=31536000; includeSubDomains; preload' 
                            : 'max-age=0',
                    },
                ],
            },
        ];
    },
};

/** @type {import('next').NextConfig} */
const nextConfig = {
    ...defaultOptions,
    // Use a separate build directory for E2E tests to avoid .next cache
    // contention when multiple dev servers run concurrently.
    ...(process.env.NEXT_TEST_MODE ? { distDir: '.next-test' } : {}),
    eslint: {
        // Lint runs separately in CI (npm run lint). Don't block builds.
        ignoreDuringBuilds: true,
    },
    typescript: {
        // TS errors are checked separately. Don't block production builds.
        ignoreBuildErrors: true,
    },
};
module.exports = withNextIntl(nextConfig);
