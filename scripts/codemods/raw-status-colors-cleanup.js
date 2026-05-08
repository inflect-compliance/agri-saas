#!/usr/bin/env node
/**
 * One-shot cleanup for the regex-ordering bug in the initial run of
 * raw-status-colors.js (SHADE alternation listed `50` before `500`,
 * so `*-500{/alpha?}` patterns matched as `*-50` and left a stray `0`
 * — sometimes followed by `/{alpha}` from the original alpha modifier).
 *
 * Removes the stray `0` (and any `/{alpha}` after it) following migrated
 * semantic tokens. Idempotent — safe to re-run.
 *
 *   node scripts/codemods/raw-status-colors-cleanup.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TARGETS = ["src/app", "src/components"];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts|jsx|js|css)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// Match: <prefix>{text-content|bg-bg|border-border|divide-border}-{status}{-emphasis?}0{/alpha?}
//        and rewrite to drop the stray `0` (and any /alpha after it).
const PATTERN = new RegExp(
  "((?:[A-Za-z0-9_-]+(?:\\/[A-Za-z0-9_-]+)?:)*)(text-content|bg-bg|border-border|divide-border)-(success|warning|error|info)(-emphasis)?0(?:\\/(?:\\d{1,3}|\\[[\\d.]+\\]))?",
  "g",
);

function main() {
  const files = TARGETS.flatMap((t) => walk(path.join(ROOT, t)));
  let totalFiles = 0;
  let totalReplacements = 0;
  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    let count = 0;
    const after = before.replace(PATTERN, (_m, prefix, kind, status, emphasis) => {
      count++;
      return `${prefix}${kind}-${status}${emphasis || ""}`;
    });
    if (count > 0) {
      totalFiles++;
      totalReplacements += count;
      fs.writeFileSync(file, after);
      const rel = path.relative(ROOT, file);
      console.log(`${count.toString().padStart(4)}  ${rel}`);
    }
  }
  console.log(
    `\n[cleanup] ${totalReplacements} replacement(s) across ${totalFiles} file(s).`,
  );
}

main();
