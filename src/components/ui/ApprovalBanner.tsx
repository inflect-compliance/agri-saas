'use client';

/**
 * `<ApprovalBanner>` — Epic 45.3 review-state surface.
 *
 * Renders above the policy detail body whenever a `PolicyApproval`
 * row exists in `PENDING` state. Shows the status, who requested
 * the review, and (when the current user has reviewer permission)
 * Approve / Reject actions.
 *
 * Authorization model:
 *   - The banner ALWAYS shows informational content (status, who
 *     requested, when, optional version reference) so the requester
 *     and other readers see the review state without acting on it.
 *   - `canDecide` (passed by the consumer) gates the action buttons.
 *     The current page wires this off `tenant.permissions.canAdmin`
 *     — same gate the legacy in-version approval buttons used.
 *   - When `canDecide=true` AND the current user IS the requester,
 *     the actions are shown disabled with a "you can't approve your
 *     own request" tooltip. Reviewers cannot self-approve.
 *
 * Decision flow is purely presentational: `onDecide(approvalId,
 * decision, comment)` is the consumer's hook. The current page
 * wires it to `decideApproval`, which POSTs to
 * `/policies/:id/approval/:approvalId/decide`.
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ApprovalBannerUserRef {
    id: string;
    name?: string | null;
    email?: string | null;
}

export interface ApprovalBannerApproval {
    id: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
    requestedBy?: ApprovalBannerUserRef | null;
    approvedBy?: ApprovalBannerUserRef | null;
    decidedAt?: string | null;
    comment?: string | null;
    /** Optional — when the version reference is known, it surfaces
     *  in the banner so the reviewer knows which version they're
     *  approving (avoids accidental approval of an outdated draft). */
    versionNumber?: number | null;
}

