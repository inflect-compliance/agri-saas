"use client";

import { cn } from "@dub/utils";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CircleCheck,
  CircleHalfDottedCheck,
  CircleHalfDottedClock,
  CircleInfo,
  CircleWarning,
  Icon,
} from "./icons";
import { DynamicTooltipWrapper } from "./tooltip";

const statusBadgeVariants = cva(
  "inline-flex gap-1.5 items-center max-w-fit rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-bg-subtle text-content-muted",
        info: "bg-bg-info text-content-info",
        success: "bg-bg-success text-content-success",
        pending: "bg-bg-attention text-content-attention",
        warning: "bg-bg-warning text-content-warning",
        error: "bg-bg-error text-content-error",
        // Subtle variants — neutral surface with status-tinted text only.
        // For tertiary status displays (draft / low-risk / passive states)
        // where the standard variant would feel too loud.
        "info-subtle": "bg-bg-subtle text-content-info",
        "success-subtle": "bg-bg-subtle text-content-success",
        "warning-subtle": "bg-bg-subtle text-content-warning",
        "error-subtle": "bg-bg-subtle text-content-error",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px]",
        md: "px-2 py-1 text-xs",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  },
);

const defaultIcons: Record<string, Icon> = {
  neutral: CircleInfo,
  info: CircleHalfDottedCheck,
  success: CircleCheck,
  pending: CircleHalfDottedClock,
  warning: CircleWarning,
  error: CircleWarning,
  "info-subtle": CircleHalfDottedCheck,
  "success-subtle": CircleCheck,
  "warning-subtle": CircleWarning,
  "error-subtle": CircleWarning,
};

interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  icon?: Icon | null;
  tooltip?: string | React.ReactNode;
}

function StatusBadge({
  className,
  variant,
  size,
  icon,
  tooltip,
  onClick,
  children,
  ...props
}: StatusBadgeProps) {
  const ResolvedIcon =
    icon !== null ? icon ?? defaultIcons[variant ?? "neutral"] : null;

  return (
    <DynamicTooltipWrapper
      tooltipProps={tooltip ? { content: tooltip } : undefined}
    >
      <span
        className={cn(
          statusBadgeVariants({ variant, size }),
          tooltip && "cursor-help",
          onClick &&
            "cursor-pointer select-none transition-[filter] duration-150 hover:brightness-75 hover:saturate-[1.25]",
          className,
        )}
        onClick={onClick}
        {...props}
      >
        {ResolvedIcon && <ResolvedIcon className="h-3 w-3 shrink-0" />}
        {children}
      </span>
    </DynamicTooltipWrapper>
  );
}

export { StatusBadge, statusBadgeVariants };
export type { StatusBadgeProps };
