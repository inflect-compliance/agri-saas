/** @jest-environment jsdom */

/**
 * Behavioural (Tier-2) test — `<DataTable>` row hover affordance.
 *
 * From `docs/roadmap-audit-2026-05-13.md` "Known broken / risky
 * areas" item #7: the v2-PR-12 (#204) row-hover claim — chevron-right
 * + brand left-edge on hover. R13-PR13 (#374) specifically had to FIX
 * this leaking onto the wrong cells: the brand-edge accent was gated
 * on a `first-of-type:` selector that matched the SELECT column once
 * selection went default-on, so the accent "never fired anywhere".
 *
 * The structural ratchet checks the class strings exist in
 * `table.tsx`. It CANNOT check which rendered `<td>` carries the
 * accent, or that the chevron column only mounts when `onRowClick`
 * is wired. Those are exactly the things #374 got wrong. This test
 * renders the table and asserts the RENDERED CELL the accent lands
 * on — the behavioural outcome.
 *
 * The accent itself is applied via `group-hover/row:` — a hover
 * pseudo-class jsdom cannot trigger. So the assertion is: the
 * hover-accent class is present ON THE CORRECT CELL and ABSENT from
 * the wrong cells. That is the regression class #374 fixed: not
 * "is the class somewhere" but "is it on the right element".
 */

import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { DataTable, createColumns } from '@/components/ui/table';

// next/navigation — DataTable's filter wiring touches it transitively.
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/t/acme/things',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

interface ThingRow {
    id: string;
    code: string;
    name: string;
}

const rows: ThingRow[] = [
    { id: 'r0', code: 'C-001', name: 'Alpha' },
    { id: 'r1', code: 'C-002', name: 'Beta' },
    { id: 'r2', code: 'C-003', name: 'Gamma' },
];

const columns = createColumns<ThingRow>([
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'name', header: 'Name' },
]);

/** The brand 2-px inset left-edge accent (hover variant). */
const HOVER_EDGE = 'group-hover/row:shadow-[inset_2px_0_0_var(--brand-default)]';
/** Solid-surface hover paint applied to clickable cells. */
const HOVER_SURFACE = 'group-hover/row:bg-bg-muted';

describe('<DataTable> row hover — behavioural (Tier 2)', () => {
    it('a clickable row applies the brand-edge accent to its TRUE leftmost cell (the select cell)', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={() => undefined}
            />,
        );
        const bodyRows = container.querySelectorAll('tbody tr');
        expect(bodyRows.length).toBe(3);

        const firstRow = bodyRows[0];
        const cells = firstRow.querySelectorAll('td');
        // Selection is default-on, so cell[0] is the select column.
        // #374's bug: the accent skipped the select column and so
        // never rendered. The 2026-05-19 fix put it on the row's TRUE
        // leftmost cell — the select cell when selection is mounted.
        const selectCell = cells[0];
        expect(selectCell.className).toContain(HOVER_EDGE);
    });

    it('the brand-edge accent does NOT leak onto every cell', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={() => undefined}
            />,
        );
        const cells = container.querySelectorAll('tbody tr:first-child td');
        // Exactly ONE cell carries the edge accent. If the accent
        // leaked (the pre-#374 risk in the other direction), more
        // than one cell would carry it and the row would render a
        // brand stripe per column.
        const withEdge = Array.from(cells).filter((c) =>
            c.className.includes(HOVER_EDGE),
        );
        expect(withEdge.length).toBe(1);
    });

    it('a clickable row paints the hover surface on its content cells', () => {
        render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={() => undefined}
            />,
        );
        // The "Code" content cell carries the solid hover surface so
        // hovering anywhere on the row paints the whole row.
        const codeCell = screen.getByText('C-001').closest('td');
        expect(codeCell).not.toBeNull();
        expect(codeCell!.className).toContain(HOVER_SURFACE);
    });

    it('a NON-clickable table (no onRowClick) renders no hover accent at all', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                // no onRowClick
            />,
        );
        const cells = container.querySelectorAll('tbody td');
        // No cell should carry the hover accent or the hover surface
        // when the table rows aren't clickable — the affordance must
        // be gated on `onRowClick`.
        for (const cell of Array.from(cells)) {
            expect(cell.className).not.toContain(HOVER_EDGE);
            expect(cell.className).not.toContain(HOVER_SURFACE);
        }
    });

    it('the clickable row owns the `group/row` hook the cell accents depend on', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={() => undefined}
            />,
        );
        const firstRow = container.querySelector('tbody tr');
        expect(firstRow).not.toBeNull();
        // The cell accents use `group-hover/row:` — they are inert
        // unless an ancestor declares the named `group/row`. #374's
        // diagnosis was a wiring break of exactly this kind; assert
        // the row declares the group so the accents can fire.
        expect(firstRow!.className).toContain('group/row');
        // And the row is keyboard/cursor clickable.
        expect(firstRow!.className).toContain('cursor-pointer');
    });

    it('a clickable table renders the trailing chevron affordance column', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={() => undefined}
            />,
        );
        // v2-PR-12: the chevron column mounts ONLY when onRowClick is
        // wired. Each clickable row gets a trailing chevron cell whose
        // icon fades in on `group-hover/row`.
        const fadeChevrons = container.querySelectorAll(
            '.group-hover\\/row\\:opacity-60',
        );
        // One chevron cell per row.
        expect(fadeChevrons.length).toBe(rows.length);
        // The chevron cell is decorative — aria-hidden.
        expect(fadeChevrons[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('a NON-clickable table does NOT render the chevron column', () => {
        const { container } = render(
            <DataTable<ThingRow>
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
            />,
        );
        // With no onRowClick, the chevron column must not exist —
        // its cells carry the fade-in opacity class.
        const fadeChevrons = container.querySelectorAll(
            '.group-hover\\/row\\:opacity-60',
        );
        expect(fadeChevrons.length).toBe(0);
    });
});
