#!/usr/bin/env node
/**
 * PR-6 codemod — migrate `<div className="glass-card p-5 ...">` and
 * `<div className="glass-card p-8 ...">` sites onto the canonical
 * `<Card>` primitive (default `density="comfortable"` = `p-6`).
 *
 *   node scripts/codemods/glass-card-density-migration.js          # apply
 *   node scripts/codemods/glass-card-density-migration.js --dry    # report
 *
 * What this codemod does NOT touch:
 *   - `glass-card p-4` sites — still on the canonical compact rung.
 *     Future migration to `<Card density="compact">` is a follow-up.
 *   - `glass-card p-6` sites — already on the canonical comfortable
 *     rung. Future migration to `<Card>` is a follow-up.
 *   - `glass-card` with no padding token — these have padding owned
 *     by their children; future migration to `<Card density="none">`
 *     is a follow-up.
 *   - `<button>`, `<section>`, etc. wrappers — only `<div>` cards are
 *     mechanically swappable. Other tags need `<Card as="…">` and a
 *     human review of accessibility implications.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TARGETS = ["src/app", "src/components"];

const EXCLUDE_DIR_NAMES = new Set(["node_modules", "__tests__", "__mocks__"]);
const EXCLUDE_FILE_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.stories\.tsx?$/,
  /\/card\.tsx$/,
];

const DRY = process.argv.includes("--dry");

// Match `<div className="...glass-card...p-5..." [other attrs]>` on a
// single line. The order of `glass-card` and `p-5/p-8` in the className
// string is variable, so we match either ordering.
//
// Capture groups:
//   1 = full className string (incl. quotes)
//   2 = full attrs after className (or "")
function transformDivCards(content) {
  let count = 0;
  // Pattern: <div className="..." rest> where the className contains
  // both `glass-card` and `p-5`/`p-8` as whole-word tokens.
  const re = /<div\s+([^>]*?)className="([^"]*\bglass-card\b[^"]*)"([^>]*?)>/g;
  content = content.replace(re, (match, beforeAttrs, classNameValue, afterAttrs) => {
    const classes = classNameValue.split(/\s+/).filter(Boolean);
    if (!classes.includes("glass-card")) return match;
    const targetPad = classes.includes("p-5")
      ? "p-5"
      : classes.includes("p-8")
        ? "p-8"
        : null;
    if (!targetPad) return match;
    // Remove glass-card and the target padding token; keep everything
    // else as the className passthrough on <Card>.
    const remaining = classes
      .filter((c) => c !== "glass-card" && c !== targetPad)
      .join(" ");
    const otherAttrs = (beforeAttrs.trim() + " " + afterAttrs.trim()).trim();
    const otherAttrsStr = otherAttrs ? ` ${otherAttrs}` : "";
    const classNameProp = remaining ? ` className="${remaining}"` : "";
    count++;
    // Default density="comfortable" — no need to spell it out.
    return `<Card${classNameProp}${otherAttrsStr}>`;
  });
  return { content, count };
}

// Each `<div className="glass-card …">` open tag we replaced needs a
// matching `</div>` → `</Card>` close. We can't do this safely with a
// generic regex (nested divs make matching ambiguous), so we walk the
// JSX with a tag-balanced approach: for each `<Card …>` we just emitted,
// scan forward and convert the matching `</div>` to `</Card>`.
function balanceClosingTags(content) {
  let count = 0;
  const result = [];
  let i = 0;
  while (i < content.length) {
    // Find the next `<Card` opening tag (without slash — opening only).
    const cardOpenIdx = content.indexOf("<Card", i);
    if (cardOpenIdx === -1) {
      result.push(content.slice(i));
      break;
    }
    // Find the `>` that closes the Card opening tag.
    const tagEnd = content.indexOf(">", cardOpenIdx);
    if (tagEnd === -1) {
      result.push(content.slice(i));
      break;
    }
    // Append everything up to and including the Card tag's `>`.
    result.push(content.slice(i, tagEnd + 1));
    i = tagEnd + 1;

    // Now walk forward, balancing `<div` opens against `</div>` closes,
    // until we find the matching close (which becomes `</Card>`).
    let depth = 1;
    let j = i;
    while (j < content.length) {
      const nextDivOpen = content.indexOf("<div", j);
      const nextDivClose = content.indexOf("</div>", j);
      const nextCardOpen = content.indexOf("<Card", j);
      const nextCardClose = content.indexOf("</Card>", j);
      // Find the soonest of the four
      const candidates = [
        { idx: nextDivOpen, kind: "div-open" },
        { idx: nextDivClose, kind: "div-close" },
        { idx: nextCardOpen, kind: "card-open" },
        { idx: nextCardClose, kind: "card-close" },
      ].filter((c) => c.idx !== -1);
      if (candidates.length === 0) {
        result.push(content.slice(j));
        return { content: result.join(""), count };
      }
      candidates.sort((a, b) => a.idx - b.idx);
      const next = candidates[0];
      if (next.kind === "div-open" || next.kind === "card-open") {
        depth++;
        result.push(content.slice(j, next.idx + 1));
        j = next.idx + 1;
      } else if (next.kind === "card-close") {
        depth--;
        if (depth === 0) {
          // The Card we're tracking is closed by an existing </Card>.
          // (Unusual — only happens if codemod ran twice and the file
          // is partially migrated.)
          result.push(content.slice(j, next.idx + "</Card>".length));
          j = next.idx + "</Card>".length;
          break;
        }
        result.push(content.slice(j, next.idx + "</Card>".length));
        j = next.idx + "</Card>".length;
      } else {
        // div-close
        depth--;
        if (depth === 0) {
          // Convert this </div> into </Card>
          result.push(content.slice(j, next.idx));
          result.push("</Card>");
          j = next.idx + "</div>".length;
          count++;
          break;
        }
        result.push(content.slice(j, next.idx + "</div>".length));
        j = next.idx + "</div>".length;
      }
    }
    i = j;
  }
  return { content: result.join(""), count };
}

function ensureCardImport(content) {
  if (!/<Card\b/.test(content)) return { content, added: false };
  if (/from\s+['"]@\/components\/ui\/card['"]/.test(content)) {
    return { content, added: false };
  }
  const importLine = `import { Card } from '@/components/ui/card';\n`;
  const lines = content.split("\n");
  let lastImportEnd = -1;
  let depth = 0;
  let inImportBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (depth === 0) {
      if (trimmed.startsWith("import ") || trimmed.startsWith("import{")) {
        inImportBlock = true;
      } else if (
        trimmed.startsWith("'use ") ||
        trimmed.startsWith('"use ') ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed === ""
      ) {
        // skip
      } else if (inImportBlock) {
        break;
      }
    }
    if (inImportBlock) {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth === 0 && /;\s*$/.test(trimmed)) {
        lastImportEnd = i;
      }
    }
  }
  if (lastImportEnd >= 0) {
    lines.splice(lastImportEnd + 1, 0, importLine.trimEnd());
  } else if (lines[0] && /^['"]use\s+\w+['"]\s*;?\s*$/.test(lines[0].trim())) {
    lines.splice(1, 0, importLine.trimEnd());
  } else {
    lines.unshift(importLine.trimEnd());
  }
  return { content: lines.join("\n"), added: true };
}

function isExcluded(absPath) {
  const rel = path.relative(ROOT, absPath);
  const segments = rel.split(path.sep);
  if (segments.some((s) => EXCLUDE_DIR_NAMES.has(s))) return true;
  if (EXCLUDE_FILE_PATTERNS.some((rx) => rx.test(rel))) return true;
  return false;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isExcluded(full)) continue;
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function main() {
  const files = TARGETS.flatMap((t) => walk(path.join(ROOT, t)));
  let totalFiles = 0;
  let totalReplacements = 0;
  let importsAdded = 0;
  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    const c1 = transformDivCards(before);
    if (c1.count === 0) continue;
    const c2 = balanceClosingTags(c1.content);
    if (c2.count !== c1.count) {
      console.warn(
        `! ${path.relative(ROOT, file)}: opened ${c1.count} <Card> but closed ${c2.count} </Card> — skipping (manual review needed)`,
      );
      continue;
    }
    const c3 = ensureCardImport(c2.content);
    const final = c3.content;
    if (final !== before) {
      totalFiles++;
      totalReplacements += c1.count;
      if (c3.added) importsAdded++;
      if (!DRY) fs.writeFileSync(file, final);
      console.log(
        `${c1.count.toString().padStart(4)}  ${path.relative(ROOT, file)}`,
      );
    }
  }
  console.log(
    `\n${DRY ? "[dry-run]" : "[applied]"} ${totalReplacements} replacement(s) across ${totalFiles} file(s); ${importsAdded} import(s) added.`,
  );
}

main();
