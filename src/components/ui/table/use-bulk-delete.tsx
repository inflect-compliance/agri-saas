"use client";

/**
 * useBulkDelete — the shared "Delete selected" action-row affordance.
 *
 * Adopts the inflect-compliance bulk-delete UX onto agri-saas's existing
 * DataTable selection machinery. A table that wants bulk delete:
 *
 *   const { batchAction, dialog } = useBulkDelete<Row>({
 *     entitySingular: "invitation",
 *     entityPlural: "invitations",
 *     onDelete: async (ids) => { await apiPost(url('/.../bulk/delete'), { ids }); await mutate(); },
 *   });
 *   // ...
 *   <DataTable
 *     getRowId={(r) => r.id}              // REQUIRED for selection
 *     batchActions={[batchAction]}        // (spread alongside any existing batch actions)
 *     ...
 *   />
 *   {dialog}
 *
 * When the operator selects rows, the DataTable's SelectionToolbar (the
 * "action row") renders a danger "Delete" button. Clicking it opens a
 * canonical danger `ConfirmDialog` ("Delete N …?") — the destructive-
 * vocabulary ratchet requires the "Delete" verb. Confirming runs `onDelete`
 * with the selected ids; the dialog shows a pending state until it settles
 * and stays open (so the caller can surface an error) if `onDelete` throws.
 *
 * The actual delete is the caller's bulk endpoint (every entity has a
 * tenant-scoped, permission-gated `/.../bulk/delete` route + usecase); this
 * hook owns only the selection→confirm→fire UX, never the mutation.
 */

import { useState, type ReactNode } from "react";
import type { Row } from "@tanstack/react-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Trash } from "@/components/ui/icons/nucleo";
import type { BatchAction } from "./selection-toolbar";

export interface UseBulkDeleteOptions<T> {
    /** Singular entity noun, e.g. "invitation" (used when one row is selected). */
    entitySingular: string;
    /** Plural entity noun, e.g. "invitations". */
    entityPlural: string;
    /** Perform the delete for the selected row ids. Throw to keep the dialog open. */
    onDelete: (ids: string[]) => Promise<void> | void;
    /**
     * Extract the stable id from a selected row. Defaults to reading
     * `row.original.id`, which fits every entity whose row carries an `id`.
     */
    getId?: (row: Row<T>) => string;
    /**
     * Button + confirm verb. Defaults to "Delete". Constrained to the
     * canonical destructive verbs (locked by the destructive-vocabulary
     * ratchet) so a bulk action can never ship an ambiguous label. Use
     * "Revoke" for credentials/invitations, "Remove" for detach-from-parent,
     * "Archive" for soft-archive.
     */
    verb?: "Delete" | "Remove" | "Revoke" | "Archive" | "Discard";
    /** Override the confirm dialog body. */
    description?: ReactNode;
}

export interface UseBulkDeleteResult<T> {
    /** Spread into the DataTable `batchActions` array. */
    batchAction: BatchAction<T>;
    /**
     * Open the confirm dialog for an explicit id set. For tables that drive
     * selection through a custom `selectionControls` bar (not `batchActions`)
     * and already hold the selected ids themselves.
     */
    triggerByIds: (ids: string[]) => void;
    /** Render once near the table — the confirm dialog. */
    dialog: ReactNode;
    /** Number of rows queued for deletion (while the dialog is open). */
    pendingCount: number;
}

export function useBulkDelete<T>({
    entitySingular,
    entityPlural,
    onDelete,
    getId,
    verb = "Delete",
    description,
}: UseBulkDeleteOptions<T>): UseBulkDeleteResult<T> {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState<string[]>([]);

    const extractId =
        getId ?? ((row: Row<T>) => (row.original as { id: string }).id);

    const triggerByIds = (ids: string[]) => {
        setPending(ids);
        setOpen(true);
    };

    const batchAction: BatchAction<T> = {
        label: verb,
        variant: "danger",
        icon: <Trash className="size-3.5" aria-hidden="true" />,
        onClick: (rows) => triggerByIds(rows.map(extractId)),
    };

    const count = pending.length;
    const noun = count === 1 ? entitySingular : entityPlural;

    const dialog = (
        <ConfirmDialog
            showModal={open}
            setShowModal={setOpen}
            tone="danger"
            title={`${verb} ${count} ${noun}?`}
            description={
                description ??
                `This removes the selected ${noun} from your workspace. This can’t be undone.`
            }
            confirmLabel={verb}
            onConfirm={async () => {
                await onDelete(pending);
            }}
        />
    );

    return { batchAction, triggerByIds, dialog, pendingCount: count };
}
