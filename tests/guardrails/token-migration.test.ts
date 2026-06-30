/**
 * Guardrail: token migration — representative pages
 *
 * Verifies that the four representative pages migrated in Epic 51 use
 * the new design system primitives (Button, StatusBadge, EmptyState)
 * and semantic token classes instead of raw Tailwind colors.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../src');

function read(...segments: string[]): string {
    return fs.readFileSync(path.join(SRC, ...segments), 'utf-8');
}

describe('Dashboard page token migration', () => {
    // Epic 69 split the dashboard into a thin server shell + a
    // client component that owns the card composition. The token /
    // imports / button-variant assertions check the combined surface
    // (page.tsx + DashboardClient.tsx) — what matters is that the
    // primitives are used somewhere in the dashboard tree, not which
    // side of the server/client boundary owns them.
    const src =
        read('app/t/[tenantSlug]/(app)/dashboard/page.tsx') +
        '\n' +
        read('app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx');

    it('UI-15: no longer imports buttonVariants (notif ghost link removed)', () => {
        expect(src).not.toContain("from '@/components/ui/button-variants'");
    });

    it('UI-15: no longer imports StatusBadge (notif badge removed)', () => {
        expect(src).not.toContain("from '@/components/ui/status-badge'");
    });

    it('uses an EmptyState pattern (component or inline) for the trends empty case', () => {
        // The dashboard is a server component; passing a Component
        // reference (`React.ElementType`) to the `<EmptyState>` client
        // component triggers the Next.js 15 "Functions cannot be
        // passed directly to Client Components" violation. The
        // dashboard's "no trends yet" branch was therefore inlined
        // (server-rendered icon JSX). Either shape satisfies the
        // empty-state contract — what matters is that the surface
        // exists and uses semantic tokens.
        const usesEmptyStateImport = src.includes(
            "from '@/components/ui/empty-state'",
        );
        const usesInlineEmptyState =
            /id=["']trend-section["'][\s\S]{0,800}text-content-emphasis/.test(src);
        expect(usesEmptyStateImport || usesInlineEmptyState).toBe(true);
    });

    it('uses semantic text tokens', () => {
        expect(src).toContain('text-content-emphasis');
        expect(src).toContain('text-content-muted');
        // `text-content-default` left with the Risk Distribution card when
        // that widget was removed; the surviving dashboard text still uses
        // semantic tokens (emphasis / muted / subtle), never raw slate.
        expect(src).toContain('text-content-subtle');
    });

    it('UI-15: the dashboard notifications-bell ghost link was removed', () => {
        // The 6 secondary Quick-Actions buttons were retired in v2-PR-11; the
        // notifications-bell ghost link was the last buttonVariants Link and is
        // removed in UI-15 (the top-bar bell is the canonical affordance). The
        // dashboard no longer imports buttonVariants.
        expect(src).not.toContain("buttonVariants({ variant: 'ghost'");
        expect(src).not.toContain("href={href('/notifications')}");
    });

    it('does not use legacy badge CSS classes', () => {
        expect(src).not.toMatch(/className="badge badge-/);
    });

    it('does not use legacy btn CSS classes', () => {
        expect(src).not.toMatch(/className="btn btn-/);
    });
});

describe('Vendors list page token migration', () => {
    const src = read('app/t/[tenantSlug]/(app)/vendors/VendorsClient.tsx');

    it('imports StatusBadge', () => {
        expect(src).toContain("from '@/components/ui/status-badge'");
    });

    it('imports EmptyState', () => {
        expect(src).toContain("from '@/components/ui/empty-state'");
    });

    it('imports buttonVariants', () => {
        expect(src).toContain("from '@/components/ui/button'");
    });

    it('uses semantic tokens for table styling', () => {
        expect(src).toContain('border-border-default');
        expect(src).toContain('text-content-muted');
        expect(src).toContain('hover:bg-bg-muted');
    });

    it('uses StatusBadge for status and criticality', () => {
        expect(src).toContain('<StatusBadge');
        expect(src).toContain('STATUS_VARIANT');
        expect(src).toContain('CRIT_VARIANT');
    });

    it('uses EmptyState for empty table', () => {
        expect(src).toContain('<EmptyState');
    });

    it('does not use legacy badge CSS classes', () => {
        expect(src).not.toMatch(/className=\{`badge \$/);
        expect(src).not.toMatch(/className="badge badge-/);
    });

    it('does not use legacy btn CSS classes', () => {
        expect(src).not.toMatch(/className="btn btn-/);
    });
});

describe('Risk detail page token migration', () => {
    const src = read('app/t/[tenantSlug]/(app)/risks/[riskId]/page.tsx');

    it('imports Button from the canonical path', () => {
        // The structural `buttonVariants` + `StatusBadge` import
        // assertions used to live here, but the quality-roadmap
        // unused-import sweep correctly removed those imports —
        // neither `buttonVariants` nor `<StatusBadge>` is referenced
        // anywhere in this file's source. Status badging on this
        // page now flows through `<MetaStrip kind: 'status'>`, which
        // renders `<StatusBadge>` INTERNALLY; the consumer doesn't
        // need the import. The "uses Button for ..." behavioural
        // assertion below is the meaningful guardrail.
        expect(src).toContain("from '@/components/ui/button'");
        expect(src).toContain('Button');
    });

    it('uses Button for save/cancel/edit actions', () => {
        // The edit Save/Cancel actions moved into the extracted
        // EditRiskModal (mirrors the control detail page). The modal
        // owns the primary Save + secondary Cancel; the page keeps the
        // Button primitive for its own Overview Edit trigger +
        // Applicability action.
        const modalSrc = read(
            'app/t/[tenantSlug]/(app)/risks/[riskId]/_modals/EditRiskModal.tsx',
        );
        expect(modalSrc).toContain('<Button');
        expect(modalSrc).toContain('variant="primary"');
        expect(modalSrc).toContain('variant="secondary"');
        expect(src).toContain('variant="secondary"');
    });

    it('uses StatusBadge for risk status and severity (via MetaStrip)', () => {
        // Elevation PR-1 — risk detail page migrated from inline
        // <StatusBadge> jumble in the meta slot to <MetaStrip
        // items=[...status-shaped...]>. The MetaStrip primitive
        // renders <StatusBadge> internally for `kind: 'status'`
        // items. Status semantics moved to the shared domain
        // mapping `RISK_STATUS_VARIANT` in
        // `@/app-layer/domain/entity-status-mapping`.
        expect(src).toMatch(/<MetaStrip|<StatusBadge/);
        expect(src).toMatch(/RISK_STATUS_VARIANT|STATUS_VARIANT/);
    });

    it('uses semantic tokens for text content', () => {
        expect(src).toContain('text-content-muted');
        expect(src).toContain('text-content-default');
        // The page-title's emphasis tone now flows through PR-3's
        // `<Heading>` primitive (which applies `text-content-emphasis`
        // by default) and PR-4b's `<EntityDetailLayout>` shell. We
        // assert those substitutes instead of the literal class.
        expect(src).toMatch(/Heading|EntityDetailLayout/);
        expect(src).toContain('text-content-error');
    });

    it('uses semantic tokens for borders', () => {
        expect(src).toContain('border-border-subtle');
    });

    it('does not use legacy btn CSS classes', () => {
        expect(src).not.toMatch(/className="btn btn-/);
    });

    it('does not use legacy badge CSS classes', () => {
        expect(src).not.toMatch(/className=\{`badge \$/);
        expect(src).not.toMatch(/className="badge badge-/);
    });
});

describe('Admin members page token migration', () => {
    const src = read('app/t/[tenantSlug]/(app)/admin/members/page.tsx');

    it('imports Button', () => {
        expect(src).toContain("from '@/components/ui/button'");
    });

    it('imports StatusBadge and statusBadgeVariants', () => {
        expect(src).toContain("from '@/components/ui/status-badge'");
        expect(src).toContain('statusBadgeVariants');
    });

    it('imports EmptyState', () => {
        expect(src).toContain("from '@/components/ui/empty-state'");
    });

    it('uses Button for primary actions', () => {
        expect(src).toContain('<Button');
        expect(src).toContain('variant="primary"');
    });

    it('uses StatusBadge for member status', () => {
        expect(src).toContain('<StatusBadge');
        expect(src).toContain('STATUS_VARIANT');
    });

    it('uses statusBadgeVariants for clickable role badges', () => {
        expect(src).toContain('statusBadgeVariants({');
    });

    it('uses InlineNotice for alerts (PR-10)', () => {
        // PR-10 migrated the hand-rolled error/success banner blocks
        // to the canonical <InlineNotice> primitive — the colour-pair
        // tokens (bg-bg-error / border-border-error / etc.) now live
        // inside src/components/ui/inline-notice.tsx, not in the page.
        expect(src).toContain('<InlineNotice');
        expect(src).toContain('variant="error"');
        expect(src).toContain('variant="success"');
        expect(src).toContain("from '@/components/ui/inline-notice'");
    });

    it('uses semantic tokens for dropdown menu', () => {
        expect(src).toContain('bg-bg-default');
        expect(src).toContain('border-border-default');
        expect(src).toContain('hover:bg-bg-muted');
        expect(src).toContain('hover:bg-bg-error');
    });

    it('uses EmptyState for empty table', () => {
        expect(src).toContain('<EmptyState');
    });

    it('does not use legacy btn CSS classes', () => {
        expect(src).not.toMatch(/className="btn btn-/);
    });

    it('does not use legacy badge CSS classes', () => {
        expect(src).not.toMatch(/className=\{`badge \$/);
        expect(src).not.toMatch(/className="badge badge-/);
    });
});
