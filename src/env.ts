// Side effect — set Zod's `jitless` flag (browser only) before this
// module's own client env-validation parse, which would otherwise be the
// first thing to trigger Zod's CSP-violating `new Function` probe. See
// src/lib/zod-jitless.ts.
import '@/lib/zod-jitless';
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';
import { DEV_FALLBACK_DATA_ENCRYPTION_KEY } from '@/lib/security/encryption-constants';

export const env = createEnv({
    /**
     * Specify your server-side environment variables schema here. This way you can ensure the app
     * isn't built with invalid env vars.
     */
    server: {
        NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
        DATABASE_URL: z.string().url(),
        // Direct connection to Postgres (bypasses PgBouncer).
        // Used by Prisma for migrations, schema push, and introspection.
        // Falls back to DATABASE_URL if not set (non-pooled environments).
        DIRECT_DATABASE_URL: z.string().url().optional(),

        // Redis (rate limits, BullMQ jobs, session/cache coordination)
        //
        // Schema layer carries the optional() shape so dev/test boots
        // without Redis (rate-limit middleware + audit-stream buffer
        // both fall back to in-memory). The production-required
        // contract is enforced by the per-field superRefine() below
        // (mirrors the GAP-03 DATA_ENCRYPTION_KEY pattern).
        //
        // GAP-13 — Redis is REQUIRED in production. Without it three
        // production-load-bearing controls collapse into no-ops:
        //   - login brute-force throttle (Epic A.3)
        //   - invite-redemption rate limit
        //   - email-dispatch rate limit
        // Refuse to boot rather than ship with the limits stripped.
        //
        // Production also requires the Redis URL to be AUTHENTICATED:
        // a bare `redis://host:6379` (no password) is rejected. An
        // unauthenticated Redis that is network-reachable is wide
        // open — anyone who can reach the port can read sessions,
        // dump rate-limit counters, and enqueue jobs. The URL must
        // parse and carry a non-empty password in its userinfo
        // (`redis://:PASSWORD@HOST:6379`, `redis://user:pw@host`, or
        // `rediss://:token@host` for TLS managed Redis). The
        // `rediss://` scheme is NOT required — a same-host compose
        // service on an internal docker network is acceptable with
        // password auth alone.
        REDIS_URL: z
            .string()
            .optional()
            .superRefine((val, ctx) => {
                if (process.env.NODE_ENV !== 'production') return;
                if (!val) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                            'REDIS_URL is REQUIRED in production. ' +
                            'Rate limits, queues, and session coordination depend on it. ' +
                            'Set REDIS_URL to your Redis / ElastiCache connection string ' +
                            '(e.g. redis://:PASSWORD@HOST:6379) before deploying.',
                    });
                    return;
                }
                let url: URL;
                try {
                    url = new URL(val);
                } catch {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                            'REDIS_URL is not a valid URL. ' +
                            'Expected redis://:PASSWORD@HOST:6379 ' +
                            '(or rediss:// for TLS).',
                    });
                    return;
                }
                if (!url.password) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                            'REDIS_URL must be AUTHENTICATED in production. ' +
                            'A bare redis://HOST:6379 leaves Redis open to anyone ' +
                            'who can reach the port — sessions, rate-limit counters, ' +
                            'and the job queue all live there. Set a password: ' +
                            'redis://:PASSWORD@HOST:6379 (or rediss:// for TLS).',
                    });
                }
            }),

        // NextAuth
        NEXTAUTH_URL: z.preprocess(
            // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
            // Since NextAuth automatically uses the VERCEL_URL if present.
            (str) => process.env.VERCEL_URL ? process.env.VERCEL_URL : str,
            process.env.VERCEL ? z.string().optional() : z.string().url()
        ),
        AUTH_URL: z.preprocess(
            (str) => process.env.VERCEL_URL ? process.env.VERCEL_URL : str,
            process.env.VERCEL ? z.string().optional() : z.string().url()
        ),
        AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters long"),
        JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters long"),

        // Providers
        GOOGLE_CLIENT_ID: z.string().min(1, "Google Client ID is required"),
        GOOGLE_CLIENT_SECRET: z.string().min(1, "Google Client Secret is required"),
        MICROSOFT_CLIENT_ID: z.string().min(1, "Microsoft Client ID is required"),
        MICROSOFT_CLIENT_SECRET: z.string().min(1, "Microsoft Client Secret is required"),
        MICROSOFT_TENANT_ID: z.string().default("common"),

        // Rate Limiting
        RATE_LIMIT_ENABLED: z.enum(["0", "1"]).optional(),
        RATE_LIMIT_MODE: z.enum(["upstash", "memory"]).default("upstash"),
        AUTH_TEST_MODE: z.enum(["0", "1"]).optional(),
        // When "1", the Credentials provider rejects sign-ins whose User row
        // has `emailVerified = null`. See src/lib/auth/credentials.ts. Default
        // is OFF so existing deployments behave unchanged until verification
        // flow ships.
        AUTH_REQUIRE_EMAIL_VERIFICATION: z.enum(["0", "1"]).optional(),
        UPSTASH_REDIS_REST_URL: z.string().url().optional(),
        UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

        // File Storage
        UPLOAD_DIR: z.string().min(1, "UPLOAD_DIR must be specified"),
        FILE_STORAGE_ROOT: z.string().optional(),
        FILE_MAX_SIZE_BYTES: z.coerce.number().optional(),
        FILE_ALLOWED_MIME: z.string().optional(),

        // Cloud Storage (S3/R2/MinIO)
        STORAGE_PROVIDER: z.enum(["local", "s3"]).default("s3"),
        S3_BUCKET: z.string().optional(),
        S3_REGION: z.string().optional(),
        S3_ENDPOINT: z.string().optional(),
        S3_ACCESS_KEY_ID: z.string().optional(),
        S3_SECRET_ACCESS_KEY: z.string().optional(),

        // AV Scanning
        AV_WEBHOOK_SECRET: z.string().optional(),          // HMAC secret for webhook auth
        AV_SCAN_MODE: z.enum(["strict", "permissive", "disabled"]).default("strict"),
        CLAMAV_HOST: z.string().optional(),                  // ClamAV daemon host (e.g. clamav:3310)

        // Data Protection (Epic 8) — GAP-03 enforcement.
        //
        // Schema layer: optional() carries the *shape* (string ≥32 chars
        // when present). The production-required + dev-fallback-rejection
        // contract is enforced by the per-field superRefine() below,
        // which reads the same `process.env.NODE_ENV` the schema is
        // about to validate. Two-stage so the field-level error message
        // points at DATA_ENCRYPTION_KEY rather than a top-level object
        // refinement that prints the whole env shape.
        DATA_ENCRYPTION_KEY: z
            .string()
            .min(32, "DATA_ENCRYPTION_KEY must be at least 32 characters")
            .optional()
            .superRefine((val, ctx) => {
                // GAP-03 — production cannot boot without an encryption
                // key. Read NODE_ENV from process.env directly because
                // the parsed `env.NODE_ENV` is not yet available at
                // refine time (zod parses fields independently).
                if (process.env.NODE_ENV !== 'production') return;
                if (!val) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                            'DATA_ENCRYPTION_KEY is REQUIRED in production. ' +
                            'Generate with: openssl rand -base64 48',
                    });
                    return;
                }
                if (val === DEV_FALLBACK_DATA_ENCRYPTION_KEY) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message:
                            'DATA_ENCRYPTION_KEY equals the documented dev ' +
                            'fallback. Refusing to boot — generate a real ' +
                            'key with: openssl rand -base64 48',
                    });
                }
            }),
        // Epic B.3 — master KEK rotation. When set, the old key is used
        // as a decrypt fallback for any ciphertext the new primary KEK
        // can't read. Encryption always uses DATA_ENCRYPTION_KEY
        // (primary). Remove this var ONCE the rotation job reports zero
        // remaining v1 rows under the previous key.
        DATA_ENCRYPTION_KEY_PREVIOUS: z.string().min(32).optional(),

        // Security / CORS
        CORS_ALLOWED_ORIGINS: z.string().default(""),

        // SMTP / Email (all optional — when SMTP_HOST is absent, console sink is used)
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.coerce.number().optional(),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().default("noreply@inflect.app"),

        // Stripe Billing
        STRIPE_SECRET_KEY: z.string().optional(),
        STRIPE_WEBHOOK_SECRET: z.string().optional(),
        STRIPE_PRICE_ID_PRO: z.string().optional(),
        STRIPE_PRICE_ID_ENTERPRISE: z.string().optional(),
        APP_URL: z.string().url().optional(),

        // AI Risk Assessment
        AI_RISK_PROVIDER: z.string().default('stub'),
        OPENROUTER_API_KEY: z.string().optional(),
        OPENROUTER_MODEL: z.string().optional(),

        // ── Swappable AI provider (feat/ai-provider) ──
        // ONE OpenAI-compatible provider serves local dev (Ollama) and
        // any hosted backend (OpenRouter / Groq / Together) — they differ
        // only by base URL + key + model. Dev defaults point at a local
        // Ollama server (zero API cost, clean-licensed qwen3:1.7b), so
        // local dev works with NO configuration. Prod swaps the backend
        // purely by setting these env vars.
        //   AI_BACKEND   — explicit backend hint; when unset it is inferred
        //                  from the base-URL host (openrouter.ai → openrouter,
        //                  groq → groq, together → together, else ollama).
        //                  Drives the per-backend capability map.
        //   AI_BASE_URL  — OpenAI-compatible base (…/v1).
        //   AI_API_KEY   — bearer key. Ollama ignores it but the SDK needs a
        //                  non-empty string, hence the 'ollama' default.
        //   AI_MODEL     — model id (qwen3:1.7b locally).
        //   AI_EMBED_MODEL — embedding model for RAG (feat/ai-rag). 768-dim
        //                  nomic-embed-text by default (matches the
        //                  KnowledgeChunk.embedding vector(768) column).
        //   AI_BACKEND='claude' — native Anthropic Messages-API backend
        //                  (ClaudeProvider). When selected, the provider
        //                  uses ANTHROPIC_API_KEY (+ optional
        //                  ANTHROPIC_BASE_URL) and AI_MODEL as the model
        //                  id, rather than AI_BASE_URL / AI_API_KEY.
        AI_BACKEND: z
            .enum(['ollama', 'openrouter', 'groq', 'together', 'openai-compatible', 'claude'])
            .default('ollama'),
        AI_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
        AI_API_KEY: z.string().min(1).default('ollama'),
        AI_MODEL: z.string().min(1).default('qwen3:1.7b'),
        AI_EMBED_MODEL: z.string().min(1).default('nomic-embed-text'),
        // ── Native Claude backend (feat/ai-prod-routing) ──
        // Used only when AI_BACKEND='claude'. ANTHROPIC_API_KEY is the
        // bearer key; ANTHROPIC_BASE_URL optionally points at a proxy /
        // gateway (Anthropic's default host when unset).
        ANTHROPIC_API_KEY: z.string().optional(),
        ANTHROPIC_BASE_URL: z.string().url().optional(),

        // ── Vision subsystem (feat/ai-vision) — leaf/crop photo → pest/disease ──
        //   VISION_BACKEND    — orchestrator policy. 'auto' (default) tries the
        //                       on-device ONNX model first and falls back to
        //                       Claude when the model is absent OR confidence
        //                       is below the fallback threshold. 'onnx' /
        //                       'claude' pin a single backend.
        //   VISION_MODEL_PATH — absolute path to the ONNX classifier weights
        //                       (CropNet / MobileNetV2-PlantVillage, Apache-2.0).
        //                       Optional — when unset/missing the ONNX backend
        //                       reports unavailable and the orchestrator uses
        //                       Claude. The weights are NEVER vendored into the
        //                       repo — see THIRD_PARTY_NOTICES.md for setup.
        //   VISION_LABELS_PATH — optional newline-delimited labels file that
        //                       overrides the bundled PlantVillage class list
        //                       (use when pointing VISION_MODEL_PATH at a model
        //                       with a different class taxonomy).
        VISION_BACKEND: z.enum(['auto', 'onnx', 'claude']).default('auto'),
        VISION_MODEL_PATH: z.string().optional(),
        VISION_LABELS_PATH: z.string().optional(),

        AI_RISK_DAILY_QUOTA: z.string().optional(),
        AI_RISK_USER_RPM: z.string().optional(),
        AI_RISK_ENABLED: z.string().default('true'),
        AI_RISK_PLAN_REQUIRED: z.string().default(''),

        // ── AI eval harness (feat/ai-evals-safety) ──
        // Opt-in flag for the LLM-judge rubric scorer in the offline eval
        // runner (`scripts/ai/eval/run.ts`). '1' enables the live-model
        // judge + any case that needs a model; the CI default ('0') runs
        // the deterministic exact/contains + safety-behaviour subset with
        // no secrets and never touches a live backend.
        AI_EVAL_LLM_JUDGE: z.enum(['0', '1']).default('0'),

        // ── AI guardrails (feat/ai-guardrails) ──
        //   AI_CACHE_TTL_SECONDS       — Redis TTL for cached deterministic
        //                                completion responses. Default 3600.
        //   AI_EMBED_CACHE_TTL_SECONDS — Redis TTL for cached query/text
        //                                embeddings (longer — embeddings are
        //                                fully deterministic). Default 30 days.
        //   AI_RATE_LIMIT_PER_MIN      — per-(tenant,user) AI completion rate
        //                                ceiling per minute. Default 30.
        // All optional with sane defaults so AI works with zero config; an
        // operator tunes throughput/abuse posture by setting them.
        AI_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional(),
        AI_EMBED_CACHE_TTL_SECONDS: z.coerce.number().int().positive().optional(),
        AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().optional(),
        // ── Dhenu2 A/B eval hook (feat/ai-guardrails, OPTIONAL) ──
        // When set to a base URL + model (`<baseURL>|<model>`), the offline
        // eval harness runs the agronomy suites a SECOND time against this
        // operator-supplied endpoint and reports it side-by-side with the
        // default (general + RAG) backend. Default unset → no A/B run; CI is
        // unaffected. NO model is bundled — see docs/ai-data-flow.md for the
        // Dhenu2 licence note. Read only by scripts/ai/eval/* (eval-only).
        AI_EVAL_AB_BACKEND: z.string().optional(),

        // Agro-intel — sensor/data-stream ingestion endpoint feature flag.
        // '1' enables the token-gated POST ingestion route; anything else
        // (default) returns 503 feature_disabled. Off by default — the
        // stream-definition CRUD is always available; only live ingestion
        // is flagged so an operator opts in before exposing the endpoint.
        AGRO_DATASTREAMS_ENABLED: z.enum(['0', '1']).default('0'),

        // Agro-intel — NDVI raster tile source for the location map's
        // satellite-vegetation overlay. An XYZ `{z}/{x}/{y}` template URL.
        // Optional + default '' — when unset the NDVI toggle renders a
        // "configure a tile source" empty state instead of a raster layer.
        // Real satellite provisioning (Sentinel/Planet/EOX) is a follow-up;
        // the deliverable here is that the layer renders when a URL is set.
        // CC0 / openly-licensed sources only.
        AGRO_NDVI_TILE_URL: z.string().default(''),

        // Audit stream delivery retry (Epic E.2)
        // '0' disables retry (single POST); anything else (or unset) keeps retry on.
        // Kill-switch for debugging a misbehaving SIEM without redeploy.
        AUDIT_STREAM_RETRY_ENABLED: z.string().optional(),

        // Epic 1, PR 2 — Platform-admin API key.
        // Optional platform-scoped secret for the tenant-creation endpoint
        // (POST /api/admin/tenants). Keep out of tenant env — inject via
        // orchestrator or secret-manager only. When unset, the endpoint
        // returns 503 "Platform admin API not configured".
        PLATFORM_ADMIN_API_KEY: z.string().min(32).optional(),

        // R-4: zero-downtime rotation. During key swap, set this to the
        // OUTGOING key alongside the new PLATFORM_ADMIN_API_KEY. The
        // verifier accepts either; once you've confirmed callers use the
        // new key, drop this from env. Same shape as
        // DATA_ENCRYPTION_KEY_PREVIOUS.
        PLATFORM_ADMIN_API_KEY_PREVIOUS: z.string().min(32).optional(),

        // Local zone for task-due deadline notifications — sets BOTH the
        // cron firing time AND the calendar-day classification ("due
        // today / tomorrow / in a week"). Must be one zone so a task
        // due near local midnight is not mis-bucketed. IANA zone name,
        // DST-aware; defaults to Europe/London.
        NOTIFICATIONS_TZ: z
            .string()
            .default('Europe/London')
            .refine(
                (val) => {
                    try {
                        // A bad zone makes the formatter throw RangeError.
                        new Intl.DateTimeFormat('en-US', { timeZone: val });
                        return true;
                    } catch {
                        return false;
                    }
                },
                { message: 'NOTIFICATIONS_TZ must be a valid IANA timezone' },
            ),

        // ── Web Push (VAPID) ──
        // All optional: Web Push is opt-in. When the key pair is unset the
        // push layer is a silent no-op (subscribe endpoint 503s, sends skip),
        // so dev/CI/self-hosted run without push configured. Generate a pair
        // with `npx web-push generate-vapid-keys`.
        VAPID_PUBLIC_KEY: z.string().optional(),
        VAPID_PRIVATE_KEY: z.string().optional(),
        // `mailto:` or https contact URL embedded in the push request (push
        // services use it to reach you about delivery problems).
        VAPID_SUBJECT: z.string().optional(),
    },

    /**
     * Specify your client-side environment variables schema here. This way you can ensure the app
     * isn't built with invalid env vars. To expose them to the client, prefix them with
     * `NEXT_PUBLIC_`.
     */
    client: {
        // PR-C 2026-05-27 — opt-in flag for the SSE notification
        // bell. Off by default (the bell stays on REST polling)
        // until the client integration is verified end-to-end in
        // a real browser. Server-side stream is wired regardless;
        // flipping this to '1' is the only step to engage SSE.
        NEXT_PUBLIC_NOTIFICATIONS_SSE: z.enum(['0', '1']).optional(),

        // The VAPID public key, exposed to the browser so the client can
        // subscribe via PushManager. Mirror of VAPID_PUBLIC_KEY; absent →
        // the push opt-in UI stays hidden (feature-detected + key-gated).
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
    },

    /**
     * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
     * middlewares) or client-side so we need to destruct manually.
     */
    runtimeEnv: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        AUTH_URL: process.env.AUTH_URL,
        AUTH_SECRET: process.env.AUTH_SECRET,
        JWT_SECRET: process.env.JWT_SECRET,

        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
        MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
        MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,

        RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
        RATE_LIMIT_MODE: process.env.RATE_LIMIT_MODE,
        AUTH_TEST_MODE: process.env.AUTH_TEST_MODE,
        AUTH_REQUIRE_EMAIL_VERIFICATION: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

        UPLOAD_DIR: process.env.UPLOAD_DIR,
        FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
        FILE_MAX_SIZE_BYTES: process.env.FILE_MAX_SIZE_BYTES,
        FILE_ALLOWED_MIME: process.env.FILE_ALLOWED_MIME,

        STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,

        AV_WEBHOOK_SECRET: process.env.AV_WEBHOOK_SECRET,
        AV_SCAN_MODE: process.env.AV_SCAN_MODE,
        CLAMAV_HOST: process.env.CLAMAV_HOST,

        DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
        DATA_ENCRYPTION_KEY_PREVIOUS: process.env.DATA_ENCRYPTION_KEY_PREVIOUS,

        CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        SMTP_FROM: process.env.SMTP_FROM,

        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
        STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
        STRIPE_PRICE_ID_ENTERPRISE: process.env.STRIPE_PRICE_ID_ENTERPRISE,
        APP_URL: process.env.APP_URL,

        AI_RISK_PROVIDER: process.env.AI_RISK_PROVIDER,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
        AI_BACKEND: process.env.AI_BACKEND,
        AI_BASE_URL: process.env.AI_BASE_URL,
        AI_API_KEY: process.env.AI_API_KEY,
        AI_MODEL: process.env.AI_MODEL,
        AI_EMBED_MODEL: process.env.AI_EMBED_MODEL,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        VISION_BACKEND: process.env.VISION_BACKEND,
        VISION_MODEL_PATH: process.env.VISION_MODEL_PATH,
        VISION_LABELS_PATH: process.env.VISION_LABELS_PATH,
        AI_RISK_DAILY_QUOTA: process.env.AI_RISK_DAILY_QUOTA,
        AI_RISK_USER_RPM: process.env.AI_RISK_USER_RPM,
        AI_RISK_ENABLED: process.env.AI_RISK_ENABLED,
        AI_EVAL_LLM_JUDGE: process.env.AI_EVAL_LLM_JUDGE,
        AI_CACHE_TTL_SECONDS: process.env.AI_CACHE_TTL_SECONDS,
        AI_EMBED_CACHE_TTL_SECONDS: process.env.AI_EMBED_CACHE_TTL_SECONDS,
        AI_RATE_LIMIT_PER_MIN: process.env.AI_RATE_LIMIT_PER_MIN,
        AI_EVAL_AB_BACKEND: process.env.AI_EVAL_AB_BACKEND,
        AI_RISK_PLAN_REQUIRED: process.env.AI_RISK_PLAN_REQUIRED,
        AGRO_DATASTREAMS_ENABLED: process.env.AGRO_DATASTREAMS_ENABLED,
        AGRO_NDVI_TILE_URL: process.env.AGRO_NDVI_TILE_URL,

        AUDIT_STREAM_RETRY_ENABLED: process.env.AUDIT_STREAM_RETRY_ENABLED,
        PLATFORM_ADMIN_API_KEY: process.env.PLATFORM_ADMIN_API_KEY,
        PLATFORM_ADMIN_API_KEY_PREVIOUS: process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS,
        NOTIFICATIONS_TZ: process.env.NOTIFICATIONS_TZ,
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: process.env.VAPID_SUBJECT,

        NEXT_PUBLIC_NOTIFICATIONS_SSE: process.env.NEXT_PUBLIC_NOTIFICATIONS_SSE,
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    },
    /**
     * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
     * This is especially useful for Docker builds.
     */
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
    /**
     * Makes it so that empty strings are treated as undefined.
     * `SOME_VAR: z.string()` and `SOME_VAR=''` will throw an error.
     */
    emptyStringAsUndefined: true,
});
