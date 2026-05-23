#!/usr/bin/env node
/**
 * Bundle-size report.
 *
 * Runs after `next build` and prints the first-load JS / per-route
 * payload sizes in a machine-readable shape that can be diffed between
 * commits. Writes a `bundle-size-report.json` to the CWD so CI (or a
 * future ratchet test) can compare against a baseline.
 *
 * Usage:
 *   npm run build && node scripts/bundle-size-report.js
 *
 * The Next.js build already prints this info, but grabbing it from
 * the `.next/build-manifest.json` + the `.next/static/` directory
 * gives us reproducible numbers without screen-scraping stdout.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, '.next');
const BUILD_MANIFEST = path.join(NEXT_DIR, 'build-manifest.json');
const APP_MANIFEST = path.join(NEXT_DIR, 'app-build-manifest.json');

function exitWith(msg, code = 1) {
    console.error(msg);
    process.exit(code);
}

if (!fs.existsSync(NEXT_DIR)) {
    exitWith(
        "No .next directory found. Run `npm run build` before the bundle report.",
    );
}

function byteSize(file) {
    try {
        return fs.statSync(file).size;
    } catch {
        return 0;
    }
}

function sumSizes(files) {
    return files.reduce((acc, rel) => {
        const abs = path.join(NEXT_DIR, rel);
        return acc + byteSize(abs);
    }, 0);
}

function readManifest(file) {
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

const buildManifest = readManifest(BUILD_MANIFEST);
const appManifest = readManifest(APP_MANIFEST);

if (!buildManifest && !appManifest) {
    exitWith(
        'Neither build-manifest.json nor app-build-manifest.json found. Is this a Next.js build?',
    );
}

const report = {
    generatedAt: new Date().toISOString(),
    sharedJs: {},
    routes: {},
};

// ─── Pages router bundles (legacy) ───────────────────────────────
if (buildManifest?.pages) {
    for (const [route, chunks] of Object.entries(buildManifest.pages)) {
        if (typeof chunks !== 'object' || !Array.isArray(chunks)) continue;
        report.routes[route] = {
            runtime: 'pages',
            chunkCount: chunks.length,
            totalBytes: sumSizes(chunks),
        };
    }
}

// ─── App router bundles (current) ────────────────────────────────
if (appManifest?.pages) {
    for (const [route, chunks] of Object.entries(appManifest.pages)) {
        if (!Array.isArray(chunks)) continue;
        report.routes[route] = {
            runtime: 'app',
            chunkCount: chunks.length,
            totalBytes: sumSizes(chunks),
        };
    }
}

// ─── Summary ─────────────────────────────────────────────────────
const KB = (n) => `${(n / 1024).toFixed(1)} KB`;

const sortedRoutes = Object.entries(report.routes).sort(
    (a, b) => b[1].totalBytes - a[1].totalBytes,
);

console.log('\n=== Bundle size report ===\n');
console.log(
    `Report generated: ${report.generatedAt}`,
);
console.log(`Routes analysed: ${sortedRoutes.length}\n`);

console.log('Top 15 routes by payload:');
for (const [route, info] of sortedRoutes.slice(0, 15)) {
    console.log(
        `  ${KB(info.totalBytes).padStart(10)}  ${String(info.chunkCount).padStart(3)} chunks  ${route}`,
    );
}

const totalBytes = sortedRoutes.reduce(
    (acc, [, info]) => acc + info.totalBytes,
    0,
);
console.log(`\nTotal route JS: ${KB(totalBytes)} across ${sortedRoutes.length} routes`);

const outFile = path.join(ROOT, 'bundle-size-report.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outFile}`);
