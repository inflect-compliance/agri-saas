import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Root page: redirects authenticated users to their default tenant dashboard.
 * Unauthenticated users are redirected to /login by middleware.
 */
export default async function Home() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/login');
    }

    // R-1: send to /tenants picker which handles 0/1/>1 memberships correctly.
    redirect('/tenants');
}
