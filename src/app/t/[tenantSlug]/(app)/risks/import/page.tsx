'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Tanstack-react-table cell callbacks (tanstack cell callbacks where row/getValue carry the implicit-any annotation) — typing each callback with `CellContext<TData, TValue>` requires importing the right generic per column and adds significant ceremony. The implicit any here is at the render-time boundary; row.original is type-narrowed by the column's accessorKey at runtime. */
import { useState, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { DataTable, createColumns } from '@/components/ui/table';
import { Heading } from '@/components/ui/typography';
import { Card, cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

type ParsedRow = {
    title: string;
    description?: string;
    category?: string;
    likelihood?: number;
    impact?: number;
    owner?: string;
};

export default function RiskImportPage() {
    const apiUrl = useTenantApiUrl();
    const href = useTenantHref();
    const tenant = useTenantContext();
    const canWrite = tenant.permissions.canWrite;
    const t = useTranslations('riskManager');

    const fileRef = useRef<HTMLInputElement>(null);
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

    const parseCSV = (text: string): ParsedRow[] => {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        const titleIdx = headers.indexOf('title');
        if (titleIdx < 0) return [];

        return lines.slice(1).map(line => {
            const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            const row: ParsedRow = { title: cols[titleIdx] };

            const descIdx = headers.indexOf('description');
            if (descIdx >= 0 && cols[descIdx]) row.description = cols[descIdx];

            const catIdx = headers.indexOf('category');
            if (catIdx >= 0 && cols[catIdx]) row.category = cols[catIdx];

            const lIdx = headers.indexOf('likelihood');
            if (lIdx >= 0 && cols[lIdx]) {
                const n = parseInt(cols[lIdx]);
                if (n >= 1 && n <= 5) row.likelihood = n;
            }

            const iIdx = headers.indexOf('impact');
            if (iIdx >= 0 && cols[iIdx]) {
                const n = parseInt(cols[iIdx]);
                if (n >= 1 && n <= 5) row.impact = n;
            }

            const oIdx = headers.indexOf('owner');
            if (oIdx >= 0 && cols[oIdx]) row.owner = cols[oIdx];

            return row;
        }).filter(r => r.title);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setResult(null);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            setRows(parseCSV(text));
        };
        reader.readAsText(file);
    };

    const doImport = async () => {
        setImporting(true);
        const errors: string[] = [];
        let created = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {

                const payload: Record<string, any> = {
                    title: row.title,
                    description: row.description,
                    category: row.category,
                    likelihood: row.likelihood ?? 3,
                    impact: row.impact ?? 3,
                    treatmentOwner: row.owner,
                };
                const res = await fetch(apiUrl('/risks'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || `Status ${res.status}`);
                }
                created++;

            } catch (err: any) {
                errors.push(`Row ${i + 1} "${row.title}": ${err.message}`);
            }
        }
        setResult({ created, errors });
        setImporting(false);
    };

    if (!canWrite) {
        return (
            <div className="space-y-section animate-fadeIn">
                <Card className="text-center">
                    <p className="text-content-muted">{t('noImportPermission')}</p>
                    <Link href={href('/risks')} className={buttonVariants({ variant: 'secondary', className: 'mt-4' })}>
                        {t('backToRisks')}
                    </Link>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-section animate-fadeIn max-w-4xl">
            <div className="flex items-center gap-compact">
                <Link href={href('/risks')} className="text-content-muted hover:text-content-emphasis transition">←</Link>
                <div>
                    <Heading level={1}>{t('importTitle')}</Heading>
                    <p className="text-content-muted text-sm">{tenant.tenantName}</p>
                </div>
            </div>

            {/* Format info */}
            <div className={cn(cardVariants({ density: 'compact' }), 'border-border-emphasis/50')}>
                <Heading level={3} className="mb-2">{t('csvFormat')}</Heading>
                <p className="text-xs text-content-muted">{t('csvDesc')}</p>
                <pre className="mt-2 text-xs text-content-subtle bg-bg-page/50 p-2 rounded overflow-x-auto">
                    title,description,category,likelihood,impact,owner{'\n'}
                    Unauthorized access,Risk of unauthorized data access,Technical,4,5,CISO
                </pre>
            </div>

            {/* File picker */}
            {!result && (
                <>
                    <input type="file" accept=".csv" ref={fileRef} onChange={handleFileChange} className="hidden" id="csv-file-input" />
                    <Button variant="secondary" className="w-full py-4 text-center" onClick={() => fileRef.current?.click()} id="choose-csv">
                        {t('chooseFile')}
                    </Button>
                </>
            )}

            {/* Preview */}
            {rows.length > 0 && !result && (
                <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                    <div className="p-3 border-b border-border-default/50 flex justify-between items-center">
                        <span className="text-sm font-medium">{t('risksToImport', { count: rows.length })}</span>
                        <Button variant="primary" size="sm" onClick={doImport} disabled={importing} id="import-btn">
                            {importing ? t('importing', { count: rows.length }) : t('confirmImport', { count: rows.length })}
                        </Button>
                    </div>
                    {(() => {
                        const previewCols = createColumns<ParsedRow & { _idx: number }>([
                            { id: 'num', header: '#', accessorKey: '_idx', cell: ({ getValue }: any) => <span className="text-xs text-content-subtle">{getValue()}</span> },
                            { accessorKey: 'title', header: t('colTitle'), cell: ({ getValue }: any) => <span className="text-sm">{getValue()}</span> },
                            { id: 'category', header: t('colCategory'), accessorKey: 'category', cell: ({ getValue }: any) => <span className="text-xs text-content-muted">{getValue() || '—'}</span> },
                            { id: 'lxi', header: t('colLxI'), accessorFn: (r: any) => `${r.likelihood ?? 3}×${r.impact ?? 3}`, cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span> },
                            { id: 'owner', header: t('colOwner'), accessorKey: 'owner', cell: ({ getValue }: any) => <span className="text-xs text-content-muted">{getValue() || '—'}</span> },
                        ]);
                        const previewData = rows.slice(0, 20).map((r, i) => ({ ...r, _idx: i + 1 }));
                        return (
                            <>
                                <DataTable
                                    data={previewData}
                                    columns={previewCols}
                                    getRowId={(r) => String(r._idx)}
                                    emptyState="No rows to preview"
                                    resourceName={(p) => p ? 'rows' : 'row'}
                                    data-testid="risk-import-preview"
                                />
                                {rows.length > 20 && (
                                    <p className="text-center text-xs text-content-subtle py-2">+{rows.length - 20} more…</p>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}

            {/* No valid rows warning. Reading fileRef.current during
                render is intentional: the file-input ref is the source
                of truth for "has the user picked a file?" — moving it
                to state would race the controlled-input onChange and
                potentially flash the warning before/after the parser
                catches up. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {rows.length === 0 && fileRef.current?.files?.length ? (
                <div className={cn(cardVariants({ density: 'compact' }), 'text-sm text-content-warning')}>{t('noValidRows')}</div>
            ) : null}

            {/* Result */}
            {result && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    <p className="text-lg font-semibold text-content-success">
                        {t('importComplete', { created: result.created, total: rows.length })}
                    </p>
                    {result.errors.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-sm text-content-error font-medium">{t('errors')}:</p>
                            {result.errors.map((e, i) => (
                                <p key={i} className="text-xs text-content-error">{e}</p>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-compact">
                        <Link href={href('/risks')} className={buttonVariants({ variant: 'primary' })}>
                            {t('viewRegister')}
                        </Link>
                        <Button variant="secondary" onClick={() => { setResult(null); setRows([]); if (fileRef.current) fileRef.current.value = ''; }}>
                            {t('importMore')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
