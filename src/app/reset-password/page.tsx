'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Input } from '@/components/ui/input';
import { Heading } from '@/components/ui/typography';

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const token = searchParams?.get('token') ?? '';

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');

        if (!newPassword || !confirmPassword) {
            setError('Please fill in both password fields.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('The two passwords do not match.');
            return;
        }
        if (newPassword.length < 8) {
            setError('Your new password must be at least 8 characters long.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword }),
            });
            if (res.ok) {
                window.location.href = '/login?reset=success';
                return;
            }
            const data = await res.json().catch(() => ({}));
            setError(typeof data?.error === 'string' ? data.error : 'Could not reset your password.');
        } catch {
            setError('Could not reset your password.');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg-page p-4">
            {/* Background effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-[var(--brand-default)]/10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-[var(--brand-emphasis)]/10 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8 animate-fadeIn">
                    <div className="inline-flex items-center gap-tight mb-2">
                        <div className="w-10 h-10 rounded-lg bg-[var(--brand-default)] flex items-center justify-center">
                            <svg className="w-6 h-6 text-content-inverted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Form */}
                <Card className="animate-fadeIn">
                    <Heading level={2} className="mb-6">
                        Choose a new password
                    </Heading>

                    {!token ? (
                        <>
                            <InlineNotice variant="warning" className="mb-4" icon={null}>
                                This password reset link is invalid. Request a new one from the sign-in page.
                            </InlineNotice>
                            <div className="mt-6 text-center text-sm text-content-muted">
                                <a href="/forgot-password" className="text-content-emphasis underline underline-offset-2 hover:text-[var(--brand-default)]">
                                    Request a new reset link
                                </a>
                            </div>
                        </>
                    ) : (
                        <>
                            {error && (
                                <InlineNotice variant="error" className="mb-4" icon={null}>
                                    {error}
                                </InlineNotice>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-default">
                                <FormField label="New password" required>
                                    <Input
                                        type="password"
                                        name="newPassword"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                        placeholder="At least 8 characters"
                                    />
                                </FormField>
                                <FormField label="Confirm new password" required>
                                    <Input
                                        type="password"
                                        name="confirmPassword"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                        placeholder="Re-enter your new password"
                                    />
                                </FormField>
                                <Button type="submit" variant="primary" size="sm" className="w-full" disabled={loading}>
                                    {loading ? 'Resetting…' : 'Reset password'}
                                </Button>
                            </form>

                            <div className="mt-6 text-center text-sm text-content-muted">
                                <a href="/login" className="text-content-emphasis underline underline-offset-2 hover:text-[var(--brand-default)]">
                                    Back to sign in
                                </a>
                            </div>
                        </>
                    )}
                </Card>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-bg-page">
                <div className="text-content-muted">Loading...</div>
            </div>
        }>
            <ResetPasswordForm />
        </Suspense>
    );
}
