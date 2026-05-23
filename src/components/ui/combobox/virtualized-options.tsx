"use client";

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic 68 — `<VirtualizedComboboxOptions>`.
 *
 * Drop-in replacement for the cmdk-driven option list inside Combobox
 * when the option count exceeds the threshold. Renders ONLY the
 * visible window of options (via the shared `<VirtualizedList>`),
 * with a bespoke keyboard-navigation layer that mirrors cmdk's
 * behaviour: ArrowDown / ArrowUp move the active option, Enter
 * selects, Home / End jump to extremes, scroll-to-active keeps the
 * active option in view.
 *
 * Why we bypass cmdk for large lists:
 *   - cmdk navigates via DOM walks (`querySelector` over the rendered
 *     `[cmdk-item]` set). With virtualization most options aren't in
 *     the DOM, so cmdk's nav silently dead-ends at the visible edge.
 *   - cmdk's `data-selected` highlight relies on items being mounted.
 *     Out-of-window items can't carry that attribute.
 *
 * What we DO keep from cmdk: the `<Command>` wrapper around the
 * popover (so Escape / click-outside / focus trapping still flow
 * through cmdk) and the `<Command.Input>` for the search field. Only
 * the option list itself changes.
 *
 * Accessibility:
 *   - The list carries `role="listbox"` + `aria-activedescendant`
 *     pointing at the active option's stable id.
 *   - Each option carries `role="option"` + `aria-selected`.
 *   - The active option also carries the `data-active="true"`
 *     attribute so the existing `data-active:` Tailwind variants on
 *     consumer-supplied row classes still apply.
 *   - Keyboard handler is attached to the SEARCH INPUT element (via
 *     `searchInputRef`) — that's where focus lives while the popover
 *     is open. We use a CAPTURE-phase listener so we run BEFORE
 *     cmdk's own keydown handler and call `stopPropagation()` for
 *     keys we own.
 *
 * Threshold — `COMBOBOX_VIRTUALIZE_THRESHOLD` is exported so the
 * Combobox call site and the structural ratchet read the same value.
 */

import * as React from "react";
import { cn } from "@dub/utils";

import {
    VirtualizedList,
    type VirtualizedListHandle,
} from "@/components/ui/virtualized-list";

import {
    Check2,
    CheckboxCheckedFill,
    CheckboxUnchecked,
    type Icon,
} from "../icons";
import { Tooltip } from "../tooltip";
import type { ComboboxOption } from "./index";

/** Auto-virtualize when the visible option count exceeds this. */
export const COMBOBOX_VIRTUALIZE_THRESHOLD = 50;

/**
 * Approximate row height used by react-window's FixedSizeList. Must
 * match the rendered option's actual height — option rows render with
 * `py-2 px-3 text-sm` which is ~36px under the platform tokens. Bump
 * when consumers pass a description (which wraps the row to two
 * lines) — that case is handled inline below.
 */
const SINGLE_LINE_OPTION_HEIGHT = 36;
const TWO_LINE_OPTION_HEIGHT = 56;
/** Max viewport height — matches the legacy ScrollContainer cap. */
const MAX_VIEWPORT_PX = 250;

export interface VirtualizedComboboxOptionsProps<TMeta> {
    options: ComboboxOption<TMeta>[];
    selected: ComboboxOption<TMeta>[];
    onSelect: (option: ComboboxOption<TMeta>) => void;
    multiple: boolean;
    maxSelected?: number;
    optionRight?: (option: ComboboxOption<TMeta>) => React.ReactNode;
    optionDescription?: (option: ComboboxOption<TMeta>) => React.ReactNode;
    optionClassName?: string;
    /**
     * Ref to the search `<input>`. We attach a capture-phase keydown
     * listener here so ArrowDown / ArrowUp / Enter / Home / End are
     * handled by US, not by cmdk's nav (which assumes the items live
     * in the DOM).
     */
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    /** Stable id prefix for `aria-activedescendant`. */
    listboxId?: string;
}

