/**
 * Card primitive — render tests (PR-6).
 *
 * Locks the contract for `<Card density>` so the canonical density
 * scale (comfortable / compact / none) can't drift silently.
 */
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { Card } from '@/components/ui/card';

describe('Card', () => {
  it('renders glass-card with the comfortable padding by default', () => {
    render(
      <Card data-testid="card">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveClass('glass-card');
    expect(el).toHaveClass('p-6');
  });

  it('renders compact density', () => {
    render(
      <Card density="compact" data-testid="card">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveClass('glass-card');
    expect(el).toHaveClass('p-4');
  });

  it('renders no-padding density', () => {
    render(
      <Card density="none" data-testid="card">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveClass('glass-card');
    expect(el).not.toHaveClass('p-4');
    expect(el).not.toHaveClass('p-6');
  });

  it('passes additional className through', () => {
    render(
      <Card className="border-border-error" data-testid="card">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveClass('glass-card');
    expect(el).toHaveClass('border-border-error');
  });

  it('renders as the requested element when `as` is provided', () => {
    render(
      <Card as="section" data-testid="card-section">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card-section');
    expect(el.tagName).toBe('SECTION');
  });

  it('forwards arbitrary HTML attributes', () => {
    render(
      <Card id="card-1" aria-label="Risk summary" data-testid="card">
        Body
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el).toHaveAttribute('id', 'card-1');
    expect(el).toHaveAttribute('aria-label', 'Risk summary');
  });
});
