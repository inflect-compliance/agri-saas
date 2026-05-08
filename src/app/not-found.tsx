import Link from 'next/link';

/**
 * Global Not Found Boundary (404).
 * Replaces the default Next.js unbranded 404 page.
 */
export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="text-content-info dark:text-content-info font-bold text-6xl tracking-tighter">
                    404
                </div>

                <div>
                    <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">
                        Page not found
                    </h2>
                    <p className="text-base text-gray-500 dark:text-gray-400">
                        Sorry, we couldn&apos;t find the page you&apos;re looking for. It might have been removed or the link is incorrect.
                    </p>
                </div>

                <div className="pt-6">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-bg-info-emphasis hover:bg-bg-info-emphasis focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--border-info)]0 transition-all shadow-sm"
                    >
                        Return to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}
