import { MyListingsClient } from './MyListingsClient';

/**
 * My listings — the seller's management view (offers I've posted + their
 * inquiries). Module gate is inherited from the exchange group layout.
 */
export default function MyListingsPage() {
    return <MyListingsClient />;
}
