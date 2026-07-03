/**
 * WP-2 — per-tenant module gating (pure helpers; no DB access).
 *
 * A module is "enabled" for a tenant when it appears in
 * `TenantModuleSettings.enabledModules`. A tenant with NO settings row
 * has ALL modules enabled (backward-compatible default) — a tenant opts
 * into "simple mode" by saving a restricted list. The DB-backed
 * resolution + the `assertModuleEnabled` gate live in
 * `src/app-layer/usecases/modules.ts`; enforcement coverage is locked by
 * `tests/guardrails/module-gate-coverage.test.ts`.
 */
import type { ModuleKey } from '@prisma/client';

export const ALL_MODULES: readonly ModuleKey[] = [
    'JOURNAL',
    'INVENTORY',
    'PLANNING',
    'CERTIFICATION',
    'RISK',
    'VENDORS',
    'AUTOMATION',
    'PROCESSES',
    'AI',
    'GRAIN',
    'EXCHANGE',
] as const;

/**
 * "Simple mode" — the curated module set for a startup farmer. Just the
 * core ag surfaces (field journal, inventory, crop planning); none of the
 * enterprise GRC / automation modules. A tenant opts into simple mode by
 * saving this as its `TenantModuleSettings.enabledModules`. The enterprise
 * persona leaves the row null (all modules) or enables a richer set.
 *
 * Note: Tasks + Knowledge Base are NOT module-gated (always available), so
 * they aren't listed here — a simple-mode farmer still gets them.
 */
export const SIMPLE_MODE_MODULES: readonly ModuleKey[] = [
    'JOURNAL',
    'INVENTORY',
    'PLANNING',
] as const;

/** True when a tenant's enabled set is exactly the simple-mode preset. */
export function isSimpleMode(modules: readonly ModuleKey[]): boolean {
    return (
        modules.length === SIMPLE_MODE_MODULES.length &&
        SIMPLE_MODE_MODULES.every((m) => modules.includes(m))
    );
}

export const MODULE_LABELS: Record<ModuleKey, string> = {
    JOURNAL: 'Farm Journal',
    INVENTORY: 'Inventory',
    PLANNING: 'Crop Planning',
    CERTIFICATION: 'Certification & Compliance',
    RISK: 'Risk Register',
    VENDORS: 'Suppliers & Buyers',
    AUTOMATION: 'Automation',
    PROCESSES: 'Process Maps',
    AI: 'AI Assist',
    GRAIN: 'Grain & Trading',
    EXCHANGE: 'Exchange',
};

/** One-line "what this module does" copy for the settings page. */
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
    JOURNAL: 'Field operations, spray jobs, and the parcel map.',
    INVENTORY: 'Input stock, lots, and stock-deduction on job completion.',
    PLANNING: 'Crop plans, rotations, and the season calendar.',
    CERTIFICATION: 'Audit frameworks, controls, evidence, and policies.',
    RISK: 'The farm risk register and treatment tracking.',
    VENDORS: 'Suppliers, buyers, and their assessments.',
    AUTOMATION: 'Rules that react to events and run actions.',
    PROCESSES: 'Process maps and standard operating procedures.',
    AI: 'AI-assisted drafting and suggestions across the product.',
    GRAIN: 'Grain storage bins, marketing contracts, yield, and activity costing.',
    EXCHANGE: 'Cross-tenant marketplace to buy and sell commodities with other farms.',
};

/**
 * Resolve a tenant's enabled modules from its settings row.
 * `null` row (the common case) → all modules enabled.
 */
export function resolveEnabledModules(row: { enabledModules: ModuleKey[] } | null | undefined): ModuleKey[] {
    if (!row) return [...ALL_MODULES];
    return row.enabledModules;
}

export function isModuleEnabledIn(modules: readonly ModuleKey[], key: ModuleKey): boolean {
    return modules.includes(key);
}

/** Validate an arbitrary string[] down to known ModuleKey values. */
export function coerceModuleKeys(input: readonly string[]): ModuleKey[] {
    const set = new Set<string>(ALL_MODULES);
    return input.filter((m): m is ModuleKey => set.has(m));
}
