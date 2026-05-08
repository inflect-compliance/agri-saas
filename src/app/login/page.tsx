'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getProviders, signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';

function extractErrorMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'message' in value) {
        const nested = (value as { message?: unknown }).message;
        if (typeof nested === 'string') return nested;
    }
    return fallback;
}

type VerifyStatus = 'verified' | 'invalid' | 'expired';

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // R-1: default post-sign-in destination is /tenants so the picker logic
    // takes over (0 → /no-tenant, 1 → direct, >1 → picker list).
    const callbackUrl = searchParams?.get('callbackUrl') || '/tenants';
    const verifyStatusParam = searchParams?.get('verifyStatus');
    const verifyStatus: VerifyStatus | null =
        verifyStatusParam === 'verified' ||
        verifyStatusParam === 'invalid' ||
        verifyStatusParam === 'expired'
            ? verifyStatusParam
            : null;
    const t = useTranslations('login');
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [orgName, setOrgName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendEmail, setResendEmail] = useState('');
    const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
    // `null` = still resolving the provider list (nothing credentials-shaped
    // renders yet). `false` = server is OAuth-only, hide the form + divider
    // + register toggle. `true` = credentials is registered (dev, or prod
    // with AUTH_TEST_MODE=1), show the form.
    const [credentialsEnabled, setCredentialsEnabled] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Resolve in parallel: (1) which providers the server has
        // registered, and (2) the runtime UI-config flag. The flag is
        // served by /api/auth/ui-config so an operator can flip
        // `AUTH_CREDENTIALS_UI_HIDDEN=1` in the VM's .env and recreate
        // the container — no rebuild. When the flag is on the form
        // stays hidden regardless of provider registration.
        Promise.all([
            getProviders().catch(() => null),
            fetch('/api/auth/ui-config')
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null),
        ]).then(([providers, uiConfig]) => {
            if (cancelled) return;
            if (uiConfig?.credentialsFormHidden === true) {
                setCredentialsEnabled(false);
                return;
            }
            setCredentialsEnabled(!!providers?.credentials);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleCredentialsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const submitEmail = (formData.get('email') as string) || email;
        const submitPassword = (formData.get('password') as string) || password;

        try {
            if (mode === 'register') {
                // Registration still uses the legacy API (creates tenant + user)
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'register', email, password, name, orgName }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(extractErrorMessage(data?.error, 'Registration failed'));
                // After registration, sign in with credentials
            }

            // Sign in via NextAuth credentials provider
            const result = await signIn('credentials', {
                email: submitEmail,
                password: submitPassword,
                redirect: false,
                callbackUrl,
            });

            if (result?.error) {
                const raw = extractErrorMessage(result.error, 'Login failed');
                throw new Error(raw === 'CredentialsSignin' ? 'Invalid credentials' : raw);
            }

            // Force a native hard redirect. 
            // Using router.push() + router.refresh() synchronously causes App Router transition 
            // cancellations/race conditions, leaving the user stuck on /login permanently.
            window.location.href = callbackUrl;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResendVerification = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!resendEmail) return;
        setResendState('sending');
        try {
            await fetch('/api/auth/verify-email/resend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: resendEmail }),
            });
        } catch {
            // Uniform response is the whole point — we never branch on
            // outcome here either. Network errors get the same "sent"
            // state so the UI doesn't leak that the backend is reachable
            // for some emails and not others.
        }
        setResendState('sent');
    };

    const handleOAuthSignIn = async (provider: string) => {
        setError('');
        setLoading(true);
        try {
            await signIn(provider, { callbackUrl });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 p-4">
            {/* Background effects */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-brand-600/10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-purple-600/10 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8 animate-fadeIn">
                    <div className="inline-flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                    </div>
                    <Heading level={1} className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                        {t('title')}
                    </Heading>
                    <p className="text-slate-400 text-sm mt-1">{t('subtitle')}</p>
                </div>

                {/* Form */}
                <Card className="animate-fadeIn">
                    <Heading level={2} className="mb-6">
                        {mode === 'login' ? t('signIn') : t('register')}
                    </Heading>

                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-bg-error border border-border-error text-content-error text-sm">
                            {error}
                        </div>
                    )}

                    {verifyStatus === 'verified' && (
                        <div
                            role="status"
                            className="mb-4 p-3 rounded-lg bg-bg-success border border-border-success text-content-success text-sm"
                        >
                            Email verified — you can sign in now.
                        </div>
                    )}
                    {verifyStatus === 'expired' && (
                        <div
                            role="status"
                            className="mb-4 p-3 rounded-lg bg-bg-warning border border-border-warning text-content-warning text-sm"
                        >
                            That verification link has expired. Request a new one below.
                        </div>
                    )}
                    {verifyStatus === 'invalid' && (
                        <div
                            role="status"
                            className="mb-4 p-3 rounded-lg bg-bg-warning border border-border-warning text-content-warning text-sm"
                        >
                            That verification link is not valid. Request a new one below.
                        </div>
                    )}

                    {/* OAuth Buttons */}
                    <div className="space-y-3 mb-6">
                        <button
                            onClick={() => handleOAuthSignIn('google')}
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg border border-slate-600/50 bg-slate-800/50 hover:bg-slate-700/50 transition-colors text-sm font-medium text-slate-200"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>
                        <button
                            onClick={() => handleOAuthSignIn('microsoft-entra-id')}
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg border border-slate-600/50 bg-slate-800/50 hover:bg-slate-700/50 transition-colors text-sm font-medium text-slate-200"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 21 21">
                                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                            </svg>
                            Continue with Microsoft
                        </button>
                    </div>

                    {credentialsEnabled && (
                        <>
                            {/* Divider */}
                            <div className="relative mb-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-700/50" />
                                </div>
                                <div className="relative flex justify-center text-xs">
                                    <span className="px-2 bg-slate-900 text-slate-400">or continue with email</span>
                                </div>
                            </div>

                            {/* Credentials Form */}
                            {/* id="credentials-form" lets E2E scope its
                                selectors inside this form so the resend-
                                verification form below (which has its own
                                email + submit button) doesn't collide with
                                `input[type="email"]` / `button[type="submit"]`
                                lookups. Don't drop this id without updating
                                tests/e2e/e2e-utils.ts. */}
                            <form id="credentials-form" onSubmit={handleCredentialsSubmit} method="post" action="#" className="space-y-4">
                                {mode === 'register' && (
                                    <>
                                        <div>
                                            <label htmlFor="login-name" className="input-label">{t('name')}</label>
                                            <input id="login-name" className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('namePlaceholder')} />
                                        </div>
                                        <div>
                                            <label htmlFor="login-org-name" className="input-label">{t('orgName')}</label>
                                            <input id="login-org-name" className="input" name="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required placeholder={t('orgPlaceholder')} />
                                        </div>
                                    </>
                                )}
                                <div>
                                    <label htmlFor="login-email" className="input-label">{t('email')}</label>
                                    <input id="login-email" className="input" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder={t('emailPlaceholder')} />
                                </div>
                                <div>
                                    <label htmlFor="login-password" className="input-label">{t('password')}</label>
                                    <input id="login-password" className="input" type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={t('passwordPlaceholder')} minLength={6} />
                                </div>
                                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
                                    {loading ? t('pleaseWait') : mode === 'login' ? t('submitLogin') : t('submitRegister')}
                                </Button>
                            </form>

                            <div className="mt-6 text-center text-sm text-slate-400">
                                {mode === 'login' ? (
                                    <span>{t('noAccount')} <button onClick={() => setMode('register')} className="text-brand-400 hover:text-brand-300">{t('registerLink')}</button></span>
                                ) : (
                                    <span>{t('hasAccount')} <button onClick={() => setMode('login')} className="text-brand-400 hover:text-brand-300">{t('signInLink')}</button></span>
                                )}
                            </div>

                            {/* Resend verification — shown unconditionally because
                                the endpoint returns a uniform response regardless
                                of whether the email is registered / verified / rate-
                                limited, so exposing the form doesn't leak account
                                state. Sits below the sign-in/register toggle so it
                                doesn't steal the primary eye path. */}
                            <div className="mt-6 pt-4 border-t border-slate-700/50">
                                {resendState === 'sent' ? (
                                    <p
                                        role="status"
                                        className="text-xs text-slate-400 text-center"
                                    >
                                        If that email is registered and not yet verified, a new link is on its way.
                                    </p>
                                ) : (
                                    <form
                                        onSubmit={handleResendVerification}
                                        className="flex items-center gap-2"
                                    >
                                        <input
                                            type="email"
                                            name="resendEmail"
                                            aria-label="Email for verification resend"
                                            className="input flex-1 text-xs"
                                            placeholder="Didn't get a verification email?"
                                            value={resendEmail}
                                            onChange={(e) => setResendEmail(e.target.value)}
                                        />
                                        <button
                                            type="submit"
                                            disabled={resendState === 'sending' || !resendEmail}
                                            className="text-xs text-brand-400 hover:text-brand-300 disabled:text-slate-600"
                                        >
                                            {resendState === 'sending' ? 'Sending…' : 'Resend'}
                                        </button>
                                    </form>
                                )}
                            </div>
                        </>
                    )}
                </Card>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950">
                <div className="text-slate-400">Loading...</div>
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}
