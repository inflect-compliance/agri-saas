'use client';

/**
 * Epic G-4 — Access Reviews list client island.
 *
 * Renders the campaign roster with status badges, deadline,
 * reviewer, and a progress bar (% decided). Admin actions:
 *   • New campaign — modal that submits to POST /access-reviews
 *   • Row click → /t/:slug/access-reviews/:id (detail page)
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { DatePicker } from '@/components/ui/date-picker';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { formatDate } from '@/lib/format-date';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

/// SSR returns Prisma rows with native Date instances; the SWR
/// fetcher returns the same shape but the dates round-trip through
/// JSON as ISO strings. The client widens to accept both.
interface AccessReviewSummary {
    id: string;
    name: string;
    scope: 'ALL_USERS' | 'ADMIN_ONLY' | 'CUSTOM';
    status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
    periodStartAt: string | Date | null;
    periodEndAt: string | Date | null;
    dueAt: string | Date | null;
    closedAt: string | Date | null;
    createdAt: string | Date;
    reviewerUserId: string;
    createdByUserId: string;
    _count: { decisions: number };
    /** Filled by the detail-page hydration; the list endpoint keeps
     *  the response small. */
    decidedCount?: number;
}

const STATUS_VARIANT: Record<
    AccessReviewSummary['status'],
    'pending' | 'info' | 'success'
> = {
    OPEN: 'pending',
    IN_REVIEW: 'info',
    CLOSED: 'success',
};

interface Props {
    tenantSlug: string;
    initialReviews: AccessReviewSummary[];
}

