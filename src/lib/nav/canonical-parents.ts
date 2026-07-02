/**
 * Smart-nav — canonical parent resolver (ported from IC RQ4-4).
 *
 * Maps each subpage to the page the back affordance should fall back to
 * when no in-tab referrer is available (cold load, fresh tab, deep link).
 *
 * Convention: the canonical parent is the route one structural step up in
 * the information architecture — NOT necessarily the URL parent. A nested
 * subpage like `/vendors/[vendorId]/assessment/[assessmentId]` falls back
 * to `/vendors/[vendorId]` (its parent entity), not `/vendors`.
 *
 * Patterns are written in the `[param]` form; `normalizePathname` maps a
 * runtime pathname to a pattern before lookup, and `expandDynamicSegments`
 * carries concrete segment values from the child into the parent href.
 */
import { normalizePathname } from './page-segregation';

export interface CanonicalParent {
    /** Pattern relative to `/t/[tenantSlug]` — joined at render time. */
    href: string;
    /** Trailing portion of the affordance label: "← <label>". */
    label: string;
}

const PARENT_MAP: Record<string, CanonicalParent> = {
    // ── Farm ──────────────────────────────────────────────────────────
    '/assets/[id]': { href: '/assets', label: 'Assets' },
    '/assets/new': { href: '/assets', label: 'Assets' },
    '/locations/[locationId]': { href: '/locations', label: 'Locations' },
    '/journal/[id]': { href: '/journal', label: 'Journal' },
    '/knowledge/[id]': { href: '/knowledge', label: 'Knowledge' },
    '/planning/[cropPlanId]': { href: '/planning', label: 'Planning' },
    '/planning/seasons': { href: '/planning', label: 'Planning' },
    // Field-operator view + task detail both hang off the Farm Tasks list.
    '/field/[taskId]': { href: '/farm-tasks', label: 'Farm Tasks' },
    '/tasks/[taskId]': { href: '/farm-tasks', label: 'Farm Tasks' },
    '/tasks/dashboard': { href: '/farm-tasks', label: 'Farm Tasks' },
    '/tasks/new': { href: '/farm-tasks', label: 'Farm Tasks' },

    // ── Access reviews ────────────────────────────────────────────────
    '/access-reviews/[reviewId]': { href: '/access-reviews', label: 'Access reviews' },

    // ── Admin subpages ────────────────────────────────────────────────
    '/admin/api-keys': { href: '/admin', label: 'Admin' },
    '/admin/audit-log': { href: '/admin', label: 'Admin' },
    '/admin/billing': { href: '/admin', label: 'Admin' },
    '/admin/entra': { href: '/admin', label: 'Admin' },
    '/admin/integrations': { href: '/admin', label: 'Admin' },
    '/admin/integrations/sharepoint-health': { href: '/admin/integrations', label: 'Integrations' },
    '/admin/ledger-integrity': { href: '/admin', label: 'Admin' },
    '/admin/members': { href: '/admin', label: 'Admin' },
    '/admin/modules': { href: '/admin', label: 'Admin' },
    '/admin/notifications': { href: '/admin', label: 'Admin' },
    '/admin/rbac': { href: '/admin', label: 'Admin' },
    '/admin/risk-appetite': { href: '/admin', label: 'Admin' },
    '/admin/roles': { href: '/admin', label: 'Admin' },
    '/admin/scim': { href: '/admin', label: 'Admin' },
    '/admin/security': { href: '/admin', label: 'Admin' },
    '/admin/sso': { href: '/admin', label: 'Admin' },
    '/admin/vendor-assessment-reviews/[assessmentId]': { href: '/admin', label: 'Admin' },
    '/admin/vendor-templates': { href: '/admin', label: 'Admin' },
    '/admin/vendor-templates/[templateId]': { href: '/admin/vendor-templates', label: 'Vendor templates' },

    // ── Audits ────────────────────────────────────────────────────────
    '/audits/auditor': { href: '/audits', label: 'Audits' },
    '/audits/cycles': { href: '/audits', label: 'Audits' },
    '/audits/cycles/[cycleId]': { href: '/audits/cycles', label: 'Audit cycles' },
    '/audits/cycles/[cycleId]/readiness': { href: '/audits/cycles/[cycleId]', label: 'Audit cycle' },
    '/audits/new': { href: '/audits', label: 'Audits' },
    '/audits/packs/[packId]': { href: '/audits', label: 'Audits' },
    '/audits/readiness': { href: '/audits', label: 'Audits' },

    // ── Controls ──────────────────────────────────────────────────────
    '/controls/[controlId]': { href: '/controls', label: 'Controls' },
    // Test-plan detail lives URL-wise under a control, but the mental
    // model is "I'm working on a test"; canonical parent is the Tests list
    // (the in-tab referrer still wins when drilling in from a control).
    '/controls/[controlId]/tests/[planId]': { href: '/tests', label: 'Tests' },
    '/controls/dashboard': { href: '/controls', label: 'Controls' },
    '/controls/new': { href: '/controls', label: 'Controls' },
    '/controls/sankey': { href: '/controls', label: 'Controls' },
    '/controls/templates': { href: '/controls', label: 'Controls' },

    // ── Frameworks ────────────────────────────────────────────────────
    '/frameworks/[frameworkKey]': { href: '/frameworks', label: 'Frameworks' },
    '/frameworks/[frameworkKey]/diff': { href: '/frameworks/[frameworkKey]', label: 'Framework' },
    '/frameworks/[frameworkKey]/install': { href: '/frameworks/[frameworkKey]', label: 'Framework' },
    '/frameworks/[frameworkKey]/templates': { href: '/frameworks/[frameworkKey]', label: 'Framework' },

    // ── Issues (legacy) ───────────────────────────────────────────────
    '/issues/[issueId]': { href: '/issues', label: 'Issues' },
    '/issues/dashboard': { href: '/issues', label: 'Issues' },
    '/issues/new': { href: '/issues', label: 'Issues' },

    // ── Policies ──────────────────────────────────────────────────────
    '/policies/[policyId]': { href: '/policies', label: 'Policies' },
    '/policies/new': { href: '/policies', label: 'Policies' },
    '/policies/templates': { href: '/policies', label: 'Policies' },

    // ── Processes ─────────────────────────────────────────────────────
    '/processes/governance': { href: '/processes', label: 'Processes' },

    // ── Reports ───────────────────────────────────────────────────────
    '/reports/soa': { href: '/reports', label: 'Reports' },
    '/reports/soa/print': { href: '/reports/soa', label: 'SoA' },

    // ── Risks ─────────────────────────────────────────────────────────
    '/risks/[riskId]': { href: '/risks', label: 'Risks' },
    '/risks/ai': { href: '/risks', label: 'Risks' },
    '/risks/board': { href: '/risks', label: 'Risks' },
    '/risks/correlations': { href: '/risks', label: 'Risks' },
    '/risks/dashboard': { href: '/risks', label: 'Risks' },
    '/risks/hierarchy': { href: '/risks', label: 'Risks' },
    '/risks/import': { href: '/risks', label: 'Risks' },
    '/risks/kri': { href: '/risks', label: 'Risks' },
    '/risks/loss-events': { href: '/risks', label: 'Risks' },
    '/risks/new': { href: '/risks', label: 'Risks' },
    '/risks/reports': { href: '/risks', label: 'Risks' },
    '/risks/scenarios': { href: '/risks', label: 'Risks' },

    // ── Tests ─────────────────────────────────────────────────────────
    '/tests/dashboard': { href: '/tests', label: 'Tests' },
    '/tests/due': { href: '/tests', label: 'Tests' },
    '/tests/runs/[runId]': { href: '/tests', label: 'Tests' },

    // ── Vendors ───────────────────────────────────────────────────────
    '/vendors/[vendorId]': { href: '/vendors', label: 'Vendors' },
    '/vendors/[vendorId]/assessment/[assessmentId]': { href: '/vendors/[vendorId]', label: 'Vendor' },
    '/vendors/dashboard': { href: '/vendors', label: 'Vendors' },
    '/vendors/new': { href: '/vendors', label: 'Vendors' },
};