export function VirtualizedComboboxOptions<TMeta>({
    options,
    selected,
    onSelect,
    multiple,
    maxSelected,
    optionRight,
    optionDescription,
    optionClassName,
    searchInputRef,
    listboxId = "combobox-virt",
}: VirtualizedComboboxOptionsProps<TMeta>) {
    const [activeIndex, setActiveIndex] = React.useState(0);
    const listRef = React.useRef<VirtualizedListHandle>(null);

    // Reset active index when the options list changes shape (search
    // typed/cleared). Going to 0 mirrors cmdk's "select first match"
    // behaviour.
    const optionsLength = options.length;
    const optionsKey = options.map((o) => o.value).join(",");
    React.useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveIndex(0);

    }, [optionsKey]);

    // Selection helper — `selected.some(...)` per row would be O(n*s);
    // memoise into a Set for the duration of the render.
    const selectedSet = React.useMemo(
        () => new Set(selected.map((o) => o.value)),
        [selected],
    );

    // Keyboard handler attached to the search input via capture-phase
    // — runs BEFORE cmdk's own input keydown so cmdk doesn't process
    // ArrowDown / ArrowUp / Enter and stomp our state.
    React.useEffect(() => {
        const input = searchInputRef.current;
        if (!input) return;
        const handler = (e: KeyboardEvent) => {
            if (optionsLength === 0) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex((i) => Math.min(i + 1, optionsLength - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Home") {
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex(0);
            } else if (e.key === "End") {
                e.preventDefault();
                e.stopPropagation();
                setActiveIndex(optionsLength - 1);
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const opt = options[activeIndex];
                if (!opt) return;
                if (opt.disabledTooltip) return;
                if (
                    !multiple &&
                    !selectedSet.has(opt.value) &&
                    typeof maxSelected === "number" &&
                    selected.length >= maxSelected
                ) {
                    return;
                }
                onSelect(opt);
            }
        };
        // Capture phase so we beat cmdk to the keystroke.
        input.addEventListener("keydown", handler, true);
        return () => input.removeEventListener("keydown", handler, true);
    }, [
        searchInputRef,
        optionsLength,
        activeIndex,
        options,
        selected,
        selectedSet,
        multiple,
        maxSelected,
        onSelect,
    ]);

    // Auto-scroll to keep the active item visible as the user
    // navigates through options the cmdk nav would have done for us.
    React.useEffect(() => {
        listRef.current?.scrollToItem(activeIndex);
    }, [activeIndex]);

    // Item height — uniform per consumer-supplied `optionDescription`.
    // We sample once for the typical case; if a future consumer needs
    // mixed-height rows they can extend this primitive to take a
    // function for itemSize.
    const itemSize = optionDescription
        ? TWO_LINE_OPTION_HEIGHT
        : SINGLE_LINE_OPTION_HEIGHT;

    // Cap viewport at MAX_VIEWPORT_PX, but show fewer rows when there
    // are fewer options. Matches the legacy ScrollContainer cap.
    const viewportHeight = Math.min(
        MAX_VIEWPORT_PX,
        Math.max(itemSize, optionsLength * itemSize),
    );

    // Empty state — match the existing data-combobox-empty contract.
    if (optionsLength === 0) {
        return (
            <div
                className="text-content-subtle flex min-h-12 items-center justify-center text-sm"
                data-combobox-empty
            />
        );
    }

    return (
        <div
            role="listbox"
            id={listboxId}
            aria-activedescendant={`${listboxId}-${activeIndex}`}
            data-virtualized-combobox=""
        >
            <VirtualizedList
                ref={listRef}
                itemCount={optionsLength}
                itemSize={itemSize}
                height={viewportHeight}
                width="100%"
                overscanCount={5}
                renderItem={({ index, style }) => {
                    const option = options[index]!;
                    const isSelected = selectedSet.has(option.value);
                    const isActive = index === activeIndex;
                    const isDisabled = Boolean(
                        (!isSelected &&
                            typeof maxSelected === "number" &&
                            selected.length >= maxSelected) ||
                            option.disabledTooltip,
                    );
                    const description = optionDescription?.(option);
                    const right = optionRight?.(option);

                    return (
                        <div style={style} key={option.value}>
                            <DisabledTooltip
                                disabledTooltip={option.disabledTooltip}
                            >
                                <div
                                    role="option"
                                    id={`${listboxId}-${index}`}
                                    aria-selected={isSelected}
                                    aria-disabled={isDisabled || undefined}
                                    data-active={isActive ? "true" : undefined}
                                    data-virtualized-option-index={index}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onMouseDown={(e) => {
                                        // Prevent the search input from
                                        // losing focus when the user
                                        // clicks a row — keystrokes need
                                        // to keep flowing to the input.
                                        e.preventDefault();
                                    }}
                                    onClick={() => {
                                        if (isDisabled) return;
                                        onSelect(option);
                                    }}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-compact rounded-md px-3 py-2 text-left text-sm",
                                        description
                                            ? "whitespace-normal py-2.5"
                                            : "whitespace-nowrap",
                                        isActive && "bg-bg-subtle",
                                        isDisabled &&
                                            "cursor-not-allowed opacity-50",
                                        optionClassName,
                                    )}
                                >
                                    {multiple && (
                                        <div className="text-content-default shrink-0">
                                            {isSelected ? (
                                                <CheckboxCheckedFill className="text-content-default size-4" />
                                            ) : (
                                                <CheckboxUnchecked className="text-content-muted size-4" />
                                            )}
                                        </div>
                                    )}
                                    <div
                                        className={cn(
                                            "flex min-w-0 grow items-center gap-tight",
                                            description &&
                                                "flex-col items-start gap-0.5",
                                        )}
                                    >
                                        {option.icon && (
                                            <span className="text-content-default shrink-0">
                                                {isReactNode(option.icon) ? (
                                                    (option.icon as React.ReactNode)
                                                ) : (
                                                    React.createElement(
                                                        option.icon as Icon,
                                                        { className: "h-4 w-4" },
                                                    )
                                                )}
                                            </span>
                                        )}
                                        <span
                                            className={cn(
                                                "grow",
                                                description
                                                    ? "text-content-emphasis"
                                                    : "text-content-default truncate",
                                            )}
                                        >
                                            {option.label}
                                        </span>
                                        {description && (
                                            <span className="text-content-subtle text-sm">
                                                {description}
                                            </span>
                                        )}
                                    </div>
                                    {right}
                                    {!multiple && isSelected && (
                                        <Check2 className="text-content-default size-4 shrink-0" />
                                    )}
                                </div>
                            </DisabledTooltip>
                        </div>
                    );
                }}
            />
        </div>
    );
}

function DisabledTooltip({
    children,
    disabledTooltip,
}: {
    children: React.ReactNode;
    disabledTooltip?: React.ReactNode;
}) {
    if (!disabledTooltip) return <>{children}</>;
    return (
        <Tooltip content={disabledTooltip}>
            <div>{children}</div>
        </Tooltip>
    );
}

function isReactNode(value: unknown): boolean {
    return React.isValidElement(value);
}
