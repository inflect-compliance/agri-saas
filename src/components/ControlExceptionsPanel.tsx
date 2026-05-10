'use client';

/**
 * Epic G-5 — Control Exceptions Panel.
 *
 * Renders inside the control-detail page. Anchors the entire
 * exception workflow (request, approve, reject, renew, audit)
 * to the control the user is already looking at.
 *
 * Permission gating:
 *   - Anyone with read access can see the panel.
 *   - canWrite → Request / Renew buttons.
 *   - canAdmin → Approve / Reject buttons on REQUESTED rows.
 *
 * The panel always reflects the live state via React Query so an
 * approve from another tab refreshes the badges in this one.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { Heading } from '@/components/ui/typography';

type Status = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

interface ExceptionSummary {
    id: string;
    controlId: string;
    status: Status;
    expiresAt: string | Date | null;
    approvedAt: string | Date | null;
    rejectedAt: string | Date | null;
    riskAcceptedByUserId: string;
    createdByUserId: string;
    createdAt: string | Date;
    renewedFromId: string | null;
    compensatingControlId: string | null;
    control: { id: string; name: string; code: string | null } | null;
    compensatingControl: { id: string; name: string; code: string | null } | null;
}

interface ControlOption {
    id: string;
    name: string;
    code?: string | null;
}

interface Props {
    tenantSlug: string;
    controlId: string;
    /// Caller-supplied list of available compensating controls. The
    /// detail page already has the control roster in scope; passing
    /// it down avoids a second fetch.
    compensatingControlChoices: readonly ControlOption[];
    /// User who would normally accept the risk by default — usually
    /// the control owner. The form lets the requester change it.
    defaultRiskAcceptedByUserId: string;
    /// Permission flags resolved server-side and threaded through.
    canWrite: boolean;
    canAdmin: boolean;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'error'> = {
    REQUESTED: 'warning',
    APPROVED: 'success',
    REJECTED: 'error',
    EXPIRED: 'warning',
};

export function ControlExceptionsPanel({
    tenantSlug,
    controlId,
    compensatingControlChoices,
    defaultRiskAcceptedByUserId,
    canWrite,
    canAdmin,
}: Props) {
    const queryClient = useQueryClient();
    const apiBase = `/api/t/${tenantSlug}/controls/${controlId}/exceptions`;

    const exceptionsQuery = useQuery<{ rows: ExceptionSummary[] }>({
        queryKey: ['control-exceptions', tenantSlug, controlId],
        queryFn: async () => {
            const res = await fetch(apiBase);
            if (!res.ok) throw new Error('Failed to fetch exceptions');
            return res.json();
        },
    });

    const rows = exceptionsQuery.data?.rows ?? [];
    const activeException = rows.find((r) => r.status === 'APPROVED' || r.status === 'REQUESTED');

    const [requestOpen, setRequestOpen] = useState(false);
    const [approveTargetId, setApproveTargetId] = useState<string | null>(null);
    const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
    const [renewTargetId, setRenewTargetId] = useState<string | null>(null);

    const invalidate = () => {
        queryClient.invalidateQueries({
            queryKey: ['control-exceptions', tenantSlug, controlId],
        });
    };

    return (
        <section
            className="space-y-default"
            data-testid="control-exceptions-panel"
        >
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-compact">
                    <Heading level={2}>
                        Control Exceptions
                    </Heading>
                    <ExceptionHeaderBadge ex={activeException} />
                </div>
                {canWrite ? (
                    <Button
                        onClick={() => setRequestOpen(true)}
                        data-testid="control-exception-request-button"
                    >
                        Request exception
                    </Button>
                ) : null}
            </header>

            {rows.length === 0 ? (
                <p
                    className="text-sm text-content-muted"
                    data-testid="control-exceptions-empty"
                >
                    No exceptions on file. The control is enforced as designed.
                </p>
            ) : (
                <ul className="space-y-tight" data-testid="control-exceptions-list">
                    {rows.map((r) => (
                        <li
                            key={r.id}
                            className="rounded border border-border-subtle p-3"
                            data-testid={`control-exception-row-${r.id}`}
                        >
                            <div className="flex items-center justify-between gap-compact">
                                <div className="flex items-center gap-tight">
                                    <StatusBadge variant={STATUS_VARIANT[r.status]}>
                                        {r.status}
                                    </StatusBadge>
                                    <span className="text-sm text-content-muted">
                                        {r.expiresAt
                                            ? `expires ${formatDate(r.expiresAt)}`
                                            : 'no expiry set'}
                                    </span>
                                    {r.compensatingControl ? (
                                        <span className="text-xs text-content-muted">
                                            compensating: {r.compensatingControl.name}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="flex gap-tight">
                                    {canAdmin && r.status === 'REQUESTED' ? (
                                        <>
                                            <Button
                                                variant="secondary"
                                                onClick={() => setApproveTargetId(r.id)}
                                                data-testid={`control-exception-approve-button-${r.id}`}
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={() => setRejectTargetId(r.id)}
                                                data-testid={`control-exception-reject-button-${r.id}`}
                                            >
                                                Reject
                                            </Button>
                                        </>
                                    ) : null}
                                    {canWrite && (r.status === 'APPROVED' || r.status === 'EXPIRED') ? (
                                        <Button
                                            variant="secondary"
                                            onClick={() => setRenewTargetId(r.id)}
                                            data-testid={`control-exception-renew-button-${r.id}`}
                                        >
                                            Renew
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            <p className="mt-2 text-xs text-content-muted">
                                Requested {formatDateTime(r.createdAt)}
                                {r.renewedFromId ? ` • renewed from ${r.renewedFromId.slice(0, 8)}…` : ''}
                            </p>
                        </li>
                    ))}
                </ul>
            )}

            {requestOpen ? (
                <RequestExceptionDialog
                    apiBase={apiBase}
                    controlId={controlId}
                    compensatingControlChoices={compensatingControlChoices}
                    defaultRiskAcceptedByUserId={defaultRiskAcceptedByUserId}
                    onClose={() => setRequestOpen(false)}
                    onSuccess={() => {
                        setRequestOpen(false);
                        invalidate();
                    }}
                />
            ) : null}

            {approveTargetId ? (
                <ApproveDialog
                    apiBase={apiBase}
                    exceptionId={approveTargetId}
                    onClose={() => setApproveTargetId(null)}
                    onSuccess={() => {
                        setApproveTargetId(null);
                        invalidate();
                    }}
                />
            ) : null}

            {rejectTargetId ? (
                <RejectDialog
                    apiBase={apiBase}
                    exceptionId={rejectTargetId}
                    onClose={() => setRejectTargetId(null)}
                    onSuccess={() => {
                        setRejectTargetId(null);
                        invalidate();
                    }}
                />
            ) : null}

            {renewTargetId ? (
                <RenewDialog
                    apiBase={apiBase}
                    exceptionId={renewTargetId}
                    onClose={() => setRenewTargetId(null)}
                    onSuccess={() => {
                        setRenewTargetId(null);
                        invalidate();
                    }}
                />
            ) : null}
        </section>
    );
}

// ─── Header badge ────────────────────────────────────────────────────

/**
 * Public sub-component — surfaces an "Active exception" badge that
 * the control-detail header can render without the rest of the
 * panel. Returns null when no active exception exists.
 */
