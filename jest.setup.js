// Provide mandatory env vars for src/env.ts validation during tests.
//
// For DATABASE_URL: shell env wins; then try .env (the normal local-dev
// pattern — no need to re-source the file for `npm test`); then fall
// back to a dummy URL that lets env validation pass for unit tests
// that mock Prisma. Integration tests that actually connect will still
// use whichever real URL we resolved here.
if (!process.env.DATABASE_URL) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envContent = fs.readFileSync(path.resolve(__dirname, '.env'), 'utf8');
    const match = envContent.match(/^DATABASE_URL="?([^"\n]*)"?$/m);
    if (match && match[1]) process.env.DATABASE_URL = match[1];
  } catch { /* no .env — fall through to dummy */ }
}
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/testdb';
process.env.AUTH_SECRET = 'supersecretstringthatis16charplus'; // pragma: allowlist secret -- test fixture
process.env.JWT_SECRET = 'supersecretstringthatis16charplus'; // pragma: allowlist secret -- test fixture
process.env.GOOGLE_CLIENT_ID = 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'; // pragma: allowlist secret -- test fixture
process.env.MICROSOFT_CLIENT_ID = 'test-ms-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret';
process.env.UPLOAD_DIR = 'uploads';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';

// Note: tests/unit/env.test.ts clears this and runs in a separate process
// so it can still test the actual validation logic.
// We set this to prevent env loader from crashing other unit tests.
process.env.SKIP_ENV_VALIDATION = '1';

// Polyfill global fail() for guard tests (removed in newer Jest versions)
if (typeof globalThis.fail === 'undefined') {
  globalThis.fail = (message) => {
    throw new Error(typeof message === 'string' ? message : 'Test failed via fail()');
  };
}

// Jest's jsdom environment doesn't expose `TextEncoder` / `TextDecoder`
// on globalThis — Node has them, but Jest's jsdom stripping doesn't
// pass them through. Some unit tests use `@jest-environment jsdom`
// and transitively load `@prisma/client`, which pulls in `cuid2`
// → `@noble/hashes` → `new TextEncoder()` at module load. Without
// this polyfill those tests fail with "TextEncoder is not defined".
// Cheap workaround pinned to the Node-builtin implementation.
if (typeof globalThis.TextEncoder === 'undefined') {

  const { TextEncoder, TextDecoder } = require('node:util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
