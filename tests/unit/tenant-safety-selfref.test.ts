/**
 * Tenant Safety & Self-Reference Handling Tests
 *
 * Tests:
 *   1. Self-reference cycle detection
 *   2. Topological sort for hierarchical data
 *   3. Cross-tenant FK rejection
 *   4. Duplicate ID detection
 *   5. Bundle integrity validation
 *   6. Relationship target validation
 *   7. Import service rejects unsafe bundles
 *   8. Schema guardrail: no self-referencing models in current schema
 */

import {
    detectSelfReferenceCycles,
    topologicalSortSelfRefs,
    validateTenantSafety,
    SELF_REFERENCING_FIELDS,
} from '../../src/app-layer/services/tenant-safety';
import {
    EXPORT_FORMAT_VERSION,
    APP_IDENTIFIER,
    type ExportEnvelope,
    type ExportEntityRecord,
    type ExportEntityType,
    type ImportOptions,
} from '../../src/app-layer/services/export-schemas';

// ─── Fixtures ───────────────────────────────────────────────────────

function makeEnvelope(
    entities: ExportEnvelope['entities'] = {},
    relationships: ExportEnvelope['relationships'] = [],
    sourceTenantId = 'source-tenant',
): ExportEnvelope {
    return {
        formatVersion: EXPORT_FORMAT_VERSION,
        metadata: {
            tenantId: sourceTenantId,
            exportedAt: new Date().toISOString(),
            domains: ['CONTROLS'],
            app: APP_IDENTIFIER,
            appVersion: '1.0.0',
        },
        entities,
        relationships,
    };
}

function makeOptions(targetTenantId = 'target-tenant'): ImportOptions {
    return {
        targetTenantId,
        conflictStrategy: 'SKIP',
    };
}

function makeRecord(
    entityType: ExportEntityType,
    id: string,
    data: Record<string, unknown> = {},
): ExportEntityRecord {
    return {
        entityType,
        id,
        schemaVersion: '1.0',
        data: { tenantId: 'source-tenant', ...data },
    };
}

// ═════════════════════════════════════════════════════════════════════
// 1. Self-Reference Cycle Detection
// ═════════════════════════════════════════════════════════════════════

