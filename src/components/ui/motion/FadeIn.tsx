'use client';

/**
 * Small motion layer on the sanctioned `animate-fade-in` token (150ms
 * ease-out). Only opacity animates → no layout shift, GPU-composited
 * (60fps on a mid-range phone). Reduced motion is handled globally by
 * tokens.css (animation-duration → ~1ms), so content simply appears.
 *
 * - <FadeIn>        — fade a subtree in on mount (list add, panel enter).
 * - <SkeletonFade>  — skeleton→content cross-fade: shows the skeleton while
 *                     loading, then fades the real content in. Pass a
 *                     same-sized skeleton so the swap is shift-free.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('animate-fade-in', className)}>{children}</div>;
}

export function SkeletonFade({
    loading,
    skeleton,
    children,
    className,
}: {
    loading: boolean;
    skeleton: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    if (loading) return <div className={className}>{skeleton}</div>;
    return <FadeIn className={className}>{children}</FadeIn>;
}

export default FadeIn;