/**
 * Resolve the canonical parent for a runtime pathname. Returns `null` for
 * a route that is not a known subpage (main pages and unknown routes).
 *
 * `tenantSlug` expands `/t/[tenantSlug]` into the returned href. Dynamic-
 * segment values in the child's pattern are inherited into the parent href
 * when the parent references the SAME segment — so
 * `/t/acme/vendors/v1/assessment/a1` → `/t/acme/vendors/v1`.
 */
export function resolveCanonicalParent(
    pathname: string,
    tenantSlug: string,
): CanonicalParent | null {
    const pattern = normalizePathname(pathname);
    if (!pattern) return null;
    const parent = PARENT_MAP[pattern];
    if (!parent) return null;

    const expandedHref = expandDynamicSegments(parent.href, pattern, pathname);
    return {
        href: `/t/${tenantSlug}${expandedHref}`,
        label: parent.label,
    };
}

/**
 * Substitute `[param]` placeholders in the parent's href with concrete
 * values from the child's pathname. Only segments that appear in BOTH the
 * child pattern and the parent href are substituted.
 */
function expandDynamicSegments(
    parentHref: string,
    childPattern: string,
    childPathname: string,
): string {
    const childPath = childPathname.replace(/^\/t\/[^/]+/, '');
    const childPatSegs = childPattern.split('/').filter(Boolean);
    const childPathSegs = childPath.split('/').filter(Boolean);
    const dynamicValues = new Map<string, string>();
    for (let i = 0; i < childPatSegs.length; i++) {
        const seg = childPatSegs[i];
        if (seg.startsWith('[') && seg.endsWith(']') && childPathSegs[i]) {
            dynamicValues.set(seg, childPathSegs[i]);
        }
    }
    return parentHref
        .split('/')
        .map((seg) => dynamicValues.get(seg) ?? seg)
        .join('/');
}

export const CANONICAL_PARENT_MAP_INTERNAL = PARENT_MAP;
