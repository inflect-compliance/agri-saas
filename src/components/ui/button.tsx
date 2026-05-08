"use client";

import { cn } from "@dub/utils";
import { VariantProps } from "class-variance-authority";
import { ReactNode, forwardRef } from "react";
import { LoadingSpinner } from "./icons";
import { Tooltip } from "./tooltip";
import { buttonVariants } from "./button-variants";

export { buttonVariants };

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  text?: ReactNode | string;
  textWrapperClassName?: string;
  shortcutClassName?: string;
  loading?: boolean;
  icon?: ReactNode;
  shortcut?: string;
  right?: ReactNode;
  disabledTooltip?: string | ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      text,
      variant = "primary",
      size,
      className,
      textWrapperClassName,
      shortcutClassName,
      loading,
      icon,
      shortcut,
      disabledTooltip,
      right,
      children,
      ...props
    }: ButtonProps,
    forwardedRef,
  ) => {
    const content = text ?? children;

    if (disabledTooltip) {
      return (
        <Tooltip content={disabledTooltip}>
          <div
            className={cn(
              "flex items-center justify-center gap-x-2 cursor-not-allowed",
              "rounded-lg border border-border-subtle bg-bg-subtle px-4 text-sm text-content-subtle",
              size === "xs" && "h-7 text-[11px]",
              size === "sm" && "h-8 text-xs",
              size === "lg" && "h-10",
              !size && "h-9",
              className,
            )}
          >
            {icon}
            {content && (
              <div
                className={cn(
                  "min-w-0 truncate",
                  shortcut && "flex-1 text-left",
                  textWrapperClassName,
                )}
              >
                {content}
              </div>
            )}
            {shortcut && (
              <kbd
                className={cn(
                  "hidden rounded border border-border-subtle bg-bg-subtle px-2 py-0.5 text-xs font-light text-content-subtle md:inline-block",
                  shortcutClassName,
                )}
              >
                {shortcut}
              </kbd>
            )}
          </div>
        </Tooltip>
      );
    }

    return (
      <button
        ref={forwardedRef}
        type={props.onClick ? "button" : "submit"}
        className={cn(
          props.disabled || loading
            ? cn(
                "flex items-center justify-center gap-2 whitespace-nowrap",
                "rounded-lg border border-border-subtle bg-bg-subtle text-content-subtle",
                "cursor-not-allowed outline-none text-sm font-medium",
                size === "xs" && "h-7 px-2.5 text-[11px] gap-1 rounded-md",
                size === "sm" && "h-8 px-3 text-xs gap-1.5",
                size === "lg" && "h-10 px-5 gap-2",
                !size && "h-9 px-3.5 gap-2",
              )
            : buttonVariants({ variant, size }),
          className,
        )}
        disabled={props.disabled || loading}
        {...props}
      >
        {loading ? <LoadingSpinner className="h-4 w-4" /> : icon ? icon : null}
        {content && (
          <div
            className={cn(
              "min-w-0 truncate",
              shortcut && "flex-1 text-left",
              textWrapperClassName,
            )}
          >
            {content}
          </div>
        )}
        {shortcut && (
          <kbd
            className={cn(
              "hidden rounded px-2 py-0.5 text-xs font-light transition-all duration-75 md:inline-block",
              {
                "bg-[var(--brand-default)] text-white/70 group-hover:bg-[var(--brand-muted)]":
                  variant === "primary",
                "bg-bg-elevated text-content-muted":
                  variant === "secondary" || variant === "outline",
                "bg-bg-muted text-content-muted": variant === "ghost",
                "bg-black/25 text-white/80":
                  variant === "danger" || variant === "success",
              },
              shortcutClassName,
            )}
          >
            {shortcut}
          </kbd>
        )}
        {right}
      </button>
    );
  },
);

Button.displayName = "Button";

export { Button };
