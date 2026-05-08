'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';

import { useState, useEffect, useCallback } from 'react';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { ShieldCheck, QrCode, Copy, CheckCircle, XCircle, Trash2, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/components/ui/hooks';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface MfaStatus {
    isEnrolled: boolean;
    isVerified: boolean;
    enrolledAt: string | null;
    verifiedAt: string | null;
    tenantMfaPolicy: string;
    mfaRequired: boolean;
}

interface EnrollmentResult {
    otpauthUrl: string;
    secret: string;
    enrollmentId: string;
}

type Step = 'status' | 'enrolling' | 'verifying';

export default function UserMfaPage() {
    const apiUrl = useTenantApiUrl();
    const [status, setStatus] = useState<MfaStatus | null>(null);
    const [step, setStep] = useState<Step>('status');
    const [enrollment, setEnrollment] = useState<EnrollmentResult | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const { copy, copied } = useCopyToClipboard({ timeout: 2500 });

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/security/mfa/enroll'));
            if (res.ok) {
                setStatus(await res.json());
            }
        } catch {
            setError('Failed to load MFA status');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    const startEnroll = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl('/security/mfa/enroll/start'), { method: 'POST' });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to start enrollment');
            }
            const data = await res.json();
            setEnrollment(data);
            setStep('enrolling');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enrollment failed');
        } finally {
            setSubmitting(false);
        }
    };

    const verifyCode = async () => {
        if (code.length !== 6 || !/^\d{6}$/.test(code)) {
            setError('Please enter a valid 6-digit code');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl('/security/mfa/enroll/verify'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('MFA enrolled successfully! Your account is now protected.');
                setStep('status');
                setEnrollment(null);
                setCode('');
                await fetchStatus();
            } else {
                setError(data.error || 'Invalid code. Please try again.');
            }
        } catch {
            setError('Verification failed');
        } finally {
            setSubmitting(false);
        }
    };

    const removeMfa = () => setShowRemoveConfirm(true);

    const performRemoveMfa = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl('/security/mfa/enroll'), { method: 'DELETE' });
            if (res.ok) {
                setSuccess('MFA removed.');
                await fetchStatus();
                setTimeout(() => setSuccess(null), 3000);
            }
        } catch {
            setError('Failed to remove MFA');
        } finally {
            setSubmitting(false);
        }
    };

    const copySecret = async () => {
        if (!enrollment) return;
        const ok = await copy(enrollment.secret);
        if (ok) {
            toast.success('Setup key copied — paste it into your authenticator app.');
        } else {
            toast.error('Copy failed — select the key and copy manually.');
        }
    };

    if (loading) {
        return (
            <div className="space-y-6 animate-fadeIn">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-[var(--brand-default)]" />
                    Multi-Factor Authentication
                </h1>
                <div className="glass-card p-8">
                    <div className="animate-pulse space-y-4">
                        <div className="h-4 bg-bg-elevated rounded w-1/3" />
                        <div className="h-20 bg-bg-elevated rounded w-full" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn max-w-2xl">
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-[var(--brand-default)]" />
                Multi-Factor Authentication
            </h1>

            {error && (
                <div className="glass-card p-4 border border-border-error bg-bg-error flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-content-error shrink-0" />
                    <span className="text-sm text-content-error">{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-xs text-content-muted hover:text-content-emphasis">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {success && (
                <div className="glass-card p-4 border border-border-success bg-bg-success flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-content-success shrink-0" />
                    <span className="text-sm text-content-success">{success}</span>
                </div>
            )}

            {/* Status Card */}
            {step === 'status' && status && (
                <div className="glass-card p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-content-emphasis">MFA Status</h2>
                            <p className="text-sm text-content-muted mt-1">
                                Tenant policy: <span className="font-medium text-content-default">{status.tenantMfaPolicy}</span>
                            </p>
                        </div>
                        <div>
                            {status.isVerified ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-bg-success text-content-success border border-border-success">
                                    <CheckCircle className="w-4 h-4" />
                                    Enrolled
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-bg-elevated/50 text-content-muted border border-border-emphasis">
                                    Not Enrolled
                                </span>
                            )}
                        </div>
                    </div>

                    {status.isVerified && status.verifiedAt && (
                        <p className="text-xs text-content-subtle">
                            Enrolled since {formatDate(status.verifiedAt)}
                        </p>
                    )}

                    {status.mfaRequired && !status.isVerified && (
                        <div className="p-3 rounded-lg border border-border-warning bg-bg-warning flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-content-warning mt-0.5 shrink-0" />
                            <p className="text-sm text-content-warning">
                                Your organization requires MFA. You must enroll to continue using the application.
                            </p>
                        </div>
                    )}

                    <div className="flex gap-2 pt-2">
                        {!status.isVerified && (
                            <Button
                                variant="primary"
                                onClick={startEnroll}
                                disabled={submitting}
                                id="mfa-enroll-btn"
                                icon={<QrCode className="w-4 h-4" />}
                            >
                                {submitting ? 'Starting...' : 'Set Up MFA'}
                            </Button>
                        )}
                        {status.isVerified && status.tenantMfaPolicy !== 'REQUIRED' && (
                            <Button
                                variant="danger-outline"
                                onClick={removeMfa}
                                disabled={submitting}
                                id="mfa-remove-btn"
                                icon={<Trash2 className="w-4 h-4" />}
                            >
                                Remove MFA
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Enrollment Step: Show Secret + QR */}
            {step === 'enrolling' && enrollment && (
                <div className="glass-card p-6 space-y-5">
                    <div>
                        <h2 className="text-lg font-semibold text-content-emphasis mb-1">Set Up Authenticator App</h2>
                        <p className="text-sm text-content-muted">
                            1. Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)
                        </p>
                        <p className="text-sm text-content-muted">
                            2. Scan this QR code or manually enter the setup key
                        </p>
                    </div>

                    {/* QR Code placeholder — render the otpauth URI */}
                    <div className="flex flex-col items-center gap-4 py-4">
                        <div className="bg-white p-4 rounded-xl">
                            {/* Simple QR fallback: render as a monospace URI block */}
                            <div className="w-full sm:w-48 h-48 flex items-center justify-center">
                                <QrCode className="w-full sm:w-32 h-32 text-slate-800" />
                            </div>
                        </div>
                        <p className="text-xs text-content-subtle">
                            If you cannot scan, use the setup key below
                        </p>
                    </div>

                    {/* Setup Key */}
                    <div className="p-4 rounded-lg border border-border-default bg-bg-default/50">
                        <label className="text-xs text-content-muted block mb-1">Setup Key</label>
                        <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-[var(--brand-muted)] tracking-wider break-all flex-1">
                                {enrollment.secret}
                            </code>
                            <Button
                                variant="secondary"
                                size="xs"
                                className="shrink-0"
                                onClick={copySecret}
                                icon={copied ? <CheckCircle className="w-3.5 h-3.5 text-content-success" /> : <Copy className="w-3.5 h-3.5" />}
                            >
                                {copied ? 'Copied!' : 'Copy'}
                            </Button>
                        </div>
                    </div>

                    {/* Verification */}
                    <div>
                        <h3 className="text-sm font-semibold text-content-emphasis mb-2">
                            3. Enter the 6-digit code from your authenticator app
                        </h3>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="000000"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className="input text-center text-lg font-mono tracking-[0.3em] w-full sm:w-40"
                                id="mfa-code-input"
                                autoFocus
                            />
                            <Button
                                variant="primary"
                                onClick={verifyCode}
                                disabled={submitting || code.length !== 6}
                                id="mfa-verify-btn"
                            >
                                {submitting ? 'Verifying...' : 'Verify & Enable'}
                            </Button>
                        </div>
                    </div>

                    <button
                        onClick={() => { setStep('status'); setEnrollment(null); setCode(''); }}
                        className="text-xs text-content-subtle hover:text-content-default transition"
                    >
                        Cancel enrollment
                    </button>
                </div>
            )}
            <ConfirmDialog
                showModal={showRemoveConfirm}
                setShowModal={setShowRemoveConfirm}
                tone="danger"
                title="Remove multi-factor authentication?"
                description="Your account will be less secure. You can re-enroll at any time."
                confirmLabel="Remove MFA"
                onConfirm={performRemoveMfa}
            />
        </div>
    );
}
