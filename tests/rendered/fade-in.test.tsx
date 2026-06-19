/**
 * FadeIn / SkeletonFade — the small motion layer on the sanctioned
 * animate-fade-in token. FadeIn wraps children with the class; SkeletonFade
 * shows the skeleton while loading then swaps to the faded-in content.
 */
import { render, screen } from '@testing-library/react';
import { FadeIn, SkeletonFade } from '@/components/ui/motion/FadeIn';

describe('FadeIn / SkeletonFade', () => {
    it('FadeIn renders children inside an animate-fade-in wrapper', () => {
        render(
            <FadeIn>
                <span data-testid="child">hi</span>
            </FadeIn>,
        );
        const child = screen.getByTestId('child');
        expect(child).toBeInTheDocument();
        expect(child.parentElement).toHaveClass('animate-fade-in');
    });

    it('SkeletonFade shows the skeleton while loading, then the content', () => {
        const { rerender } = render(
            <SkeletonFade loading skeleton={<span data-testid="sk" />}>
                <span data-testid="content" />
            </SkeletonFade>,
        );
        expect(screen.getByTestId('sk')).toBeInTheDocument();
        expect(screen.queryByTestId('content')).not.toBeInTheDocument();

        rerender(
            <SkeletonFade loading={false} skeleton={<span data-testid="sk" />}>
                <span data-testid="content" />
            </SkeletonFade>,
        );
        expect(screen.getByTestId('content')).toBeInTheDocument();
        expect(screen.queryByTestId('sk')).not.toBeInTheDocument();
        expect(screen.getByTestId('content').parentElement).toHaveClass('animate-fade-in');
    });
});
