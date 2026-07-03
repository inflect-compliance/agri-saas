import { ExchangeClient } from './ExchangeClient';

/**
 * Exchange main page — a map of Bulgaria showing every tenant's P2P offers,
 * with a synced, filterable offer list. Browse-only in this iteration
 * (create + inquiry land in a follow-up). Data is fetched client-side from
 * `/api/t/<slug>/exchange/listings`; the module gate lives in the sibling
 * `layout.tsx`.
 */
export default function ExchangePage() {
    return <ExchangeClient />;
}
