/**
 * AI Risk Assessment — Types & Interfaces
 *
 * Provider abstraction so the AI backend can be swapped
 * (stub for dev/test, OpenRouter/OpenAI for production).
 */

// ─── Confidence Level ───

/** How confident the AI/system is in this suggestion */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── Structured Rationale ───

export interface StructuredRationale {
    /** Why this risk matters for the organization */
    whyThisRisk: string;
    /** Asset characteristics that make this risk relevant */
    affectedAssetCharacteristics: string[];
    /** High-level control themes that would mitigate this risk */
    suggestedControlThemes: string[];
}

// ─── Provider Input ───

export interface RiskAssessmentAsset {
    id: string;
    name: string;
    type: string;
    criticality?: string | null;
}

export interface RiskAssessmentInput {
    /** Tenant profile context */
    tenantIndustry?: string | null;
    tenantContext?: string | null;

    /** Frameworks selected by the tenant */
    frameworks: string[];

    /** Assets to assess */
    assets: RiskAssessmentAsset[];

    /** Existing controls already installed (names/codes) — to avoid suggesting already-mitigated risks */
    existingControls?: string[];

    /** Max risk scale for this tenant (default 5) */
    maxRiskScale?: number;
}

// ─── Provider Output ───

export interface RiskSuggestion {
    title: string;
    description: string;
    category?: string;
    threat?: string;
    vulnerability?: string;
    likelihood: number;
    impact: number;
    rationale: string;
    suggestedControls: string[];
    /** Asset name this risk relates to (if specific) */
    relatedAssetName?: string;

    /** Confidence level: how applicable this suggestion is to the specific context */
    confidence: ConfidenceLevel;
    /** Structured explainability fields */
    structuredRationale: StructuredRationale;
    /** Whether this came from fallback/template mode vs. AI generation */
    isFallback?: boolean;
}

export interface RiskSuggestionOutput {
    suggestions: RiskSuggestion[];
    modelName: string;
    provider: string;
    /** True if output was generated from fallback templates (AI unavailable or not configured) */
    isFallback?: boolean;
}

// ─── Provider Interface ───

export interface RiskSuggestionProvider {
    readonly providerName: string;
    generateSuggestions(input: RiskAssessmentInput): Promise<RiskSuggestionOutput>;
}