export function AccessReviewsClient({ tenantSlug, initialReviews }: Props) {
    const apiUrl = (path: string) =>
        `/api/t/${tenantSlug}/access-reviews${path}`;
    const queryClient = useQueryClient();
    const router = useRouter();

    const reviewsQuery = useQuery<CappedList<AccessReviewSummary>>({
        queryKey: ['access-reviews', tenantSlug, 'list'],
        queryFn: async () => {
            const res = await fetch(apiUrl(''));
            if (!res.ok) throw new Error('Failed to fetch access reviews');
            return res.json();
        },
        initialData: { rows: initialReviews, truncated: false },
    });

    const reviews = reviewsQuery.data?.rows ?? [];
    const truncated = reviewsQuery.data?.truncated ?? false;

    const columns = useMemo(
        () =>
            createColumns<AccessReviewSummary>([
                {
                    id: 'name',
                    header: 'Campaign',
                    cell: ({ row }) => (
                        <Link
                            href={`/t/${tenantSlug}/access-reviews/${row.original.id}`}
                            className="font-medium text-content-default hover:text-brand-emphasis"
                        >
                            {row.original.name}
                        </Link>
                    ),
                },
                {
                    id: 'status',
                    header: 'Status',
                    cell: ({ row }) => (
                        <StatusBadge variant={STATUS_VARIANT[row.original.status]}>
                            {row.original.status}
                        </StatusBadge>
                    ),
                },
                {
                    id: 'scope',
                    header: 'Scope',
                    cell: ({ row }) => (
                        <span className="text-sm text-content-muted">
                            {row.original.scope.replace('_', ' ').toLowerCase()}
                        </span>
                    ),
                },
                {
                    id: 'period',
                    header: 'Period',
                    cell: ({ row }) =>
                        row.original.periodStartAt && row.original.periodEndAt
                            ? `${formatDate(row.original.periodStartAt)} → ${formatDate(row.original.periodEndAt)}`
                            : '—',
                },
                {
                    id: 'dueAt',
                    header: 'Due',
                    cell: ({ row }) =>
                        row.original.dueAt ? formatDate(row.original.dueAt) : '—',
                },
                {
                    id: 'progress',
                    header: 'Progress',
                    cell: ({ row }) => {
                        const total = row.original._count.decisions;
                        const decided = row.original.decidedCount ?? 0;
                        const pct = total === 0 ? 0 : Math.round((decided / total) * 100);
                        const variant =
                            row.original.status === 'CLOSED'
                                ? 'success'
                                : pct >= 80
                                    ? 'info'
                                    : pct > 0
                                        ? 'brand'
                                        : 'neutral';
                        return (
                            <div className="flex items-center gap-tight">
                                <ProgressBar
                                    value={pct}
                                    variant={variant}
                                    size="sm"
                                    aria-label={`${decided} of ${total} decisions made`}
                                />
                                <span className="text-xs text-content-muted whitespace-nowrap">
                                    {decided}/{total}
                                </span>
                            </div>
                        );
                    },
                },
            ]),
        [tenantSlug],
    );

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                                { label: 'Access Reviews' },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1} data-testid="access-reviews-title">
                            Access Reviews
                        </Heading>
                        <p className="text-sm text-content-muted">
                            {reviews.length} campaign{reviews.length === 1 ? '' : 's'}
                        </p>
                    </div>
                    <CreateCampaignButton
                        tenantSlug={tenantSlug}
                        onCreated={(reviewId) => {
                            queryClient.invalidateQueries({
                                queryKey: ['access-reviews', tenantSlug],
                            });
                            router.push(
                                `/t/${tenantSlug}/access-reviews/${reviewId}`,
                            );
                        }}
                    />
                </div>
                {truncated ? <TruncationBanner truncated /> : null}
            </ListPageShell.Header>
            <ListPageShell.Body>
                {reviews.length === 0 ? (
                    <div
                        className="rounded border border-border-subtle bg-bg-subtle p-12 text-center"
                        data-testid="access-reviews-empty"
                    >
                        <p className="text-content-muted">
                            No access reviews yet. Click <strong>New campaign</strong> to start one.
                        </p>
                    </div>
                ) : (
                    <div data-testid="access-reviews-table">
                        <DataTable
                            fillBody
                            data={reviews}
                            columns={columns}
                            getRowId={(r) => r.id}
                            resourceName={(plural) =>
                                plural ? 'access reviews' : 'access review'
                            }
                        />
                        {/* Per-row testid markers for downstream tests
                         *  that don't reach into DataTable internals. */}
                        <div hidden>
                            {reviews.map((r) => (
                                <span
                                    key={r.id}
                                    data-testid={`access-review-row-${r.id}`}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </ListPageShell.Body>
        </ListPageShell>
    );
}

// ─── Create campaign modal ─────────────────────────────────────────

interface CreateCampaignButtonProps {
    tenantSlug: string;
    onCreated: (reviewId: string) => void;
}

function CreateCampaignButton({
    tenantSlug,
    onCreated,
}: CreateCampaignButtonProps) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [scope, setScope] = useState<'ALL_USERS' | 'ADMIN_ONLY'>('ALL_USERS');
    const [reviewerUserId, setReviewerUserId] = useState('');
    const [dueAt, setDueAt] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);

    const apiUrl = `/api/t/${tenantSlug}/access-reviews`;

    const createMutation = useMutation({
        mutationFn: async () => {
            setError(null);
            const body = {
                name,
                description: description || undefined,
                scope,
                reviewerUserId,
                dueAt: dueAt ? dueAt.toISOString() : undefined,
            };
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to create campaign');
            }
            return (await res.json()) as { accessReviewId: string };
        },
        onSuccess: (data) => {
            setOpen(false);
            setName('');
            setDescription('');
            setReviewerUserId('');
            setDueAt(null);
            onCreated(data.accessReviewId);
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Unknown error');
        },
    });

    const submit = () => {
        if (!name.trim() || !reviewerUserId.trim()) {
            setError('Name and reviewer are required.');
            return;
        }
        createMutation.mutate();
    };

    return (
        <>
            <Button
                onClick={() => setOpen(true)}
                data-testid="access-review-new-campaign-button"
            >
                New campaign
            </Button>
            {open ? (
                <Modal showModal={open} setShowModal={setOpen}>
                    <Modal.Header title="New access review campaign" />
                    <Modal.Body>
                        <div className="space-y-default">
                            <FormField label="Name" required>
                                <input
                                    className="input"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Q1 2026 access review"
                                    data-testid="access-review-new-name"
                                />
                            </FormField>
                            <FormField label="Description (optional)">
                                <textarea
                                    className="input"
                                    rows={3}
                                    value={description}
                                    onChange={(e) =>
                                        setDescription(e.target.value)
                                    }
                                    placeholder="Focus and rationale for this campaign"
                                />
                            </FormField>
                            <FormField label="Scope">
                                <RadioGroup
                                    value={scope}
                                    onValueChange={(v) =>
                                        setScope(
                                            v as 'ALL_USERS' | 'ADMIN_ONLY',
                                        )
                                    }
                                    className="flex flex-col gap-tight"
                                >
                                    <label className="flex items-center gap-tight text-sm">
                                        <RadioGroupItem value="ALL_USERS" />
                                        All users
                                    </label>
                                    <label className="flex items-center gap-tight text-sm">
                                        <RadioGroupItem value="ADMIN_ONLY" />
                                        Owners + admins only
                                    </label>
                                </RadioGroup>
                            </FormField>
                            <FormField label="Reviewer user ID" required>
                                <input
                                    className="input"
                                    value={reviewerUserId}
                                    onChange={(e) =>
                                        setReviewerUserId(e.target.value)
                                    }
                                    placeholder="usr_..."
                                    data-testid="access-review-new-reviewer"
                                />
                            </FormField>
                            <FormField label="Due date (optional)">
                                <DatePicker
                                    value={dueAt}
                                    onChange={setDueAt}
                                    clearable
                                />
                            </FormField>
                            {error ? (
                                <p
                                    className="text-sm text-content-error"
                                    data-testid="access-review-new-error"
                                >
                                    {error}
                                </p>
                            ) : null}
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button
                            variant="secondary"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={submit}
                            disabled={createMutation.isPending}
                            data-testid="access-review-new-submit"
                        >
                            {createMutation.isPending
                                ? 'Creating…'
                                : 'Create campaign'}
                        </Button>
                    </Modal.Footer>
                </Modal>
            ) : null}
        </>
    );
}
