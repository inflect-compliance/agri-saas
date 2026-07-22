/**
 * A custom role cannot grant more than the person creating it holds.
 *
 * #353 closed the OWNER-only special case. This closes the class it belonged
 * to. The shape of the problem: `admin.manage` gates custom-role CRUD, so
 * without a ceiling that single permission is effectively a grant of EVERY
 * permission in the system — an ADMIN mints a role carrying whatever they like
 * and assigns it to themselves.
 *
 * The ceiling is the GRANTOR's own effective permissions, deliberately not the
 * role's `baseRole`. Capping at the base role would forbid the legitimate case
 * custom roles exist for — giving an EDITOR-based role a report export the
 * ADMIN genuinely holds. Capping at the grantor forbids only escalation.
 *
 * The property test at the bottom is the one task #53 asked for: nothing an
 * ADMIN lacks can be granted by an ADMIN, for ANY key, not just the two that
 * were found by hand.
 */
import {
    permissionsExceeding,
    getPermissionsForRole,
    PERMISSION_SCHEMA,
    type PermissionSet,
} from '@/lib/permissions';

const ADMIN = getPermissionsForRole('ADMIN');
const OWNER = getPermissionsForRole('OWNER');
const EDITOR = getPermissionsForRole('EDITOR');
const READER = getPermissionsForRole('READER');

/** Clone a set with one key forced true. */
function withGrant(base: PermissionSet, domain: string, action: string): PermissionSet {
    const copy = JSON.parse(JSON.stringify(base)) as Record<string, Record<string, boolean>>;
    copy[domain][action] = true;
    return copy as unknown as PermissionSet;
}

describe('permissionsExceeding — the ceiling', () => {
    it('allows a blob identical to what the grantor holds', () => {
        expect(permissionsExceeding(ADMIN, ADMIN)).toEqual([]);
    });

    it('allows a blob that grants strictly less', () => {
        // Handing out a weaker role is the normal case.
        expect(permissionsExceeding(READER, ADMIN)).toEqual([]);
        expect(permissionsExceeding(EDITOR, ADMIN)).toEqual([]);
    });

    it('allows tailoring UP TO the grantor — the case a base-role cap would break', () => {
        // An EDITOR-based role gaining a report export the ADMIN holds is the
        // entire point of custom roles, and must keep working.
        const tailored = withGrant(EDITOR, 'reports', 'export');
        expect(ADMIN.reports.export).toBe(true);
        expect(permissionsExceeding(tailored, ADMIN)).toEqual([]);
    });

    it('reports a grant the grantor lacks', () => {
        const over = permissionsExceeding(withGrant(ADMIN, 'admin', 'tenant_lifecycle'), ADMIN);
        expect(over).toEqual(['admin.tenant_lifecycle']);
    });

    it('reports every offending key, not just the first', () => {
        let blob = withGrant(ADMIN, 'admin', 'tenant_lifecycle');
        blob = withGrant(blob, 'admin', 'owner_management');
        expect(permissionsExceeding(blob, ADMIN).sort()).toEqual([
            'admin.owner_management',
            'admin.tenant_lifecycle',
        ]);
    });

    it('ignores REVOCATIONS — subtracting is always allowed', () => {
        // A blob that sets something false the grantor holds is not escalation.
        const reduced = JSON.parse(JSON.stringify(ADMIN)) as Record<string, Record<string, boolean>>;
        reduced.admin.scim = false;
        expect(permissionsExceeding(reduced, ADMIN)).toEqual([]);
    });

    it('treats a non-object blob as granting nothing', () => {
        for (const junk of [null, undefined, 'x', 42, []]) {
            expect(permissionsExceeding(junk, READER)).toEqual([]);
        }
    });

    it('an OWNER may grant the OWNER-only keys — the ceiling is the grantor', () => {
        // Note the separate #353 guard still stops these reaching a custom role
        // at all; this asserts the CEILING itself is grantor-relative, not that
        // the OWNER-only keys are grantable.
        expect(permissionsExceeding(withGrant(ADMIN, 'admin', 'tenant_lifecycle'), OWNER)).toEqual(
            [],
        );
    });
});

/**
 * Task #53 — the general property, swept rather than hand-picked.
 *
 * Before this existed, `admin-permissions.test.ts` pinned only the STATIC
 * `getPermissionsForRole` path, so it passed happily while an ADMIN held an
 * escalated key through a custom role.
 */
describe('property — no role can grant a key it does not hold', () => {
    const ROLES: Array<[string, PermissionSet]> = [
        ['ADMIN', ADMIN],
        ['EDITOR', EDITOR],
        ['READER', READER],
    ];

    for (const [roleName, grantor] of ROLES) {
        it(`${roleName} cannot grant any key it lacks (all ${Object.keys(PERMISSION_SCHEMA).length} domains)`, () => {
            const escapes: string[] = [];

            for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
                for (const action of PERMISSION_SCHEMA[domain]) {
                    const held = (grantor[domain] as unknown as Record<string, boolean>)[action];
                    if (held === true) continue; // holding it, so granting is fine

                    const blob = withGrant(grantor, domain as string, action);
                    const over = permissionsExceeding(blob, grantor);
                    if (!over.includes(`${domain}.${action}`)) {
                        escapes.push(`${roleName} → ${domain}.${action}`);
                    }
                }
            }

            expect(escapes).toEqual([]);
        });
    }

    it('every key a role DOES hold stays grantable — the ceiling is not a blanket ban', () => {
        const wronglyBlocked: string[] = [];

        for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
            for (const action of PERMISSION_SCHEMA[domain]) {
                if ((ADMIN[domain] as unknown as Record<string, boolean>)[action] !== true) continue;
                const blob = withGrant(READER, domain as string, action);
                if (permissionsExceeding(blob, ADMIN).length > 0) {
                    wronglyBlocked.push(`${domain}.${action}`);
                }
            }
        }

        expect(wronglyBlocked).toEqual([]);
    });
});
