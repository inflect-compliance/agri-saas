'use client';

import { useState } from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Client component for billing actions.
 * Handles POST to checkout/portal routes and redirects to Stripe.
 */
export function BillingActions({
    plan,
    portal,
    tenantSlug,
}: {
    plan?: 'PRO' | 'ENTERPRISE';
    portal?: boolean;
    tenantSlug: string;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleCheckout() {
        if (!plan) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/t/${tenantSlug}/billing/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const { url } = await res.json();
            window.location.href = url;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
            setLoading(false);
        }
    }

    async function handlePortal() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/t/${tenantSlug}/billing/portal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed (${res.status})`);
            }
            const { url } = await res.json();
            window.location.href = url;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
            setLoading(false);
        }
    }

    if (portal) {
        return (
            <div>
                <Button
                    variant="primary"
                    onClick={handlePortal}
                    disabled={loading}
                    loading={loading}
                    id="billing-portal-btn"
                >
                    {!loading && <ExternalLink className="w-4 h-4" />}
                    Manage Billing
                </Button>
                {error && <p className="text-xs text-content-error mt-2">{error}</p>}
            </div>
        );
    }

    return (
        <div>
            <Button
                variant={plan === 'ENTERPRISE' ? 'secondary' : 'primary'}
                onClick={handleCheckout}
                disabled={loading}
                loading={loading}
                id={`billing-upgrade-${plan?.toLowerCase()}-btn`}
            >
                {!loading && <CreditCard className="w-4 h-4" />}
                Upgrade to {plan}
            </Button>
            {error && <p className="text-xs text-content-error mt-2">{error}</p>}
        </div>
    );
}