export function ControlExceptionHeaderBadge({
    tenantSlug,
    controlId,
}: {
    tenantSlug: string;
    controlId: string;
}) {
    const apiBase = `/api/t/${tenantSlug}/controls/${controlId}/exceptions`;
    const exceptionsQuery = useQuery<{ rows: ExceptionSummary[] }>({
        queryKey: ['control-exceptions', tenantSlug, controlId],
        queryFn: async () => {
            const res = await fetch(apiBase);
            if (!res.ok) throw new Error('Failed to fetch exceptions');
            return res.json();
        },
        staleTime: 30_000,
    });
    const active = (exceptionsQuery.data?.rows ?? []).find(
        (r) => r.status === 'APPROVED' || r.status === 'REQUESTED',
    );
    return <ExceptionHeaderBadge ex={active} />;
}

function ExceptionHeaderBadge({ ex }: { ex?: ExceptionSummary }) {
    if (!ex) return null;
    return (
        <StatusBadge
            variant={STATUS_VARIANT[ex.status]}
            data-testid="control-exception-header-badge"
        >
            Exception: {ex.status}
        </StatusBadge>
    );
}

// ─── Dialogs ─────────────────────────────────────────────────────────

function RequestExceptionDialog({
    apiBase,
    controlId,
    compensatingControlChoices,
    defaultRiskAcceptedByUserId,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    controlId: string;
    compensatingControlChoices: readonly ControlOption[];
    defaultRiskAcceptedByUserId: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [justification, setJustification] = useState('');
    const [compensatingControlId, setCompensatingControlId] = useState<string | null>(null);
    const [riskAcceptedByUserId, setRiskAcceptedByUserId] = useState(defaultRiskAcceptedByUserId);
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);

    const compensatingChoiceOptions: ComboboxOption[] = useMemo(
        () =>
            compensatingControlChoices
                .filter((c) => c.id !== controlId)
                .map((c) => ({
                    value: c.id,
                    label: c.code ? `${c.code} — ${c.name}` : c.name,
                })),
        [compensatingControlChoices, controlId],
    );

    const submit = useMutation({
        mutationFn: async () => {
            setError(null);
            const body = {
                controlId,
                justification,
                compensatingControlId: compensatingControlId || undefined,
                riskAcceptedByUserId,
                expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
            };
            const res = await fetch(apiBase, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to request exception');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    const valid = justification.trim().length > 0 && riskAcceptedByUserId.trim().length > 0;

    return (
        <Modal showModal setShowModal={(v) => !v && onClose()}>
            <Modal.Header title="Request control exception" />
            <Modal.Body>
                <div className="space-y-default">
                    <FormField label="Justification" required>
                        <textarea
                            className="input"
                            rows={4}
                            value={justification}
                            onChange={(e) => setJustification(e.target.value)}
                            placeholder="Explain why this control cannot be implemented as designed."
                            data-testid="exception-form-justification"
                        />
                    </FormField>
                    <FormField label="Risk accepted by (user id)" required>
                        <input
                            className="input"
                            value={riskAcceptedByUserId}
                            onChange={(e) =>
                                setRiskAcceptedByUserId(e.target.value)
                            }
                            data-testid="exception-form-risk-acceptor"
                        />
                    </FormField>
                    <FormField label="Compensating control (optional)">
                        <Combobox
                            options={compensatingChoiceOptions}
                            selected={
                                compensatingChoiceOptions.find(
                                    (o) => o.value === compensatingControlId,
                                ) ?? null
                            }
                            setSelected={(opt) =>
                                setCompensatingControlId(
                                    opt ? String(opt.value) : null,
                                )
                            }
                            placeholder="Pick a control that mitigates this gap"
                            data-testid="exception-form-compensating-control"
                        />
                    </FormField>
                    <FormField label="Proposed expiry (optional)">
                        <DatePicker
                            value={expiresAt}
                            onChange={setExpiresAt}
                            clearable
                        />
                    </FormField>
                    {error ? (
                        <p
                            className="text-sm text-content-error"
                            data-testid="exception-form-error"
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
                    disabled={!valid || submit.isPending}
                    data-testid="exception-form-submit"
                >
                    {submit.isPending ? 'Submitting…' : 'Request exception'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

function ApproveDialog({
    apiBase,
    exceptionId,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    exceptionId: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = useMutation({
        mutationFn: async () => {
            setError(null);
            if (!expiresAt) {
                throw new Error('Expiry date is required for approval.');
            }
            const res = await fetch(`${apiBase}/${exceptionId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expiresAt: expiresAt.toISOString(),
                    note: note || undefined,
                }),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to approve exception');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    return (
        <Modal showModal setShowModal={(v) => !v && onClose()}>
            <Modal.Header title="Approve exception" />
            <Modal.Body>
                <div className="space-y-default">
                    <FormField label="Expires on" required>
                        <DatePicker value={expiresAt} onChange={setExpiresAt} />
                    </FormField>
                    <FormField label="Note (optional)">
                        <textarea
                            className="input"
                            rows={2}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Conditions or scope of the approval"
                        />
                    </FormField>
                    {error ? (
                        <p
                            className="text-sm text-content-error"
                            data-testid="exception-approve-error"
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
                    disabled={!expiresAt || submit.isPending}
                    data-testid="exception-approve-submit"
                >
                    {submit.isPending ? 'Approving…' : 'Approve'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

function RejectDialog({
    apiBase,
    exceptionId,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    exceptionId: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = useMutation({
        mutationFn: async () => {
            setError(null);
            const res = await fetch(`${apiBase}/${exceptionId}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to reject exception');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    return (
        <Modal showModal setShowModal={(v) => !v && onClose()}>
            <Modal.Header title="Reject exception" />
            <Modal.Body>
                <FormField label="Reason" required>
                    <textarea
                        className="input"
                        rows={3}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this exception being rejected?"
                        data-testid="exception-reject-reason"
                    />
                </FormField>
                {error ? (
                    <p
                        className="mt-3 text-sm text-content-error"
                        data-testid="exception-reject-error"
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
                    onClick={() => submit.mutate()}
                    disabled={!reason.trim() || submit.isPending}
                    data-testid="exception-reject-submit"
                >
                    {submit.isPending ? 'Rejecting…' : 'Reject'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

function RenewDialog({
    apiBase,
    exceptionId,
    onClose,
    onSuccess,
}: {
    apiBase: string;
    exceptionId: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [error, setError] = useState<string | null>(null);

    const submit = useMutation({
        mutationFn: async () => {
            setError(null);
            const res = await fetch(`${apiBase}/${exceptionId}/renew`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to renew exception');
            }
            return res.json();
        },
        onSuccess,
        onError: (err) =>
            setError(err instanceof Error ? err.message : 'Unknown error'),
    });

    return (
        <Modal showModal setShowModal={(v) => !v && onClose()}>
            <Modal.Header title="Renew exception" />
            <Modal.Body>
                <p className="text-sm text-content-muted">
                    Creates a new exception in <strong>REQUESTED</strong> state with
                    the same justification + compensating control as this one.
                    The original record is preserved as part of the audit trail.
                    An admin will need to approve the renewal before it takes
                    effect.
                </p>
                {error ? (
                    <p
                        className="mt-3 text-sm text-content-error"
                        data-testid="exception-renew-error"
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
                    onClick={() => submit.mutate()}
                    disabled={submit.isPending}
                    data-testid="exception-renew-submit"
                >
                    {submit.isPending ? 'Renewing…' : 'Renew'}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
