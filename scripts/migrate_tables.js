#!/usr/bin/env node
/**
 * Epic 52 — auditing script: counts remaining raw <table> usage vs DataTable.
 */
const { execSync } = require('child_process');

const APP = 'src/app/t';

const rawTables = execSync(`grep -rl '<table' ${APP}/ --include="*.tsx" 2>/dev/null || true`, { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean);
const dataTables = execSync(`grep -rl 'DataTable' ${APP}/ --include="*.tsx" 2>/dev/null || true`, { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean);

console.log(`Raw <table>: ${rawTables.length} files`);
console.log(`<DataTable>: ${dataTables.length} files\n`);

console.log('Raw <table> files:');
for (const f of rawTables) {
    const rel = f.replace('src/app/t/[tenantSlug]/(app)/', '');
    const count = execSync(`grep -c '<table' "${f}"`, { encoding: 'utf-8' }).trim();
    console.log(`  ${rel} (${count} tables)`);
}
