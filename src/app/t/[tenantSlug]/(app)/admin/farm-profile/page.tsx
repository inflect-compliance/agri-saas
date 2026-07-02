'use client';

/* TODO(swr-migration): fetch-on-mount + setState pattern (see the
 * admin/security page). Migrate to useTenantSWR with Epic 69. */

import { useState, useEffect, useCallback } from 'react';
import { cardVariants } from '@/components/ui/card';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { OfficeBuilding } from '@/components/ui/icons/nucleo/office-building';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Heading } from '@/components/ui/typography';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SkeletonInput } from '@/components/ui/skeleton';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cn } from '@/lib/cn';

// БАБХ ДНЕВНИК — the one-per-tenant farm identity block. Every field is
// optional; the paper form tolerates blanks. egn/eik are encrypted at rest
// (Epic B manifest) — this page only ever sees plaintext.
const PROFILE_FIELDS = [
    'producerName',
    'egn',
    'eik',
    'address',
    'municipality',
    'settlement',
    'agricultureDirectorateCity',
    'registrationPlace',
    'registrationEkatte',
    'odbhCity',
] as const;

type ProfileKey = (typeof PROFILE_FIELDS)[number];
type Profile = Record<ProfileKey, string>;

const FIELD_LABELS: { key: ProfileKey; label: string; description?: string }[] = [
    { key: 'producerName', label: 'Земеделски производител (име/фирма)' },
    { key: 'egn', label: 'ЕГН', description: 'Съхранява се криптирано.' },
    { key: 'eik', label: 'ЕИК', description: 'Съхранява се криптирано.' },
    { key: 'address', label: 'Адрес' },
    { key: 'municipality', label: 'Община' },
    { key: 'settlement', label: 'Населено място' },
    { key: 'agricultureDirectorateCity', label: 'ОД „Земеделие“ гр.' },
    { key: 'registrationPlace', label: 'Място на регистриране' },
    { key: 'registrationEkatte', label: 'ЕКАТТЕ' },
    { key: 'odbhCity', label: 'ОДБХ гр.' },
];

const EMPTY_PROFILE: Profile = PROFILE_FIELDS.reduce(
    (acc, k) => ({ ...acc, [k]: '' }),
    {} as Profile,
);

export default function AdminFarmProfilePage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const fetchProfile = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/admin/farm-profile'));
            if (res.ok) {
                const data = await res.json();
                // API returns an all-null shape when unset — coerce to strings.
                setProfile(
                    PROFILE_FIELDS.reduce(
                        (acc, k) => ({ ...acc, [k]: data?.[k] ?? '' }),
                        {} as Profile,
                    ),
                );
            }
        } catch {
            setError('Неуспешно зареждане на профила на стопанството.');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchProfile(); }, [fetchProfile]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await fetch(apiUrl('/admin/farm-profile'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profile),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Неуспешно записване.');
            }
            const updated = await res.json();
            setProfile(
                PROFILE_FIELDS.reduce(
                    (acc, k) => ({ ...acc, [k]: updated?.[k] ?? '' }),
                    {} as Profile,
                ),
            );
            setSuccess('Профилът на стопанството е записан.');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Неуспешно записване.');
        } finally {
            setSaving(false);
        }
    };

    const setField = (key: ProfileKey, value: string) =>
        setProfile((p) => ({ ...p, [key]: value }));

    if (loading) {
        return (
            <div className="space-y-section animate-fadeIn">
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Admin', href: tenantHref('/admin') },
                        { label: 'Farm profile' },
                    ]}
                    className="mb-1"
                />
                <Heading level={2} className="flex items-center gap-tight">
                    <OfficeBuilding className="w-6 h-6 text-[var(--brand-default)]" />
                    Loading farm profile…
                </Heading>
                <div className={cn(cardVariants(), 'space-y-default')}>
                    <SkeletonInput />
                    <SkeletonInput />
                    <SkeletonInput />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-section animate-fadeIn">
            <div>
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Admin', href: tenantHref('/admin') },
                        { label: 'Farm profile' },
                    ]}
                    className="mb-1"
                />
                <Heading level={1} className="flex items-center gap-tight">
                    <OfficeBuilding className="w-6 h-6 text-[var(--brand-default)]" />
                    Farm profile
                </Heading>
            </div>

            {error && <InlineNotice variant="error">{error}</InlineNotice>}
            {success && <InlineNotice variant="success">{success}</InlineNotice>}

            <div className={cn(cardVariants(), 'space-y-default')}>
                <div>
                    <Heading level={2}>Идентификация на стопанството</Heading>
                    <p className="text-sm text-content-muted mt-1">
                        Данните се отпечатват в „ДНЕВНИК за проведените растителнозащитни
                        мероприятия и торене“ (Приложение 1 към заповед № РД 11-3194/31.12.2021 г.
                        на БАБХ). Всички полета са незадължителни — празните остават като точки във формата.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                    {FIELD_LABELS.map((f) => (
                        <FormField key={f.key} label={f.label} description={f.description}>
                            <Input
                                value={profile[f.key]}
                                onChange={(e) => setField(f.key, e.target.value)}
                            />
                        </FormField>
                    ))}
                </div>
            </div>

            <div className="flex justify-end">
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={saving}
                    loading={saving}
                    id="farm-profile-save-btn"
                >
                    {saving ? 'Записване…' : 'Запис'}
                </Button>
            </div>
        </div>
    );
}
