/**
 * AI Risk Assessment — Privacy Sanitizer
 *
 * Strips or redacts fields that should NOT be sent to external AI models.
 * Only sends the minimum data necessary for risk assessment:
 *   ✅ Asset name, type, criticality
 *   ✅ Framework selection
 *   ✅ User-entered context
 *   ❌ No PII, secrets, raw DB IDs, or tenant-internal metadata
 *
 * This module documents exactly what is included in AI prompts.
 */
import type { RiskAssessmentInput, RiskAssessmentAsset } from './types';

// ─── Payload Field Documentation ───

/**
 * PROMPT PAYLOAD FIELDS (what we send to the AI model):
 *
 * INCLUDED (safe to send):
 *   - tenantIndustry           → General industry category (e.g., "Financial Services")
 *   - tenantContext            → User-entered description of the organization
 *   - frameworks[]             → Selected compliance frameworks (ISO27001, NIS2, SOC2)
 *   - assets[].name            → Asset display name
 *   - assets[].type            → Asset classification type (APPLICATION, INFRASTRUCTURE, etc.)
 *   - assets[].criticality     → Criticality level (HIGH/MEDIUM/LOW)
 *   - existingControls[]       → Control names/codes (never descriptions or internal notes)
 *   - maxRiskScale             → Tenant's risk rating scale (integer)
 *
 * EXCLUDED (never sent):
 *   - Tenant ID, slug, or internal identifiers
 *   - User IDs, emails, or personal information
 *   - Asset IDs (internal UUIDs)
 *   - Asset classification (may contain sensitive data categories)
 *   - CIA scores (confidentiality/integrity/availability — internal ratings)
 *   - Asset descriptions, notes, or metadata
 *   - Control descriptions, evidence, or implementation details
 *   - Database connection strings, API keys, or secrets
 *   - IP addresses, hostnames, or network configurations
 */

// ─── Sanitization Functions ───

/**
 * Sanitize a single asset for AI prompt consumption.
 * Strips internal IDs, CIA scores, and classification details.
 */
export function sanitizeAsset(asset: RiskAssessmentAsset): RiskAssessmentAsset {
    return {
        id: '',  // Strip internal ID — not needed by AI
        name: sanitizeString(asset.name, 200),
        type: asset.type,
        criticality: asset.criticality ?? null,
    };
}

/**
 * Sanitize the full provider input before sending to an external AI model.
 * Returns a new object with only the fields documented above as INCLUDED.
 */
export function sanitizeProviderInput(input: RiskAssessmentInput): RiskAssessmentInput {
    return {
        tenantIndustry: input.tenantIndustry ? sanitizeString(input.tenantIndustry, 200) : null,
        tenantContext: input.tenantContext ? sanitizeString(input.tenantContext, 2000) : null,
        frameworks: input.frameworks.map(fw => sanitizeString(fw, 50)),
        assets: input.assets.map(sanitizeAsset),
        existingControls: input.existingControls
            ? input.existingControls.map(c => sanitizeString(c, 200)).slice(0, 50)
            : [],
        maxRiskScale: input.maxRiskScale ?? 5,
    };
}

/**
 * Truncate and strip potentially dangerous content from strings.
 * Removes control characters, excessive whitespace, and truncates to maxLen.
 */
function sanitizeString(value: string, maxLen: number): string {
    return value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip control chars
        .replace(/\s+/g, ' ')                                // Normalize whitespace
        .trim()
        .substring(0, maxLen);
}

/**
 * Generate a human-readable summary of what data is being sent to the AI model.
 * Useful for audit logs and transparency.
 */
export function describePayload(input: RiskAssessmentInput): string {
    const parts: string[] = [];
    parts.push(`Frameworks: ${input.frameworks.join(', ') || 'none'}`);
    parts.push(`Assets: ${input.assets.length} (types: ${[...new Set(input.assets.map(a => a.type))].join(', ') || 'none'})`);
    if (input.tenantIndustry) parts.push(`Industry: ${input.tenantIndustry}`);
    if (input.tenantContext) parts.push(`Context: ${input.tenantContext.length} chars`);
    if (input.existingControls?.length) parts.push(`Existing controls: ${input.existingControls.length}`);
    return parts.join('; ');
}
