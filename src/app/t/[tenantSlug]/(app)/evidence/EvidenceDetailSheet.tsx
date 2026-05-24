'use client';

/**
 * B5 — Evidence detail sheet.
 *
 * Pre-B5 the evidence table had no way to drill into a single
 * record — every action (Submit, Approve, Reject) was inline on the
 * row, and the underlying detail fields (description, owner,
 * retention, related control) were invisible from the list.
 *
 * This sheet opens on row click. It shows the read-only evidence
 * detail + the existing approval-flow buttons (which call back to
 * the parent's `onReview` to keep the existing optimistic-update
 * mutation pipeline intact) + an "Edit" button that delegates to
 * the parent to mount the EditEvidenceModal.
 *
 * Mirrors the `<ControlDetailSheet>` shape so the surface reads as
 * a sibling of the established controls drill-down.
 */
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/format-date';
import { Pen2 } from '@/components/ui/icons/nucleo';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

const EVIDENCE_STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
    DRAFT: 'neutral',
    SUBMITTED: 'info',
    APPROVED: 'success',
    REJECTED: 'error',
    NEEDS_REVIEW: 'warning',
};

export interface EvidenceDetailSheetProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    /** The clicked row id; `null` while the sheet is closed. */
    evidenceId: string | null;
    /** Allowed write surfaces — gates the edit + review buttons. */
    canWrite: boolean;
    canAdmin: boolean;
    /** Open the edit modal for the loaded evidence. */
    onEdit: (evidence: {
        id: string;
        title: string;
        description: string | null;
        ownerUserId: string | null;
        controlId: string | null;
    }) => void;
    /** Existing parent review pipeline — re-uses the optimistic mutation. */
    onReview: (id: string, action: 'SUBMITTED' | 'APPROVED' | 'REJECTED') => void;
}

interface EvidenceDetailPayload {
    id: string;
    title: string;
    description: string | null;
    type: string;
    status: string;
    nextReviewDate: string | null;
    owner: string | null;
    ownerUserId: string | null;
    controlId: string | null;
    control?: { id: string; code: string | null; name: string } | null;
    createdAt: string;
    updatedAt: string;
}

