/**
 * EI-1 ratchet — the Entra group-claim foundation must stay wired:
 * enum, JWT extraction (+ overage path), Graph helper, config schema, route.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

describe('EI-1 Entra group claims', () => {
    it('IdentityProviderType has ENTRA_ID', () => {
        expect(read('prisma/schema/enums.prisma')).toMatch(/ENTRA_ID/);
    });

    it('the jwt callback extracts aadGroups for microsoft-entra-id, delegating to the resolver', () => {
        const src = read('src/auth.ts');
        expect(src).toMatch(/account\.provider === 'microsoft-entra-id'/);
        expect(src).toMatch(/token\.aadGroups/);
        // The group-resolution decision was extracted to its own module (EI-4)
        // so it is unit-testable + carries the observability wiring.
        expect(src).toMatch(/resolveEntraGroupClaims/);
        // JWT augmentation carries the field
        expect(src).toMatch(/aadGroups\?: string\[\]/);
    });

    it('the resolver module owns the overage detection + Graph fetch fallback', () => {
        // Relocated from auth.ts (EI-4) — the overage path must stay wired.
        const resolver = read('src/lib/auth/entra-group-claims.ts');
        expect(resolver).toMatch(/_claim_names/);
        expect(resolver).toMatch(/fetchUserGroupsFromGraph/);
    });

    it('the Graph helper + config schema + provider route exist', () => {
        expect(exists('src/lib/auth/entra-graph.ts')).toBe(true);
        expect(read('src/lib/auth/entra-graph.ts')).toMatch(/@odata\.nextLink/);
        expect(exists('src/app-layer/schemas/entra-provider.schemas.ts')).toBe(true);
        expect(read('src/app-layer/schemas/entra-provider.schemas.ts')).toMatch(/enforceGroupGate/);
        expect(exists('src/app/t/[tenantSlug]/(app)/admin/entra/page.tsx')).toBe(true);
    });

    it('the provider route is admin-gated', () => {
        const route = read('src/app/api/t/[tenantSlug]/sso/entra/route.ts');
        expect(route).toMatch(/requirePermission\('admin\.manage'/);
    });
});
