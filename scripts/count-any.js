/**
 * CI report script: counts occurrences of untyped `any` patterns in the source code.
 * Run: node scripts/count-any.js
 *
 * This does NOT fail the build — it just outputs metrics.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const PATTERNS = [
    { label: ': any',        regex: /:\s*any\b/g },
    { label: '<any>',        regex: /<any>/g },
    { label: 'useState<any>', regex: /useState<any>/g },
    { label: 'as any',       regex: /as\s+any\b/g },
    { label: '// @ts-ignore', regex: /\/\/\s*@ts-ignore/g },
];

function walkDir(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            results.push(...walkDir(fullPath));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

function countPatterns(filePath, pattern) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(pattern);
    return matches ? matches.length : 0;
}

// ─── Main ───

console.log('=== any / ts-ignore Usage Report ===\n');

const files = walkDir(SRC_DIR);
const totals = {};

for (const { label } of PATTERNS) {
    totals[label] = 0;
}

for (const file of files) {
    for (const { label, regex } of PATTERNS) {
        // Reset lastIndex for global regex
        regex.lastIndex = 0;
        const count = countPatterns(file, regex);
        totals[label] += count;
    }
}

let totalAll = 0;
for (const { label } of PATTERNS) {
    console.log(`  ${label.padEnd(20)} ${String(totals[label]).padStart(4)}`);
    totalAll += totals[label];
}

console.log(`  ${'─'.repeat(25)}`);
console.log(`  ${'TOTAL'.padEnd(20)} ${String(totalAll).padStart(4)}`);
console.log(`\nScanned ${files.length} files in src/`);
console.log('Tip: This count should decrease over time as DTOs replace any.\n');
