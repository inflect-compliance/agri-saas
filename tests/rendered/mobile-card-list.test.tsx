/**
 * @jest-environment jsdom
 *
 * DataTable `mobileFallback="card"` — the phone (<sm) fallback.
 *
 * jsdom ignores CSS, so BOTH the `sm:hidden` card list AND the
 * `hidden sm:contents` table render into the DOM; queries are scoped to
 * the `mobile-card-list` testid to read the card branch unambiguously.
 *
 * Proves:
 *   1. Each row renders as a card built from `column.meta.mobileCard`
 *      slots (title / status / meta), reusing the column cell renderers.
 *   2. Columns without `mobileCard` meta (actions) are omitted.
 *   3. Tapping a card taps through via `onRowClick`.
 *   4. Default (scroll) mode renders NO card list.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataTable, createColumns } from '@/components/ui/table';

interface TaskRow {
    id: string;
    name: string;
    status: string;
    due: string;
}

const DATA: TaskRow[] = [
    { id: 't1', name: 'Spray North 40', status: 'OPEN', due: '2026-07-01' },
    { id: 't2', name: 'Scout East', status: 'DONE', due: '2026-07-03' },
];

const columns = createColumns<TaskRow>([
    {
        accessorKey: 'name',
        header: 'Task',
        cell: ({ row }) => <span>{row.original.name}</span>,
        meta: { mobileCard: { slot: 'title' } },
    },
    {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <span data-testid="status-pill">{row.original.status}</span>,
        meta: { mobileCard: { slot: 'status' } },
    },
    {
        accessorKey: 'due',
        header: 'Due',
        cell: ({ row }) => <span>{row.original.due}</span>,
        meta: { mobileCard: { slot: 'meta', label: 'Due date' } },
    },
    {
        id: 'actions',
        header: '',
        cell: () => <button type="button">⋯</button>, // no mobileCard meta → excluded
    },
]);

describe('DataTable mobileFallback="card"', () => {
    it('renders each row as a card from column meta, excluding untagged columns', () => {
        render(
            <DataTable<TaskRow>
                data={DATA}
                columns={columns}
                getRowId={(r) => r.id}
                selectionEnabled={false}
                mobileFallback="card"
            />,
        );

        const list = screen.getByTestId('mobile-card-list');
        const cards = within(list).getAllByTestId('mobile-card');
        expect(cards).toHaveLength(2);

        // Card 1: title + status pill + meta label/value, reusing cell renderers.
        const first = within(cards[0]);
        expect(first.getByText('Spray North 40')).toBeInTheDocument();
        expect(first.getByTestId('status-pill')).toHaveTextContent('OPEN');
        expect(first.getByText('Due date')).toBeInTheDocument();
        expect(first.getByText('2026-07-01')).toBeInTheDocument();

        // The actions column (no mobileCard meta) is NOT in the card.
        expect(within(list).queryByText('⋯')).not.toBeInTheDocument();
    });

    it('taps through to detail via onRowClick', () => {
        const onRowClick = jest.fn();
        render(
            <DataTable<TaskRow>
                data={DATA}
                columns={columns}
                getRowId={(r) => r.id}
                selectionEnabled={false}
                mobileFallback="card"
                onRowClick={onRowClick}
            />,
        );

        const list = screen.getByTestId('mobile-card-list');
        const cards = within(list).getAllByTestId('mobile-card');
        fireEvent.click(cards[1]);

        expect(onRowClick).toHaveBeenCalledTimes(1);
        // First arg is the TanStack Row for t2.
        expect(onRowClick.mock.calls[0][0].original).toEqual(DATA[1]);
    });

    it('renders NO card list in default (scroll) mode', () => {
        render(
            <DataTable<TaskRow>
                data={DATA}
                columns={columns}
                getRowId={(r) => r.id}
                selectionEnabled={false}
            />,
        );
        expect(screen.queryByTestId('mobile-card-list')).not.toBeInTheDocument();
    });
});