describe('Self-reference cycle detection', () => {
    test('no cycles in flat entity set', () => {
        const records = [
            makeRecord('control', 'c1'),
            makeRecord('control', 'c2'),
            makeRecord('control', 'c3'),
        ];
        const cycles = detectSelfReferenceCycles('control', records);
        expect(cycles).toEqual([]);
    });

    test('no cycles when no self-ref fields registered', () => {
        const records = [
            makeRecord('control', 'c1', { parentId: 'c2' }),
            makeRecord('control', 'c2', { parentId: 'c1' }),
        ];
        // control has no registered self-ref fields, so no detection
        const cycles = detectSelfReferenceCycles('control', records);
        expect(cycles).toEqual([]);
    });

    test('detects cycle when self-ref field is registered', () => {
        // Temporarily add a self-ref field for testing
        const original = SELF_REFERENCING_FIELDS.control;
        SELF_REFERENCING_FIELDS.control = ['parentId'];

        try {
            const records = [
                makeRecord('control', 'c1', { parentId: 'c2' }),
                makeRecord('control', 'c2', { parentId: 'c1' }),
            ];
            const cycles = detectSelfReferenceCycles('control', records);
            expect(cycles.length).toBeGreaterThanOrEqual(1);
        } finally {
            SELF_REFERENCING_FIELDS.control = original;
        }
    });

    test('no false positive for valid parent chain', () => {
        const original = SELF_REFERENCING_FIELDS.control;
        SELF_REFERENCING_FIELDS.control = ['parentId'];

        try {
            const records = [
                makeRecord('control', 'root', {}),           // root (no parent)
                makeRecord('control', 'child', { parentId: 'root' }),
                makeRecord('control', 'grandchild', { parentId: 'child' }),
            ];
            const cycles = detectSelfReferenceCycles('control', records);
            expect(cycles).toEqual([]);
        } finally {
            SELF_REFERENCING_FIELDS.control = original;
        }
    });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Topological Sort for Self-References
// ═════════════════════════════════════════════════════════════════════

describe('Topological sort for self-references', () => {
    test('returns records unchanged when no self-ref fields', () => {
        const records = [
            makeRecord('control', 'c1'),
            makeRecord('control', 'c2'),
        ];
        const sorted = topologicalSortSelfRefs('control', records);
        expect(sorted).toEqual(records);
    });

    test('orders parents before children', () => {
        const original = SELF_REFERENCING_FIELDS.control;
        SELF_REFERENCING_FIELDS.control = ['parentId'];

        try {
            const records = [
                makeRecord('control', 'child', { parentId: 'root' }),
                makeRecord('control', 'root', {}),
                makeRecord('control', 'grandchild', { parentId: 'child' }),
            ];
            const sorted = topologicalSortSelfRefs('control', records);
            const ids = sorted.map(r => r.id);

            expect(ids.indexOf('root')).toBeLessThan(ids.indexOf('child'));
            expect(ids.indexOf('child')).toBeLessThan(ids.indexOf('grandchild'));
        } finally {
            SELF_REFERENCING_FIELDS.control = original;
        }
    });

    test('throws on cycle', () => {
        const original = SELF_REFERENCING_FIELDS.control;
        SELF_REFERENCING_FIELDS.control = ['parentId'];

        try {
            const records = [
                makeRecord('control', 'c1', { parentId: 'c2' }),
                makeRecord('control', 'c2', { parentId: 'c1' }),
            ];
            expect(() => topologicalSortSelfRefs('control', records)).toThrow(/Cycle detected/);
        } finally {
            SELF_REFERENCING_FIELDS.control = original;
        }
    });

    test('handles multiple independent trees', () => {
        const original = SELF_REFERENCING_FIELDS.control;
        SELF_REFERENCING_FIELDS.control = ['parentId'];

        try {
            const records = [
                makeRecord('control', 'a-child', { parentId: 'a-root' }),
                makeRecord('control', 'b-child', { parentId: 'b-root' }),
                makeRecord('control', 'a-root', {}),
                makeRecord('control', 'b-root', {}),
            ];
            const sorted = topologicalSortSelfRefs('control', records);
            const ids = sorted.map(r => r.id);

            expect(ids.indexOf('a-root')).toBeLessThan(ids.indexOf('a-child'));
            expect(ids.indexOf('b-root')).toBeLessThan(ids.indexOf('b-child'));
        } finally {
            SELF_REFERENCING_FIELDS.control = original;
        }
    });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Cross-Tenant FK Rejection
// ═════════════════════════════════════════════════════════════════════

describe('Tenant safety: cross-tenant FK rejection', () => {
    test('clean bundle passes', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1')],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(true);
        expect(result.violations).toEqual([]);
    });

    test('entity with source tenantId is safe', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1', { tenantId: 'source-tenant' })],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(true);
    });

    test('entity with target tenantId is safe', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1', { tenantId: 'target-tenant' })],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(true);
    });

    test('entity with foreign tenantId is rejected', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1', { tenantId: 'evil-tenant' })],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(false);
        expect(result.violations.some(v => v.rule === 'NO_CROSS_TENANT_FK')).toBe(true);
        expect(result.violations[0].message).toContain('evil-tenant');
    });

    test('mixed tenantIds — one foreign — is rejected', () => {
        const envelope = makeEnvelope({
            control: [
                makeRecord('control', 'c1', { tenantId: 'source-tenant' }),
                makeRecord('control', 'c2', { tenantId: 'other-tenant' }),
            ],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(false);
        const crossTenantV = result.violations.find(v => v.rule === 'NO_CROSS_TENANT_FK');
        expect(crossTenantV?.entityId).toBe('c2');
    });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Duplicate ID Detection
// ═════════════════════════════════════════════════════════════════════

describe('Tenant safety: duplicate ID detection', () => {
    test('unique IDs pass', () => {
        const envelope = makeEnvelope({
            control: [
                makeRecord('control', 'c1'),
                makeRecord('control', 'c2'),
            ],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.violations.filter(v => v.rule === 'DUPLICATE_ID')).toEqual([]);
    });

    test('duplicate IDs within same type detected', () => {
        const envelope = makeEnvelope({
            control: [
                makeRecord('control', 'c1'),
                makeRecord('control', 'c1'), // duplicate
            ],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(false);
        expect(result.violations.some(v => v.rule === 'DUPLICATE_ID')).toBe(true);
    });

    test('same ID in different entity types is allowed', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'shared-id')],
            policy: [makeRecord('policy', 'shared-id')],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.violations.filter(v => v.rule === 'DUPLICATE_ID')).toEqual([]);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Bundle Integrity
// ═════════════════════════════════════════════════════════════════════

describe('Tenant safety: bundle integrity', () => {
    test('valid entities pass integrity check', () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1', { name: 'Valid' })],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.violations.filter(v => v.rule === 'BUNDLE_INTEGRITY')).toEqual([]);
    });

    test('entity with empty id is rejected', () => {
        const envelope = makeEnvelope({
            control: [{
                entityType: 'control',
                id: '',
                schemaVersion: '1.0',
                data: { name: 'Bad' },
            }],
        });
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.safe).toBe(false);
        expect(result.violations.some(v => v.rule === 'BUNDLE_INTEGRITY')).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Relationship Target Validation
// ═════════════════════════════════════════════════════════════════════

describe('Tenant safety: relationship targets', () => {
    test('valid relationship passes', () => {
        const envelope = makeEnvelope(
            {
                control: [makeRecord('control', 'c1')],
                controlTestPlan: [makeRecord('controlTestPlan', 'tp1')],
            },
            [{
                fromType: 'controlTestPlan',
                fromId: 'tp1',
                toType: 'control',
                toId: 'c1',
                relationship: 'BELONGS_TO',
            }],
        );
        const result = validateTenantSafety(envelope, makeOptions());
        expect(result.violations.filter(v => v.rule === 'MISSING_RELATIONSHIP_TARGET')).toEqual([]);
    });

    test('relationship referencing missing entity generates warning', () => {
        const envelope = makeEnvelope(
            {
                control: [makeRecord('control', 'c1')],
            },
            [{
                fromType: 'control',
                fromId: 'c1',
                toType: 'control',
                toId: 'c-missing',
                relationship: 'LINKED_TO',
            }],
        );
        const result = validateTenantSafety(envelope, makeOptions());
        const warnings = result.violations.filter(v => v.rule === 'MISSING_RELATIONSHIP_TARGET');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        // Warnings don't block import (they're severity WARNING)
        expect(result.safe).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 7. Import Service Integration — Unsafe Bundles Rejected
// ═════════════════════════════════════════════════════════════════════

jest.mock('@/lib/prisma', () => {
    const models = [
        'control', 'controlTestPlan', 'controlTestRun', 'controlRequirementLink',
        'policy', 'policyVersion', 'risk', 'evidence',
        'task', 'taskLink',
        'vendor', 'vendorAssessment', 'vendorRelationship',
        'framework', 'frameworkRequirement',
    ];
    const mockPrisma: Record<string, Record<string, unknown>> = {};
    for (const model of models) {
        mockPrisma[model] = {
            create: jest.fn().mockResolvedValue({ id: 'new' }),
            update: jest.fn().mockResolvedValue({ id: 'upd' }),
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        };
    }
    return { prisma: mockPrisma };
});

jest.mock('@/lib/observability/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
}));

import { importTenantData } from '../../src/app-layer/services/import-service';
import { readPrismaSchema } from '../helpers/prisma-schema';

describe('Import service: rejects unsafe bundles', () => {
    test('rejects bundle with cross-tenant references', async () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1', { tenantId: 'evil-tenant' })],
        });
        const result = await importTenantData(envelope, makeOptions());
        expect(result.success).toBe(false);
        expect(result.errors.some(e => e.message.includes('NO_CROSS_TENANT_FK'))).toBe(true);
    });

    test('rejects bundle with duplicate IDs', async () => {
        const envelope = makeEnvelope({
            control: [
                makeRecord('control', 'dup1'),
                makeRecord('control', 'dup1'),
            ],
        });
        const result = await importTenantData(envelope, makeOptions());
        expect(result.success).toBe(false);
        expect(result.errors.some(e => e.message.includes('DUPLICATE_ID'))).toBe(true);
    });

    test('accepts clean bundle', async () => {
        const envelope = makeEnvelope({
            control: [makeRecord('control', 'c1')],
        });
        const result = await importTenantData(envelope, {
            ...makeOptions(),
            dryRun: true,
        });
        expect(result.success).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════
// 8. Schema Guardrail: No Self-Referencing Models
// ═════════════════════════════════════════════════════════════════════

describe('GUARDRAIL: Prisma schema has no unregistered self-referencing models', () => {
    test('no model has a FK pointing to itself', () => {
        const schemaContent = readPrismaSchema();

        // Parse model blocks
        const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
        let match;
        const selfRefModels: string[] = [];

        while ((match = modelRegex.exec(schemaContent)) !== null) {
            const modelName = match[1];
            const body = match[2];

            // Find FK relations: fieldName ModelName @relation(...)
            // A self-ref is when a field references the same model
            const fieldRegex = /^\s+(\w+)\s+(\w+)\??\s+@relation.*fields:\s*\[(\w+)\]/gm;
            let fieldMatch;

            while ((fieldMatch = fieldRegex.exec(body)) !== null) {
                const referencedModel = fieldMatch[2];
                if (referencedModel === modelName) {
                    selfRefModels.push(`${modelName}.${fieldMatch[3]} → ${modelName}`);
                }
            }
        }

        if (selfRefModels.length > 0) {
            fail(
                `Self-referencing FK(s) detected in Prisma schema:\n` +
                selfRefModels.map(s => `  - ${s}`).join('\n') + '\n' +
                `Register these in SELF_REFERENCING_FIELDS (tenant-safety.ts) ` +
                `and add topological sort handling in the import service.`,
            );
        }
    });

    test('SELF_REFERENCING_FIELDS covers all exportable entity types', () => {
        const entityTypes: ExportEntityType[] = [
            'control', 'controlTestPlan', 'controlTestRun', 'controlMapping',
            'policy', 'policyVersion', 'risk', 'evidence',
            'task', 'taskLink',
            'vendor', 'vendorReview', 'vendorSubprocessor',
            'framework', 'frameworkRequirement',
        ];

        for (const type of entityTypes) {
            expect(SELF_REFERENCING_FIELDS).toHaveProperty(type);
            expect(Array.isArray(SELF_REFERENCING_FIELDS[type])).toBe(true);
        }
    });

    test('all registered self-ref fields are currently empty (no self-refs in schema)', () => {
        for (const [_type, fields] of Object.entries(SELF_REFERENCING_FIELDS)) {
            expect(fields).toEqual([]);
        }
    });
});
