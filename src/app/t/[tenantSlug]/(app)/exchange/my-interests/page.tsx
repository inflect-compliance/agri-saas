import { MyInterestsClient } from './MyInterestsClient';

/**
 * My interests — the buyer's outbox (offers I've reached out to). Module gate
 * is inherited from the exchange group layout.
 */
export default function MyInterestsPage() {
    return <MyInterestsClient />;
}
