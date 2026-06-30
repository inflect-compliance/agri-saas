/**
 * AI Risk Assessment — Prompt Builder (Enhanced)
 *
 * Constructs system + user prompts for the AI model.
 * Framework-aware (ISO27001 Annex A, NIS2 resilience, SOC2 TSC),
 * asset-type-aware (enriched with knowledge base context), and
 * structured to request confidence/explainability in output.
 */
import type { RiskAssessmentInput } from './types';
import { getAssetTypeProfile, getFrameworkGuidance } from './knowledge-base';

export interface PromptPair {
    system: string;
    user: string;
    responseSchema: string;
}

/**
 * Build a structured prompt pair for risk suggestion generation.
 */
export function buildRiskAssessmentPrompt(input: RiskAssessmentInput): PromptPair {
    const maxScale = input.maxRiskScale ?? 5;
    const fwGuidance = getFrameworkGuidance(input.frameworks);

    // ─── System Prompt ───
    const systemParts = [
        'You are an expert GRC (Governance, Risk, Compliance) analyst specializing in information security risk assessment.',
        'Your task is to identify specific, actionable risks for an organization based on their assets, frameworks, and context.',
        '',
        '## Output Requirements',
        `- Use the risk scale 1-${maxScale} where 1=Very Low and ${maxScale}=Very High.`,
        '- Provide confidence level (high/medium/low) indicating how applicable the suggestion is to the specific context provided.',
        '- Include structured rationale with: whyThisRisk, affectedAssetCharacteristics (array), suggestedControlThemes (array).',
        '- Output ONLY valid JSON matching the schema provided. No markdown, commentary, or explanation outside JSON.',
        '',
        '## Quality Rules',
        '- Focus on SPECIFIC risks that a GRC team would recognize and act on. Avoid generic platitudes.',
        '- Each risk must have a distinct threat scenario — do not repeat the same risk with different wording.',
        '- Base likelihood on actual threat landscape data, not worst-case assumptions.',
        '- Suggested controls should be concrete and implementable, not abstract principles.',
        '- Mark confidence as "high" only when the risk clearly matches the provided asset type and context.',
    ];

    // Add framework-specific guidance to system prompt
    if (fwGuidance.length > 0) {
        systemParts.push('');
        systemParts.push('## Framework-Specific Guidance');
        for (const fw of fwGuidance) {
            systemParts.push(`### ${fw.name}`);
            systemParts.push(fw.riskBias);
            systemParts.push(`Focus areas: ${fw.focusAreas.slice(0, 6).join('; ')}`);
            systemParts.push(`Avoid: ${fw.avoidAreas.join('; ')}`);
        }
    }

    const system = systemParts.join('\n');

    // ─── User Prompt ───
    const parts: string[] = [];

    // Industry context
    if (input.tenantIndustry) {
        parts.push(`Industry: ${input.tenantIndustry}`);
    }
    if (input.tenantContext) {
        parts.push(`Organization context: ${input.tenantContext}`);
    }

    // Frameworks
    if (input.frameworks.length > 0) {
        parts.push(`Compliance frameworks: ${input.frameworks.join(', ')}`);
    }

    // Assets with enriched type context
    if (input.assets.length > 0) {
        const assetLines: string[] = [];
        for (const asset of input.assets) {
            const profile = getAssetTypeProfile(asset.type);
            const attrs = [asset.type];
            if (asset.criticality) attrs.push(`criticality: ${asset.criticality}`);

            assetLines.push(`  - ${asset.name} (${attrs.join(', ')})`);
            // Add 2-3 type-specific risk categories as context
            assetLines.push(`    Relevant risk categories: ${profile.riskCategories.slice(0, 3).join(', ')}`);
        }
        parts.push(`Assets to assess:\n${assetLines.join('\n')}`);
    }

    // Existing controls (to avoid duplication)
    if (input.existingControls && input.existingControls.length > 0) {
        const controlList = input.existingControls.slice(0, 50).join(', ');
        parts.push(`Already-installed controls (avoid suggesting risks these fully mitigate): ${controlList}`);
    }

    parts.push('Generate 5-15 specific, actionable risk suggestions for this organization. Each must be distinct.');

    const user = parts.join('\n\n');

    // ─── Response Schema ───
    const responseSchema = JSON.stringify({
        type: 'object',
        properties: {
            suggestions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        description: { type: 'string' },
                        category: { type: 'string' },
                        threat: { type: 'string' },
                        vulnerability: { type: 'string' },
                        likelihood: { type: 'integer', minimum: 1, maximum: maxScale },
                        impact: { type: 'integer', minimum: 1, maximum: maxScale },
                        rationale: { type: 'string' },
                        suggestedControls: { type: 'array', items: { type: 'string' } },
                        relatedAssetName: { type: 'string' },
                        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                        structuredRationale: {
                            type: 'object',
                            properties: {
                                whyThisRisk: { type: 'string' },
                                affectedAssetCharacteristics: { type: 'array', items: { type: 'string' } },
                                suggestedControlThemes: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['whyThisRisk'],
                        },
                    },
                    required: ['title', 'description', 'likelihood', 'impact', 'rationale', 'confidence', 'structuredRationale'],
                },
            },
        },
        required: ['suggestions'],
    }, null, 2);

    return { system, user, responseSchema };
}
