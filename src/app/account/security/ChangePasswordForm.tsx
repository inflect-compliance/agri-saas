'use client';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Input } from '@/components/ui/input';
import { Heading } from '@/components/ui/typography';

export function ChangePasswordForm() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');

        if (!currentPassword || !newPassword || !confirmPassword) {
            setError('Please fill in all three password fields.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('The two new passwords do not match.');
            return;
        }
        if (newPassword.length < 8) {
            setError('Your new password must be at least 8 characters long.');
            return;
        }
        if (newPassword === currentPassword) {
            setError('Your new password must be different from your current password.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (res.ok) {
                setSuccess(true);
                setTimeout(() => {
                    window.location.href = '/login?passwordChanged=1';
                }, 1500);
                return;
            }
            const data = await res.json().catch(() => ({}));
            setError(typeof data?.error === 'string' ? data.error : 'Could not change your password.');
        } catch {
            setError('Could not change your password.');
        }
        setLoading(false);
    };

    return (
        <Card className="animate-fadeIn">
            <Heading level={2} className="mb-6">
                Change password
            </Heading>

            {success ? (
                <InlineNotice variant="success" className="mb-4" icon={null}>
                    Your password has been changed. Redirecting to sign in…
                </InlineNotice>
            ) : (
                <>
                    {error && (
                        <InlineNotice variant="error" className="mb-4" icon={null}>
                            {error}
                        </InlineNotice>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-default">
                        <FormField label="Current password" required>
                            <Input
                                type="password"
                                name="currentPassword"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                                placeholder="Your current password"
                            />
                        </FormField>
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
                            {loading ? 'Changing…' : 'Change password'}
                        </Button>
                    </form>
                </>
            )}
        </Card>
    );
}
