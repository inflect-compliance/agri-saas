"use client";

/**
 * Fab — mobile floating action button (mobile-forms PR-3).
 *
 * The one-tap launcher for a list page's PRIMARY create action on phones
 * (New Task, Start Field Operation, New Journal entry). `md:hidden` — on
 * desktop the page header's create button is the affordance. Anchored
 * bottom-right ABOVE the fixed bottom-tab bar (≈56px) + the device safe
 * area, below modals (z-30, same tier as the bar but never overlapping
 * it). Wire `onClick` to the SAME handler the header create button calls.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface FabProps {
  /** Fires the page's primary create flow (e.g. opens the create modal). */
  onClick: () => void;
  /** The glyph (e.g. `<Plus aria-hidden />`). Decorative — labelled below. */
  icon?: ReactNode;
  /** Accessible name (e.g. "New Task"). Required. */
  label: string;
  className?: string;
}

export function Fab({ onClick, icon, label, className }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid="fab"
      className={cn(
        // Mobile-only, anchored above the bottom-tab bar + safe area.
        "md:hidden fixed right-4 z-30",
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)]",
        // 56px circular target (well over the 44px floor).
        "inline-flex h-14 w-14 items-center justify-center rounded-full",
        "bg-[var(--brand-default)] text-content-inverted shadow-lg",
        "transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:translate-y-px motion-reduce:active:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
        className,
      )}
    >
      {icon}
    </button>
  );
}

export default Fab;
