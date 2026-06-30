/**
 * AI Risk Assessment — Zod Schemas
 *
 * Validates both API input and AI model output to ensure
 * structured, safe data flows through the system.
 */
import { z } from 'zod';

// ─── API Input Schema ───

export const RiskAssessmentAssetSchema = z.object({
    id: z.string(),
    name: z.string().min(1),
    type: z.string(),
    criticality: z.string().nullish(),
});

export const RiskAssessmentInputSchema = z.object({
    frameworks: z.array(z.string()).default([]),
    assetIds: z.array(z.string()).default([]),
    context: z.string().max(2000).optional(),
}).strip();

export type RiskAssessmentApiInput = z.output<typeof RiskAssessmentInputSchema>;

// ─── Confidence & Explainability Schemas ───

export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);

export const StructuredRationaleSchema = z.object({
    whyThisRisk: z.string().max(1000),
    affectedAssetCharacteristics: z.array(z.string().max(200)).max(10).default([]),
    suggestedControlThemes: z.array(z.string().max(200)).max(10).default([]),
});

// ─── AI Model Output Schema (validates structured JSON from LLM) ───

export const RiskSuggestionSchema = z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000),
    category: z.string().max(100).optional(),
    threat: z.string().max(500).optional(),
    vulnerability: z.string().max(1000).optional(),
    likelihood: z.number().int().min(1).max(5),
    impact: z.number().int().min(1).max(5),
    rationale: z.string().max(2000),
    suggestedControls: z.array(z.string().max(300)).max(10).default([]),
    relatedAssetName: z.string().max(300).optional(),
    confidence: ConfidenceLevelSchema.default('medium'),
    structuredRationale: StructuredRationaleSchema.default({
        whyThisRisk: '',
        affectedAssetCharacteristics: [],
        suggestedControlThemes: [],
    }),
    isFallback: z.boolean().optional(),
});

export const RiskSuggestionOutputSchema = z.object({
    suggestions: z.array(RiskSuggestionSchema).min(1).max(25),
});

export type ValidatedRiskSuggestionOutput = z.infer<typeof RiskSuggestionOutputSchema>;

// ─── Session Apply Schema ───

export const ApplySessionSchema = z.object({
    acceptedItemIds: z.array(z.string()).min(1),
}).strip();

export type ApplySessionInput = z.infer<typeof ApplySessionSchema>;

// ─── Session Dismiss Schema ───

export const DismissSessionSchema = z.object({
    reason: z.string().max(500).optional(),
}).strip();

export type DismissSessionInput = z.infer<typeof DismissSessionSchema>;
