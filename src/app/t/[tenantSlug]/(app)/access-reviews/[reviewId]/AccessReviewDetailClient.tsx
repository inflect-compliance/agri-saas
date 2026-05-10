'use client';

/**
 * Epic G-4 — Access Review detail / reviewer page.
 *
 * The reviewer's working surface — every snapshot subject is one
 * row in a table with:
 *   • Subject identity (name + email)
 *   • Snapshot role at campaign creation (frozen evidence)
 *   • Live role today (changes if anyone updated the membership
 *     after snapshot)
 *   • Last activity date (max UserSession.lastActiveAt for the user)
 *   • Decision dropdown — CONFIRM / REVOKE / MODIFY
 *   • Decision-aware modal for MODIFY's `modifiedToRole` + notes
 *
 * Permission gating in this component:
 *   - Only the assigned reviewer (ctx.userId === review.reviewerUserId)
 *     OR an admin can submit decisions.
 *   - Only an admin can press "Close campaign".
 *   - Anyone with read can browse + download the evidence PDF when
 *     the campaign is CLOSED.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@/components/ui/status-badge';
import { MetaStrip } from '@/components/ui/meta-strip';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { Heading } from '@/components/ui/typography';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';

const ALL_ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'READER', 'AUDITOR'] as const;
type Role = (typeof ALL_ROLES)[number];
type DecisionType = 'CONFIRM' | 'REVOKE' | 'MODIFY';
type Status = 'OPEN' | 'IN_REVIEW' | 'CLOSED';

interface DecisionRow {
    id: string;
    subjectUserId: string;
    subjectUser: { id: string; email: string; name: string | null };
    snapshotRole: Role;
    snapshotMembershipStatus: string;
    decision: DecisionType | null;
    decidedAt: string | Date | null;
    decidedBy: { id: string; email: string; name: string | null } | null;
    notes: string | null;
    modifiedToRole: Role | null;
    executedAt: string | Date | null;
    membership: {
        id: string;
        role: Role;
        status: string;
    } | null;
}

interface ReviewDetail {
    id: string;
    name: string;
    description: string | null;
    scope: 'ALL_USERS' | 'ADMIN_ONLY' | 'CUSTOM';
    status: Status;
    periodStartAt: string | Date | null;
    periodEndAt: string | Date | null;
    dueAt: string | Date | null;
    closedAt: string | Date | null;
    createdAt: string | Date;
    reviewerUserId: string;
    evidenceFileRecordId: string | null;
    reviewer: { id: string; email: string; name: string | null };
    createdBy: { id: string; email: string; name: string | null };
    closedBy: { id: string; email: string; name: string | null } | null;
    decisions: DecisionRow[];
    lastActivityByUser: Record<string, string | Date>;
}

interface Props {
    tenantSlug: string;
    initialReview: ReviewDetail;
    currentUserId: string;
    isAdmin: boolean;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'info' | 'success'> = {
    OPEN: 'warning',
    IN_REVIEW: 'info',
    CLOSED: 'success',
};

const DECISION_VARIANT: Record<DecisionType, 'success' | 'error' | 'warning'> = {
    CONFIRM: 'success',
    REVOKE: 'error',
    MODIFY: 'warning',
};

export function AccessReviewDetailClient({
    tenantSlug,
    initialReview,
    currentUserId,
    isAdmin,
}: Props) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const apiBase = `/api/t/${tenantSlug}/access-reviews/${initialReview.id}`;

    const reviewQuery = useQuery<ReviewDetail>({
        queryKey: ['access-review', tenantSlug, initialReview.id],
        queryFn: async () => {
            const res = await fetch(apiBase);
            if (!res.ok) throw new Error('Failed to fetch access review');
            return res.json();
        },
        initialData: initialReview,
    });
    const review = reviewQuery.data!;

    const isReviewer = currentUserId === review.reviewerUserId;
    const canDecide = (isReviewer || isAdmin) && review.status !== 'CLOSED';
    const canClose = isAdmin && review.status !== 'CLOSED';

    const [activeDecision, setActiveDecision] = useState<{
        row: DecisionRow;
        type: DecisionType;
    } | null>(null);
    const [closing, setClosing] = useState(false);

    const decisionsTotal = review.decisions.length;
    const decided = review.decisions.filter((d) => d.decision !== null).length;
    const pct = decisionsTotal === 0 ? 0 : Math.round((decided / decisionsTotal) * 100);

    return (
        <EntityDetailLayout
            id="access-review-detail-page"
            breadcrumbs={[
                { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                { label: 'Access Reviews', href: `/t/${tenantSlug}/access-reviews` },
                { label: review.name },
            ]}
            title={<span data-testid="access-review-detail-title">{review.name}</span>}
            meta={
                <MetaStrip
                    items={[
                        {
                            kind: 'status',
                            label: 'Status',
                            value: review.status,
                            variant:
                                STATUS_VARIANT[review.status] ?? 'neutral',
                        },
                    ]}
                />
            }
            actions={
                <div className="flex flex-col items-end gap-tight">
                    <div className="flex items-center gap-tight">
                        <ProgressBar
                            value={pct}
                            variant={pct >= 100 ? 'success' : pct >= 50 ? 'info' : 'brand'}
                            aria-label={`${decided} of ${decisionsTotal} decisions made`}
                            className="w-full sm:w-48"
                        />
                        <span className="text-xs text-content-muted whitespace-nowrap">
                            {decided}/{decisionsTotal}
                        </span>
                    </div>
                    <div className="flex gap-tight">
                        {review.evidenceFileRecordId ? (
                            <Button
                                variant="secondary"
                                onClick={() =>
                                    window.open(`${apiBase}/evidence`, '_blank')
                                }
                                data-testid="access-review-download-evidence"
                            >
                                Download evidence PDF
                            </Button>
                        ) : null}
                        {canClose ? (
                            <Button
                                onClick={() => setClosing(true)}
                                disabled={decided !== decisionsTotal}
                                data-testid="access-review-close-button"
                            >
                                Close campaign
                            </Button>
                        ) : null}
                    </div>
                </div>
            }
        >
            {/* Description + meta data list — preserved as the first body
                element since EntityDetailLayout's `meta` prop is sized
                for inline badges, not multi-row metadata. */}
            <div className="space-y-tight">
                {review.description ? (
                    <p className="text-sm text-content-muted max-w-prose">
                        {review.description}
                    </p>
                ) : null}
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-content-muted">
                    <div>
                        <dt className="font-semibold uppercase">Reviewer</dt>
                        <dd>{review.reviewer.email}</dd>
                    </div>
                    <div>
                        <dt className="font-semibold uppercase">Scope</dt>
                        <dd>{review.scope.replace('_', ' ').toLowerCase()}</dd>
                    </div>
                    <div>
                        <dt className="font-semibold uppercase">Due</dt>
                        <dd>{review.dueAt ? formatDate(review.dueAt) : '—'}</dd>
                    </div>
                    {review.closedAt ? (
                        <div>
                            <dt className="font-semibold uppercase">Closed</dt>
                            <dd>{formatDateTime(review.closedAt)}</dd>
                        </div>
                    ) : null}
                </dl>
            </div>

            {/* Roster table */}
            <div className="overflow-hidden rounded border border-border-subtle">
                <table className="w-full">
                    <thead className="bg-bg-subtle text-left text-xs uppercase text-content-muted">
                        <tr>
                            <th className="px-4 py-2">Subject</th>
                            <th className="px-4 py-2">Snapshot role</th>
                            <th className="px-4 py-2">Live role</th>
                            <th className="px-4 py-2">Last active</th>
                            <th className="px-4 py-2">Decision</th>
                        </tr>
                    </thead>
                    <tbody>
                        {review.decisions.map((row) => (
                            <DecisionRow
                                key={row.id}
                                row={row}
                                lastActiveAt={
                                    review.lastActivityByUser[row.subjectUserId] ??
                                    null
                                }
                                canDecide={canDecide}
                                onDecide={(type) =>
                                    setActiveDecision({ row, type })
                                }
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {activeDecision ? (
                <DecisionDialog
                    apiBase={apiBase}
                    decision={activeDecision}
                    onClose={() => setActiveDecision(null)}
                    onSuccess={() => {
                        setActiveDecision(null);
                        queryClient.invalidateQueries({
                            queryKey: ['access-review', tenantSlug, initialReview.id],
                        });
                    }}
                />
            ) : null}

            {closing ? (
                <CloseDialog
                    apiBase={apiBase}
                    onClose={() => setClosing(false)}
                    onSuccess={() => {
                        setClosing(false);
                        queryClient.invalidateQueries({
                            queryKey: ['access-review', tenantSlug, initialReview.id],
                        });
                        // List page sees the new CLOSED state too.
                        queryClient.invalidateQueries({
                            queryKey: ['access-reviews', tenantSlug, 'list'],
                        });
                        router.refresh();
                    }}
                />
            ) : null}
        </EntityDetailLayout>
    );
}

// ─── Roster row ──────────────────────────────────────────────────────

function DecisionRow({
    row,
    lastActiveAt,
    canDecide,
    onDecide,
}: {
    row: DecisionRow;
    lastActiveAt: string | Date | null;
    canDecide: boolean;
    onDecide: (type: DecisionType) => void;
}) {
    return (
        <tr
            className="border-t border-border-subtle"
            data-testid={`decision-row-${row.id}`}
        >
            <td className="px-4 py-3">
                <div className="font-medium text-content-default">
                    {row.subjectUser.name || '—'}
                </div>
                <div className="text-xs text-content-muted">
                    {row.subjectUser.email}
                </div>
            </td>
            <td className="px-4 py-3 text-sm">{row.snapshotRole}</td>
            <td className="px-4 py-3 text-sm">
                {row.membership ? row.membership.role : (
                    <span className="text-content-muted italic">(deleted)</span>
                )}
            </td>
            <td className="px-4 py-3 text-sm text-content-muted">
                {lastActiveAt ? formatDate(lastActiveAt) : 'never'}
            </td>
            <td className="px-4 py-3">
                {row.decision ? (
                    <div className="flex items-center gap-tight">
                        <StatusBadge variant={DECISION_VARIANT[row.decision]}>
                            {row.decision}
                            {row.decision === 'MODIFY' && row.modifiedToRole
                                ? ` → ${row.modifiedToRole}`
                                : ''}
                        </StatusBadge>
                    </div>
                ) : canDecide ? (
                    <select
                        className="input"
                        defaultValue=""
                        data-testid={`decision-select-${row.id}`}
                        onChange={(e) => {
                            const v = e.target.value as DecisionType | '';
                            if (v) onDecide(v);
                            e.target.value = '';
                        }}
                    >
                        <option value="" disabled>
                            Decide…
                        </option>
                        <option value="CONFIRM">Confirm access</option>
                        <option value="REVOKE">Revoke access</option>
                        <option value="MODIFY">Modify role</option>
                    </select>
                ) : (
                    <span className="text-xs text-content-muted">pending</span>
                )}
            </td>
        </tr>
    );
}

// ─── Decision dialog ─────────────────────────────────────────────────

function DecisionDialog({
    apiBase,
    decision,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    decision: { row: DecisionRow; type: DecisionType };
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [notes, setNotes] = useState('');
    const [modifiedToRole, setModifiedToRole] = useState<Role>('READER');
    const [error, setError] = useState<string | null>(null);

    const targetRoles = useMemo(
        () => ALL_ROLES.filter((r) => r !== decision.row.snapshotRole),
        [decision.row.snapshotRole],
    );

    const submit = useMutation({
        mutationFn: async () => {
            setError(null);
            const body =
                decision.type === 'MODIFY'
                    ? { decision: 'MODIFY', modifiedToRole, notes: notes || undefined }
                    : { decision: decision.type, notes: notes || undefined };
            const res = await fetch(
                `${apiBase}/decisions/${decision.row.id}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to submit decision');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    const titleByType: Record<DecisionType, string> = {
        CONFIRM: 'Confirm access',
        REVOKE: 'Revoke access',
        MODIFY: 'Modify role',
    };

    return (
        <Modal showModal={true} setShowModal={(v) => !v && onClose()}>
            <Modal.Header
                title={`${titleByType[decision.type]} — ${decision.row.subjectUser.email}`}
            />
            <Modal.Body>
                <div className="space-y-default">
                    <p className="text-sm text-content-muted">
                        Snapshot role at campaign creation:{' '}
                        <strong>{decision.row.snapshotRole}</strong>
                        {decision.row.membership &&
                        decision.row.membership.role !== decision.row.snapshotRole ? (
                            <>
                                {' '}
                                (live now: <strong>{decision.row.membership.role}</strong>)
                            </>
                        ) : null}
                    </p>
                    {decision.type === 'MODIFY' ? (
                        <FormField label="Target role" required>
                            <select
                                className="input"
                                value={modifiedToRole}
                                onChange={(e) => setModifiedToRole(e.target.value as Role)}
                                data-testid="decision-modal-modified-to-role"
                            >
                                {targetRoles.map((r) => (
                                    <option key={r} value={r}>
                                        {r}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                    ) : null}
                    <FormField
                        label={
                            decision.type === 'CONFIRM'
                                ? 'Justification (optional)'
                                : 'Justification (recommended)'
                        }
                    >
                        <textarea
                            className="input"
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Why this decision?"
                            data-testid="decision-modal-notes"
                        />
                    </FormField>
                    {error ? (
                        <p
                            className="text-sm text-content-error"
                            data-testid="decision-modal-error"
                        >
                            {error}
                        </p>
                    ) : null}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => submit.mutate()}
                    disabled={submit.isPending}
                    data-testid="decision-modal-submit"
                >
                    {submit.isPending ? 'Submitting…' : 'Submit decision'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

// ─── Close-campaign dialog ───────────────────────────────────────────

function CloseDialog({
    apiBase,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [error, setError] = useState<string | null>(null);

    const close = useMutation({
        mutationFn: async () => {
            setError(null);
            const res = await fetch(`${apiBase}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to close campaign');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    return (
        <Modal showModal={true} setShowModal={(v) => !v && onClose()}>
            <Modal.Header title="Close access review campaign" />
            <Modal.Body>
                <p className="text-sm text-content-muted">
                    Closing executes every <strong>REVOKE</strong> and{' '}
                    <strong>MODIFY</strong> decision against the live tenant
                    memberships. <strong>CONFIRM</strong> decisions stay
                    untouched. A signed PDF evidence artifact will be
                    generated and linked to the campaign. This cannot be
                    undone.
                </p>
                {error ? (
                    <p
                        className="mt-3 text-sm text-content-error"
                        data-testid="close-modal-error"
                    >
                        {error}
                    </p>
                ) : null}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => close.mutate()}
                    disabled={close.isPending}
                    data-testid="close-modal-submit"
                >
                    {close.isPending ? 'Closing…' : 'Close + generate evidence'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