export function EvidenceDetailSheet({
    open,
    setOpen,
    evidenceId,
    canWrite,
    canAdmin,
    onEdit,
    onReview,
}: EvidenceDetailSheetProps) {
    const apiUrl = useTenantApiUrl();

    const detailQuery = useQuery<EvidenceDetailPayload>({
        queryKey: ['evidence', 'detail', evidenceId],
        queryFn: async () => {
            const res = await fetch(apiUrl(`/evidence/${evidenceId}`));
            if (!res.ok) throw new Error('Failed to load evidence');
            return res.json();
        },
        enabled: open && !!evidenceId,
    });

    const evidence = detailQuery.data;

    const metaRows = useMemo(() => {
        if (!evidence) return [];
        const rows: Array<{ label: string; value: React.ReactNode }> = [];
        rows.push({ label: 'Type', value: evidence.type });
        if (evidence.owner) rows.push({ label: 'Owner', value: evidence.owner });
        if (evidence.control) {
            rows.push({
                label: 'Control',
                value: `${evidence.control.code ?? ''}${evidence.control.code ? ' — ' : ''}${evidence.control.name}`,
            });
        }
        if (evidence.nextReviewDate) {
            rows.push({
                label: 'Next review',
                value: formatDate(new Date(evidence.nextReviewDate)),
            });
        }
        rows.push({
            label: 'Updated',
            value: formatDate(new Date(evidence.updatedAt)),
        });
        return rows;
    }, [evidence]);

    return (
        <Sheet
            open={open}
            onOpenChange={setOpen}
            size="md"
            title={evidence?.title ?? 'Evidence detail'}
        >
            {detailQuery.isLoading || !evidence ? (
                <>
                    <Sheet.Header title="Loading…" />
                    <Sheet.Body>
                        <div className="flex h-40 items-center justify-center text-sm text-content-muted">
                            Loading evidence…
                        </div>
                    </Sheet.Body>
                </>
            ) : detailQuery.isError ? (
                <>
                    <Sheet.Header title="Evidence" />
                    <Sheet.Body>
                        <div
                            className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            role="alert"
                            data-testid="evidence-sheet-error"
                        >
                            {detailQuery.error instanceof Error
                                ? detailQuery.error.message
                                : 'Failed to load evidence.'}
                        </div>
                    </Sheet.Body>
                </>
            ) : (
                <>
                    <Sheet.Header
                        title={evidence.title}
                        description={evidence.description || undefined}
                    />
                    <Sheet.Body>
                        <div className="space-y-default">
                            <div className="flex items-center gap-tight">
                                <StatusBadge
                                    variant={
                                        EVIDENCE_STATUS_VARIANT[evidence.status] ??
                                        'neutral'
                                    }
                                    id="evidence-sheet-status"
                                >
                                    {evidence.status}
                                </StatusBadge>
                            </div>

                            {metaRows.length > 0 && (
                                <dl className="grid grid-cols-1 gap-1">
                                    {metaRows.map((row) => (
                                        <div
                                            key={row.label}
                                            className="flex items-baseline justify-between gap-default text-sm"
                                        >
                                            <dt className="text-content-muted">
                                                {row.label}
                                            </dt>
                                            <dd className="text-content-default text-right">
                                                {row.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}

                            {evidence.description && (
                                <div className="space-y-tight">
                                    <p className="text-xs font-medium uppercase tracking-widest text-content-subtle">
                                        Description
                                    </p>
                                    <p className="text-sm text-content-default whitespace-pre-wrap">
                                        {evidence.description}
                                    </p>
                                </div>
                            )}
                        </div>
                    </Sheet.Body>
                    <Sheet.Footer>
                        <div className="flex flex-wrap items-center gap-tight">
                            {canWrite && (
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={() =>
                                        onEdit({
                                            id: evidence.id,
                                            title: evidence.title,
                                            description: evidence.description,
                                            ownerUserId: evidence.ownerUserId,
                                            controlId: evidence.controlId,
                                        })
                                    }
                                    id="evidence-sheet-edit-btn"
                                    aria-label="Edit evidence"
                                >
                                    <Pen2 className="size-4" />
                                </Button>
                            )}
                            {/* Approval flow — existing parent mutation
                                runs the optimistic update + audit
                                emission; the sheet just routes the
                                button click back to the parent.

                                B5 primary-action discipline + modal
                                action-order rule:
                                  - Author-side corrections (Submit /
                                    Re-submit / Re-certify) render as
                                    `secondary`. They're rendered
                                    FIRST so the affirmative action
                                    on the SUBMITTED branch ends the
                                    JSX last.
                                  - Reviewer's destructive Reject
                                    sits before the approving CTA so
                                    the LAST button on every visible
                                    branch is the most-affirmative
                                    action (matches the modal-
                                    action-order rule). */}
                            {canWrite && evidence.status === 'DRAFT' && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onReview(evidence.id, 'SUBMITTED')}
                                    id="evidence-sheet-submit-btn"
                                >
                                    Submit for review
                                </Button>
                            )}
                            {canWrite && evidence.status === 'REJECTED' && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onReview(evidence.id, 'SUBMITTED')}
                                    id="evidence-sheet-resubmit-btn"
                                >
                                    Re-submit
                                </Button>
                            )}
                            {canWrite && evidence.status === 'NEEDS_REVIEW' && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onReview(evidence.id, 'SUBMITTED')}
                                    id="evidence-sheet-recertify-btn"
                                >
                                    Re-submit for review
                                </Button>
                            )}
                            {canAdmin && evidence.status === 'SUBMITTED' && (
                                <>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => onReview(evidence.id, 'REJECTED')}
                                        id="evidence-sheet-reject-btn"
                                    >
                                        Reject
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => onReview(evidence.id, 'APPROVED')}
                                        id="evidence-sheet-approve-btn"
                                    >
                                        Approve
                                    </Button>
                                </>
                            )}
                        </div>
                    </Sheet.Footer>
                </>
            )}
        </Sheet>
    );
}
