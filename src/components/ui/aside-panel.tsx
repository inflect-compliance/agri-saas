'use client';

/**
 * `<AsidePanel>` — the right-rail / aside-panel primitive.
 *
 * Right-rail roadmap, Phase 1 (see `docs/right-rail-aside-roadmap.md`).
 * The fourth chrome posture: persistent + co-resident context that
 * stays visible while the user works in the main content — distinct
 * from a tab (exclusive), a `<Sheet>` (transient overlay) and a
 * `<Modal>` (blocking).
 *
 * Responsive — content is written ONCE, the container differs:
 *   - ≥ xl (1280px): a docked column. Two states, persisted per
 *     `surfaceKey` in localStorage — expanded (320px, full panel)
 *     or collapsed-to-spine (a 44px rail with an expand affordance).
 *   - < xl: the docked column is hidden; the same `children` open
 *     in a `<Sheet>` from a compact trigger. No mobile rail, no
 *     second copy of the content.
 *
 * State ownership: this primitive owns the collapse state (the
 * "chrome"); the consuming page owns `children` (the "content") —
 * the same shell-owns-layout / page-owns-content split as
 * `EntityDetailLayout`.
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@dub/utils';

import { ChevronLeft } from '@/components/ui/icons/nucleo/chevron-left';
import { ChevronRight } from '@/components/ui/icons/nucleo/chevron-right';
import { cardVariants } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { useLocalStorage } from '@/components/ui/hooks';

export interface AsidePanelProps {
    /** Panel heading — also the Sheet's accessible title below xl. */
    title: string;
    /**
     * Stable key for this rail surface. The expand/collapse state is
     * persisted under `aside:collapsed:<surfaceKey>` so each surface
     * (a control detail page, the risks list, …) remembers
     * independently.
     */
    surfaceKey: string;
    /**
     * Optional icon node shown beside the title and in the spine.
     * A node (not an icon component) so callers pass the repo's own
     * `<AppIcon>` / Nucleo icons without this primitive coupling to
     * one icon family.
     */
    icon?: ReactNode;
    /** Rail content — rendered once, in the docked panel or the Sheet. */
    children: ReactNode;
}

const ICON_BUTTON_CLASS =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

export function AsidePanel({
    title,
    surfaceKey,
    icon,
    children,
}: AsidePanelProps) {
    const [collapsed, setCollapsed] = useLocalStorage<boolean>(
        `aside:collapsed:${surfaceKey}`,
        false,
    );
    const [sheetOpen, setSheetOpen] = useState(false);

    return (
        <>
            {/* ── ≥ xl — docked column ───────────────────────────── */}
            {collapsed ? (
                <div
                    className="hidden xl:flex w-11 flex-shrink-0 flex-col items-center gap-tight rounded-lg border border-border-subtle bg-bg-default py-2"
                    data-testid="aside-panel-spine"
                    data-aside-collapsed="true"
                >
                    <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        className={ICON_BUTTON_CLASS}
                        aria-label={`Expand ${title} panel`}
                        aria-expanded={false}
                    >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {icon && (
                        <span className="text-content-subtle" aria-hidden="true">
                            {icon}
                        </span>
                    )}
                </div>
            ) : (
                <div
                    className={cn(
                        cardVariants({ density: 'none' }),
                        'hidden xl:flex w-[320px] flex-shrink-0 flex-col',
                    )}
                    data-testid="aside-panel-docked"
                    data-aside-collapsed="false"
                >
                    <div className="flex items-center justify-between gap-tight border-b border-border-subtle px-3 py-2">
                        <span className="flex items-center gap-tight text-sm font-semibold text-content-emphasis">
                            {icon && (
                                <span
                                    className="text-content-muted"
                                    aria-hidden="true"
                                >
                                    {icon}
                                </span>
                            )}
                            {title}
                        </span>
                        <button
                            type="button"
                            onClick={() => setCollapsed(true)}
                            className={ICON_BUTTON_CLASS}
                            aria-label={`Collapse ${title} panel`}
                            aria-expanded
                        >
                            <ChevronRight
                                className="h-4 w-4"
                                aria-hidden="true"
                            />
                        </button>
                    </div>
                    <div className="min-h-0 overflow-y-auto p-3">{children}</div>
                </div>
            )}

            {/* ── < xl — Sheet fallback ──────────────────────────── */}
            <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="xl:hidden inline-flex items-center gap-tight rounded-full border border-border-subtle bg-bg-default px-3 py-1.5 text-xs font-medium text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                data-testid="aside-panel-sheet-trigger"
            >
                {icon && <span aria-hidden="true">{icon}</span>}
                {title}
            </button>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={title}>
                <Sheet.Header>
                    <Sheet.Title>{title}</Sheet.Title>
                </Sheet.Header>
                <Sheet.Body>{children}</Sheet.Body>
            </Sheet>
        </>
    );
}
