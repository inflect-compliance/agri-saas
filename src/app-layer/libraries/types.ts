/**
 * Framework Library Runtime Types
 *
 * These types represent the "loaded" state of a library — post-parse, post-validate,
 * normalized for efficient runtime access. The key difference from StoredLibrary:
 *
 * StoredLibrary = flat YAML, parent_urn references, no indexes
 * LoadedLibrary = indexed maps, resolved parent/child trees, URN→node lookups
 *
 * Phase flow: YAML → StoredLibrary (validated) → LoadedLibrary (indexed)
 */
import type { FrameworkKind, MappingStrength, ScoreDefinition } from './schemas';

// ─── Loaded Requirement Node ─────────────────────────────────────────
// A fully resolved requirement node with computed parent/child references.

export interface LoadedRequirementNode {
    /** Globally unique URN */
    readonly urn: string;
    /** Reference ID from the standard (e.g., "A.5.1") */
    readonly refId: string;
    /** Human-readable name/title */
    readonly name?: string;
    /** Description of the requirement */
    readonly description?: string;
    /** Additional guidance or annotations */
    readonly annotation?: string;
    /** Depth in the hierarchy (1 = top-level) */
    readonly depth: number;
    /** Whether this is a directly assessable (leaf) node */
    readonly assessable: boolean;
    /** Thematic category */
    readonly category?: string;
    /** Section identifier */
    readonly section?: string;
    /** Comma-separated list of expected evidence/artifacts */
    readonly artifacts?: string;
    /** Ordered checklist items for implementing this requirement */
    readonly checklist?: readonly string[];
    /** URN of the parent node (resolved from parent_urn) */
    readonly parentUrn?: string;
    /** URNs of direct children (computed during loading) */
    readonly childUrns: readonly string[];
}

// ─── Loaded Framework ────────────────────────────────────────────────
// A fully indexed framework with O(1) URN lookups.

export interface LoadedFramework {
    /** Framework URN */
    readonly urn: string;
    /** Reference ID */
    readonly refId: string;
    /** Display name */
    readonly name: string;
    /** Description */
    readonly description?: string;
    /** Score range for assessments */
    readonly scoring?: {
        readonly min: number;
        readonly max: number;
        readonly definitions: readonly ScoreDefinition[];
    };
    /** Ordered flat list of all requirement nodes */
    readonly nodes: readonly LoadedRequirementNode[];
    /** O(1) URN → node lookup map */
    readonly nodesByUrn: ReadonlyMap<string, LoadedRequirementNode>;
    /** O(1) refId → node lookup map */
    readonly nodesByRefId: ReadonlyMap<string, LoadedRequirementNode>;
    /** Root-level nodes (depth=1, no parent) */
    readonly rootNodes: readonly LoadedRequirementNode[];
}

// ─── Loaded Library ──────────────────────────────────────────────────
// The top-level runtime representation of a parsed and validated library.

export interface LoadedLibrary {
    /** Library URN (globally unique identifier) */
    readonly urn: string;
    /** Locale (e.g., "en") */
    readonly locale: string;
    /** Reference ID */
    readonly refId: string;
    /** Display name */
    readonly name: string;
    /** Description */
    readonly description?: string;
    /** Copyright notice */
    readonly copyright?: string;
    /** Version (monotonically increasing integer) */
    readonly version: number;
    /** Publication date */
    readonly publicationDate?: string;
    /** Standards body that created this framework */
    readonly provider?: string;
    /** Organization that packaged this library file */
    readonly packager?: string;
    /** Framework kind for categorization */
    readonly kind: FrameworkKind;
    /** URNs of dependent libraries */
    readonly dependencies: readonly string[];
    /** The loaded framework with indexed lookups */
    readonly framework: LoadedFramework;
    /** Cross-framework mappings (if bundled) */
    readonly mappings: readonly LoadedMapping[];
    /**
     * Content hash for deduplication.
     * If two libraries produce the same hash, they are semantically identical.
     */
    readonly contentHash: string;
}

// ─── Loaded Mapping ──────────────────────────────────────────────────
// A resolved cross-framework requirement mapping.

export interface LoadedMapping {
    readonly sourceUrn: string;
    readonly targetUrn: string;
    readonly strength: MappingStrength;
    readonly rationale?: string;
}

// ─── Library Registry Entry ──────────────────────────────────────────
// Metadata about a library that has been registered (but not necessarily loaded).

export interface LibraryRegistryEntry {
    /** Library URN */
    readonly urn: string;
    /** Display name */
    readonly name: string;
    /** Version */
    readonly version: number;
    /** Framework kind */
    readonly kind: FrameworkKind;
    /** File path on disk */
    readonly filePath: string;
    /** Whether this library is currently loaded */
    loaded: boolean;
}