export interface ApprovalBannerProps {
    approval: ApprovalBannerApproval;
    /** True when the current user has reviewer permission. */
    canDecide: boolean;
    /** Current user id — used to gate self-approval (a reviewer who is also the requester). */
    currentUserId?: string | null;
    /** Decide handler — see Authorization model in the file docstring. */
    onDecide?: (
        approvalId: string,
        decision: 'APPROVED' | 'REJECTED',
        comment: string,
    ) => void | Promise<void>;
    /** Disabled spinner-style state — caller indicates an in-flight decide call. */
    busy?: boolean;
    className?: string;
    'data-testid'?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function userLabel(u?: ApprovalBannerUserRef | null): string {
    if (!u) return 'Unknown';
    return u.name ?? u.email ?? u.id;
}

// ─── Component ──────────────────────────────────────────────────────

export function ApprovalBanner({
    approval,
    canDecide,
    currentUserId,
    onDecide,
    busy = false,
    className = '',
    'data-testid': dataTestId = 'approval-banner',
}: ApprovalBannerProps) {
    const [comment, setComment] = useState('');
    const [showCommentField, setShowCommentField] = useState(false);

    const isPending = approval.status === 'PENDING';
    const isSelfApproval =
        canDecide &&
        currentUserId != null &&
        approval.requestedBy?.id === currentUserId;
    const canActNow = canDecide && isPending && !isSelfApproval && !busy;

    // Visual treatment per status. Pending = brand emphasis;
    // approved = success; rejected = danger. Each surface picks
    // semantic tokens already used elsewhere in the app.
    const tone = (() => {
        switch (approval.status) {
            case 'APPROVED':
                return {
                    border: 'border-border-success',
                    bg: 'bg-bg-success',
                    fg: 'text-content-success',
                    icon: <CheckCircle2 size={16} className="text-content-success" />,
                    label: 'Approved',
                };
            case 'REJECTED':
                return {
                    border: 'border-border-error',
                    bg: 'bg-bg-error',
                    fg: 'text-content-error',
                    icon: <XCircle size={16} className="text-content-error" />,
                    label: 'Rejected',
                };
            case 'PENDING':
            default:
                return {
                    border: 'border-border-warning',
                    bg: 'bg-bg-warning',
                    fg: 'text-content-warning',
                    icon: <Clock size={16} className="text-content-warning" />,
                    label: 'Pending Review',
                };
        }
    })();

    return (
        <section
            role="region"
            aria-label="Policy approval status"
            data-testid={dataTestId}
            data-status={approval.status}
            className={`rounded-lg border ${tone.border} ${tone.bg} px-4 py-3 ${className}`.trim()}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                        {tone.icon}
                        <h3
                            className={`text-sm font-semibold ${tone.fg}`}
                            data-testid="approval-banner-status"
                        >
                            {tone.label}
                        </h3>
                        {approval.versionNumber != null && (
                            <span className="text-[11px] text-content-muted">
                                · Version {approval.versionNumber}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-content-muted">
                        Requested by{' '}
                        <span
                            className="font-medium text-content-emphasis"
                            data-testid="approval-banner-requester"
                        >
                            {userLabel(approval.requestedBy)}
                        </span>
                        {approval.approvedBy && (
                            <>
                                {' · '}
                                {approval.status === 'APPROVED' ? 'approved' : 'reviewed'}{' '}
                                by{' '}
                                <span
                                    className="font-medium text-content-emphasis"
                                    data-testid="approval-banner-reviewer"
                                >
                                    {userLabel(approval.approvedBy)}
                                </span>
                            </>
                        )}
                        {approval.status === 'PENDING' && !approval.approvedBy && (
                            <>
                                {' · '}
                                <span
                                    className="text-content-subtle"
                                    data-testid="approval-banner-reviewer"
                                >
                                    awaiting any admin reviewer
                                </span>
                            </>
                        )}
                    </p>
                    {approval.comment && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-content-muted">
                            <MessageSquare size={11} aria-hidden />
                            <span data-testid="approval-banner-comment">
                                {approval.comment}
                            </span>
                        </p>
                    )}
                    {isPending && isSelfApproval && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-content-subtle">
                            <AlertTriangle size={11} aria-hidden />
                            You can&rsquo;t approve your own request — another
                            reviewer must decide.
                        </p>
                    )}
                </div>

                {/* Actions — gated three ways:
                    (1) only render when status is PENDING
                    (2) hidden when the viewer can't decide (RBAC)
                    (3) disabled if the viewer is the requester      */}
                {isPending && canDecide && (
                    <div className="flex flex-wrap items-center gap-2">
                        {!showCommentField && (
                            <button
                                type="button"
                                onClick={() => setShowCommentField(true)}
                                disabled={!canActNow}
                                className="text-[11px] text-content-muted hover:text-content-emphasis disabled:opacity-50"
                                aria-label="Add a comment with your decision"
                                data-testid="approval-banner-add-comment"
                            >
                                + Comment
                            </button>
                        )}
                        <Button
                            variant="success"
                            size="sm"
                            onClick={() => onDecide?.(approval.id, 'APPROVED', comment)}
                            disabled={!canActNow}
                            id={`approval-banner-approve-${approval.id}`}
                            data-testid="approval-banner-approve"
                            title={
                                isSelfApproval
                                    ? "Reviewers cannot approve their own request"
                                    : undefined
                            }
                        >
                            {busy ? '…' : 'Approve'}
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onDecide?.(approval.id, 'REJECTED', comment)}
                            disabled={!canActNow}
                            id={`approval-banner-reject-${approval.id}`}
                            data-testid="approval-banner-reject"
                            title={
                                isSelfApproval
                                    ? "Reviewers cannot reject their own request"
                                    : undefined
                            }
                        >
                            {busy ? '…' : 'Reject'}
                        </Button>
                    </div>
                )}
            </div>

            {showCommentField && isPending && canDecide && (
                <div className="mt-3 border-t border-border-default/50 pt-2">
                    <label className="block text-xs text-content-muted">
                        Reviewer comment (optional)
                        <textarea
                            className="input mt-1 w-full text-xs"
                            rows={2}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Add context for the requester…"
                            data-testid="approval-banner-comment-input"
                        />
                    </label>
                </div>
            )}
        </section>
    );
}
