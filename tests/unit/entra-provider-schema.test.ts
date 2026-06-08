/**
 * EI-1 — Entra provider config schema validation.
 */
import { EntraProviderConfigSchema, parseEntraConfig } from '@/app-layer/schemas/entra-provider.schemas';

const AAD = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

describe('EntraProviderConfigSchema', () => {
    it('accepts a minimal valid config + applies defaults', () => {
        const parsed = EntraProviderConfigSchema.parse({ aadTenantId: AAD, clientId: CLIENT });
        expect(parsed.groupClaimMode).toBe('securityGroup');
        expect(parsed.enforceGroupGate).toBe(false);
    });

    it('rejects non-uuid tenant / client ids', () => {
        expect(EntraProviderConfigSchema.safeParse({ aadTenantId: 'nope', clientId: CLIENT }).success).toBe(false);
        expect(EntraProviderConfigSchema.safeParse({ aadTenantId: AAD, clientId: 'nope' }).success).toBe(false);
    });

    it('honours groupClaimMode + enforceGroupGate + allowedDomains', () => {
        const parsed = EntraProviderConfigSchema.parse({
            aadTenantId: AAD,
            clientId: CLIENT,
            groupClaimMode: 'applicationRole',
            enforceGroupGate: true,
            allowedDomains: ['contoso.com'],
        });
        expect(parsed.groupClaimMode).toBe('applicationRole');
        expect(parsed.enforceGroupGate).toBe(true);
        expect(parsed.allowedDomains).toEqual(['contoso.com']);
    });

    it('parseEntraConfig returns null on garbage', () => {
        expect(parseEntraConfig({ foo: 'bar' })).toBeNull();
        expect(parseEntraConfig(null)).toBeNull();
    });
});
