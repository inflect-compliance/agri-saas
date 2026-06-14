#!/usr/bin/env tsx
/**
 * Stock Ledger Hash Chain Verification Script
 *
 * Twin of `scripts/verify-audit-chain.ts` for the append-only,
 * hash-chained StockTransaction ledger. Walks each tenant's stock chain
 * and recomputes every `entryHash` with the SAME canonical discipline
 * used on insert (`src/lib/inventory/stock-ledger.ts::verifyStockChain`),
 * reporting any break (a re-ordered, edited, or deleted ledger row).
 *
 * Together with the DB immutability trigger (which blocks UPDATE/DELETE)
 * and the `no-direct-stock-writes` guardrail (single writer), this is the
 * operator's after-the-fact tamper check for the food-safety ledger.
 *
 * Usage:
 *   npx tsx scripts/verify-stock-chain.ts                  # All tenants
 *   npx tsx scripts/verify-stock-chain.ts --tenant <id>    # Single tenant
 *   npx tsx scripts/verify-stock-chain.ts --json           # JSON output
 *   npx tsx scripts/verify-stock-chain.ts --help
 *
 * Exit codes:
 *   0 = all chains valid
 *   1 = at least one chain has a break
 *   2 = script error
 */
import { prisma } from '../src/lib/prisma';
import { verifyStockChain, type StockChainVerification } from '../src/lib/inventory/stock-ledger';

interface CliArgs {
    tenant?: string;
    json: boolean;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = { json: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--tenant' && args[i + 1]) {
            result.tenant = args[++i];
        } else if (arg === '--json') {
            result.json = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (!arg.startsWith('--') && !result.tenant) {
            result.tenant = arg; // legacy positional tenant id
        }
    }
    return result;
}

function printHelp() {
    console.log(`
Stock Ledger Hash Chain Verification

Usage:
  npx tsx scripts/verify-stock-chain.ts [options]

Options:
  --tenant <id>   Verify a single tenant (default: all tenants)
  --json          Output machine-readable JSON
  --help, -h      Show this help message

Exit codes:
  0  All chains are valid
  1  One or more chains have integrity issues
  2  Script error
`);
}

function printResult(r: StockChainVerification, name?: string) {
    const icon = r.valid ? '✅' : '❌';
    const label = name ? ` (${name})` : '';
    console.log(`  ${icon} Tenant: ${r.tenantId}${label}`);
    console.log(`     Entries:  ${r.totalEntries}`);
    if (r.valid) {
        console.log(`     Status:   VALID`);
    } else {
        console.log(`     Status:   BROKEN`);
        console.log(`     Break at: position ${r.firstBreakAt} (row ${r.firstBreakId})`);
    }
    console.log('');
}

async function main() {
    const args = parseArgs();

    let entries: { result: StockChainVerification; name?: string }[];
    if (args.tenant) {
        entries = [{ result: await verifyStockChain(prisma, args.tenant) }];
    } else {
        const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
        entries = [];
        for (const t of tenants) {
            entries.push({ result: await verifyStockChain(prisma, t.id), name: t.name });
        }
    }

    const allValid = entries.every((e) => e.result.valid);
    const totalEntries = entries.reduce((n, e) => n + e.result.totalEntries, 0);

    if (args.json) {
        console.log(JSON.stringify({ allValid, results: entries.map((e) => e.result) }, null, 2));
    } else {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  STOCK LEDGER HASH CHAIN INTEGRITY REPORT');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`  Tenants checked: ${entries.length}`);
        console.log(`  Total entries:   ${totalEntries}`);
        console.log('');
        for (const e of entries) printResult(e.result, e.name);
        console.log('───────────────────────────────────────────────────────────');
        console.log(allValid ? '  🎉 RESULT: ALL CHAINS VALID' : '  ⚠️  RESULT: INTEGRITY ISSUES FOUND');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
    }

    await prisma.$disconnect();
    process.exit(allValid ? 0 : 1);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
});
