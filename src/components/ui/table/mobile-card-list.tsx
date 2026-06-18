"use client";

/**
 * MobileCardList — the phone (<sm) fallback for <DataTable mobileFallback="card">.
 *
 * A horizontally-scrolling table is unusable on a 390px phone. This
 * renders each row as a full-width, tappable CARD instead: a title, an
 * optional subtitle, an optional status pill (top-right), and a few
 * key/value "meta" rows — then the whole card taps through to the row's
 * detail via the table's existing `onRowClick`.
 *
 * The card is NOT a second column config. It reuses the SAME TanStack
 * column cell renderers (so status pills, formatted dates, etc. carry
 * over verbatim) and is driven entirely by `column.meta.mobileCard`:
 *
 *   meta: { mobileCard: { slot: 'title' } }                 // heading
 *   meta: { mobileCard: { slot: 'status' } }                // pill, top-right
 *   meta: { mobileCard: { slot: 'subtitle' } }              // secondary line
 *   meta: { mobileCard: { slot: 'meta', label: 'Due' } }    // key/value row
 *
 * Columns with no `mobileCard` meta (select, actions, dense numeric
 * columns) are simply omitted from the card — keep the card to the 3–4
 * fields that matter in the field.
 *
 * Cells tagged for the card MUST render display-only content (text,
 * status pill, formatted value) — the whole card is the tap target, so a
 * nested link/button would be an interactive-in-interactive a11y trap.
 */
import {
  flexRender,
  type Cell,
  type Row,
  type RowData,
  type Table as TableType,
} from "@tanstack/react-table";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "./table-utils";

// ── Column-meta augmentation ────────────────────────────────────────
// Adds the `mobileCard` slot descriptor to every TanStack column's
// `meta`. Global augmentation — importing this module (DataTable does)
// makes the typed `meta.mobileCard` available everywhere.
declare module "@tanstack/react-table" {
  // The generic signature must match TanStack's own `ColumnMeta<TData, TValue>`
  // for the augmentation to merge; the params are unused by this member.
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Placement of this column inside the mobile (<sm) fallback card.
     * Absent ⇒ the column is omitted from the card.
     */
    mobileCard?: {
      /**
       * - `title`    — the card heading (first match wins).
       * - `subtitle` — a secondary line under the title.
       * - `status`   — a status pill anchored top-right (first match wins).
       * - `meta`     — a key/value detail row (any number, in column order).
       */
      slot: "title" | "subtitle" | "status" | "meta";
      /** Label for a `meta` row's key. Falls back to the column's string header. */
      label?: string;
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cardSlot<T>(cell: Cell<T, unknown>) {
  return cell.column.columnDef.meta?.mobileCard?.slot;
}

/** Best-effort label for a `meta` row: explicit meta label → string header → "". */
function metaLabel<T>(cell: Cell<T, unknown>): string {
  const explicit = cell.column.columnDef.meta?.mobileCard?.label;
  if (explicit) return explicit;
  const header = cell.column.columnDef.header;
  return typeof header === "string" ? header : "";
}

// ── Component ───────────────────────────────────────────────────────

export interface MobileCardListProps<T> {
  table: TableType<T>;
  onRowClick?: (row: Row<T>, e: MouseEvent) => void;
  loading?: boolean;
  error?: string;
  emptyState?: ReactNode;
  /** Extra classes on the outer <ul>/state wrapper (e.g. `sm:hidden`). */
  className?: string;
}

export function MobileCardList<T>({
  table,
  onRowClick,
  loading,
  error,
  emptyState,
  className,
}: MobileCardListProps<T>) {
  const rows = table.getRowModel().rows;

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          "rounded-lg border border-border-error bg-bg-error px-4 py-3 text-sm text-content-error",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <ul className={cn("space-y-default", className)} aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="h-20 animate-pulse rounded-lg border border-border-subtle bg-bg-subtle"
          />
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={className}>
        {emptyState ?? (
          <p className="px-4 py-8 text-center text-sm text-content-muted">
            No results.
          </p>
        )}
      </div>
    );
  }

  return (
    <ul
      className={cn("space-y-default", className)}
      data-testid="mobile-card-list"
    >
      {rows.map((row) => {
        const cells = row.getVisibleCells();
        const titleCell = cells.find((c) => cardSlot(c) === "title");
        const statusCell = cells.find((c) => cardSlot(c) === "status");
        const subtitleCell = cells.find((c) => cardSlot(c) === "subtitle");
        const metaCells = cells.filter((c) => cardSlot(c) === "meta");
        const clickable = !!onRowClick;

        return (
          <li key={row.id}>
            {/* A clickable card is a `<div role="button">`, NOT a real
                <button>: some title cells embed a same-destination <Link>
                (Tasks/Journal), and `<button><a>` is invalid HTML. A div
                can legally contain a link; Enter/Space are wired manually
                for keyboard parity. Non-clickable rows (no detail route)
                render a plain, non-interactive card. */}
            <div
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? (e) => onRowClick!(row, e) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick!(row, e as unknown as MouseEvent);
                      }
                    }
                  : undefined
              }
              data-testid="mobile-card"
              className={cn(
                "flex w-full flex-col gap-tight rounded-lg border border-border-default bg-bg-default p-4 text-left",
                clickable
                  ? "min-h-[44px] cursor-pointer transition-colors hover:bg-bg-muted active:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
                  : "",
              )}
            >
              <div className="flex items-start justify-between gap-default">
                <div className="min-w-0 break-words font-medium text-content-emphasis">
                  {titleCell
                    ? flexRender(
                        titleCell.column.columnDef.cell,
                        titleCell.getContext(),
                      )
                    : null}
                </div>
                {statusCell ? (
                  <div className="shrink-0">
                    {flexRender(
                      statusCell.column.columnDef.cell,
                      statusCell.getContext(),
                    )}
                  </div>
                ) : null}
              </div>

              {subtitleCell ? (
                <div className="min-w-0 break-words text-sm text-content-muted">
                  {flexRender(
                    subtitleCell.column.columnDef.cell,
                    subtitleCell.getContext(),
                  )}
                </div>
              ) : null}

              {metaCells.length > 0 ? (
                <dl className="mt-tight space-y-tight">
                  {metaCells.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-baseline justify-between gap-default text-sm"
                    >
                      <dt className="shrink-0 text-content-subtle">
                        {metaLabel(c)}
                      </dt>
                      <dd className="min-w-0 break-words text-right text-content-default">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default MobileCardList;
