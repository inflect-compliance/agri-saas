'use client';

import { useMemo, useState } from 'react';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost } from '@/lib/api-client';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { DataTable, createColumns } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Combobox } from '@/components/ui/combobox';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate } from '@/lib/format-date';

interface Lot {
    id: string;
    lotCode: string;
    item: { id: string; name: string; category: string };
    unit: { id: string; symbol: string };
    location: { id: string; name: string } | null;
    quantityOnHand: number;
    expiresAt: string | null;
    lowStock: boolean;
}

interface LedgerRow {
    id: string;
    type: string;
    quantityDelta: number;
    unitSymbol: string;
    occurredAt: string;
    reason: string | null;
    actor: { id: string; name: string | null } | null;
}
interface LotDetail extends Omit<Lot, 'item'> {
    item: { id: string; name: string; category: string };
    ledger: LedgerRow[];
}

interface ItemRow {
    id: string;
    name: string;
    category: string;
    defaultUnit?: { symbol?: string };
}
interface UnitRow {
    id: string;
    name: string;
    symbol: string;
    measure: string;
}

const CATEGORIES = ['SEED', 'PESTICIDE', 'FERTILIZER', 'AMENDMENT', 'FUEL', 'HARVESTED_PRODUCE', 'OTHER'] as const;

export function InventoryClient({ tenantSlug }: { tenantSlug: string }) {
    const buildUrl = useTenantApiUrl();
    const { data: lots, mutate, isLoading } = useTenantSWR<Lot[]>('/inventory/lots');
    const { data: items, mutate: mutateItems } = useTenantSWR<ItemRow[]>('/items');
    const { data: units } = useTenantSWR<UnitRow[]>('/units');

    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // New product modal
    const [showProduct, setShowProduct] = useState(false);
    const [pName, setPName] = useState('');
    const [pCategory, setPCategory] = useState<string>('PESTICIDE');
    const [pUnitId, setPUnitId] = useState<string>('');

    // New lot modal
    const [showLot, setShowLot] = useState(false);
    const [lItemId, setLItemId] = useState<string>('');
    const [lCode, setLCode] = useState('');
    const [lQty, setLQty] = useState('');
    const [lExpires, setLExpires] = useState<Date | null>(null);

    // Lot detail / movement modal
    const [activeLotId, setActiveLotId] = useState<string | null>(null);
    const { data: lotDetail, mutate: mutateLot } = useTenantSWR<LotDetail>(
        activeLotId ? `/inventory/lots/${activeLotId}` : null,
    );
    const [mvMode, setMvMode] = useState<'receive' | 'adjust'>('receive');
    const [mvQty, setMvQty] = useState('');
    const [mvReason, setMvReason] = useState('');

    const itemOptions = useMemo(
        () => (items ?? []).map((i) => ({ label: `${i.name}`, value: i.id })),
        [items],
    );
    const unitOptions = useMemo(
        () => (units ?? []).map((u) => ({ label: `${u.name} (${u.symbol})`, value: u.id })),
        [units],
    );
    const categoryOptions = useMemo(
        () => CATEGORIES.map((c) => ({ label: c.replace('_', ' '), value: c })),
        [],
    );

    const createProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await apiPost(buildUrl('/items'), {
                name: pName,
                category: pCategory,
                defaultUnitId: pUnitId,
            });
            setShowProduct(false);
            setPName('');
            setPUnitId('');
            await mutateItems();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create product');
        } finally {
            setBusy(false);
        }
    };

    const createLot = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await apiPost(buildUrl('/inventory/lots'), {
                itemId: lItemId,
                lotCode: lCode,
                initialQuantity: lQty ? Number(lQty) : null,
                expiresAt: lExpires ? lExpires.toISOString() : null,
            });
            setShowLot(false);
            setLItemId('');
            setLCode('');
            setLQty('');
            setLExpires(null);
            await mutate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create lot');
        } finally {
            setBusy(false);
        }
    };

    const postMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeLotId) return;
        setBusy(true);
        setError(null);
        try {
            if (mvMode === 'receive') {
                await apiPost(buildUrl(`/inventory/lots/${activeLotId}/receive`), {
                    quantity: Number(mvQty),
                });
            } else {
                await apiPost(buildUrl(`/inventory/lots/${activeLotId}/adjust`), {
                    delta: Number(mvQty),
                    reason: mvReason,
                });
            }
            setMvQty('');
            setMvReason('');
            await Promise.all([mutate(), mutateLot()]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to post movement');
        } finally {
            setBusy(false);
        }
    };

    const columns = useMemo(
        () =>
            createColumns<Lot>([
                { accessorKey: 'lotCode', header: 'Lot', cell: ({ row }) => <span className="font-medium">{row.original.lotCode}</span> },
                { id: 'product', header: 'Product', cell: ({ row }) => row.original.item.name },
                {
                    id: 'onHand',
                    header: 'On hand',
                    cell: ({ row }) => (
                        <span className="flex items-center gap-tight">
                            {row.original.quantityOnHand} {row.original.unit.symbol}
                            {row.original.lowStock && <StatusBadge variant="warning">Low</StatusBadge>}
                        </span>
                    ),
                },
                { id: 'expires', header: 'Expires', cell: ({ row }) => (row.original.expiresAt ? formatDate(row.original.expiresAt) : '—') },
            ]),
        [],
    );

    const rows = lots ?? [];

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
                            items={[{ label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` }, { label: 'Inventory' }]}
                            className="mb-1"
                        />
                        <Heading level={1}>Inventory</Heading>
                        <p className="text-sm text-content-secondary">Input stock, lots, and the movement ledger.</p>
                    </div>
                    <div className="flex items-center gap-compact">
                        <Button variant="secondary" size="sm" onClick={() => setShowProduct(true)}>New product</Button>
                        <Button variant="primary" size="sm" onClick={() => setShowLot(true)} disabled={!items?.length}>New lot</Button>
                    </div>
                </div>
            </ListPageShell.Header>
            <ListPageShell.Body>
                <DataTable
                    fillBody
                    data-testid="inventory-lots-table"
                    data={rows}
                    columns={columns}
                    loading={isLoading && !lots}
                    getRowId={(l) => l.id}
                    onRowClick={(l) => {
                        setActiveLotId(l.id);
                        setError(null);
                        setMvMode('receive');
                    }}
                    emptyState={
                        <EmptyState
                            size="sm"
                            variant="no-records"
                            title="No stock yet"
                            description="Create a product, then add a lot to start tracking stock. Completing a spray job deducts from the matching lot automatically."
                        />
                    }
                />
            </ListPageShell.Body>

            {/* New product */}
            <Modal showModal={showProduct} setShowModal={setShowProduct} size="md" title="New product" description="Add an input product.">
                <Modal.Header title="New product" description="A product is the thing lots are batches of." />
                <Modal.Form id="new-product-form" onSubmit={createProduct}>
                    <Modal.Body>
                        {error && showProduct && (
                            <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">{error}</div>
                        )}
                        <div className="space-y-default">
                            <FormField label="Name" required>
                                <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. Roundup PowerMAX" />
                            </FormField>
                            <FormField label="Category" required>
                                <Combobox
                                    options={categoryOptions}
                                    selected={categoryOptions.find((o) => o.value === pCategory) ?? null}
                                    setSelected={(o) => setPCategory(o?.value ?? 'PESTICIDE')}
                                    placeholder="Select category"
                                />
                            </FormField>
                            <FormField label="Default unit" required>
                                <Combobox
                                    options={unitOptions}
                                    selected={unitOptions.find((o) => o.value === pUnitId) ?? null}
                                    setSelected={(o) => setPUnitId(o?.value ?? '')}
                                    placeholder="Select unit"
                                />
                            </FormField>
                        </div>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => setShowProduct(false)}>Cancel</Button>
                        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!pName || !pUnitId || busy}>Create product</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>

            {/* New lot */}
            <Modal showModal={showLot} setShowModal={setShowLot} size="md" title="New lot" description="Add a stock batch.">
                <Modal.Header title="New lot" description="A lot is a physical batch of a product." />
                <Modal.Form id="new-lot-form" onSubmit={createLot}>
                    <Modal.Body>
                        {error && showLot && (
                            <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">{error}</div>
                        )}
                        <div className="space-y-default">
                            <FormField label="Product" required>
                                <Combobox
                                    options={itemOptions}
                                    selected={itemOptions.find((o) => o.value === lItemId) ?? null}
                                    setSelected={(o) => setLItemId(o?.value ?? '')}
                                    placeholder="Select product"
                                />
                            </FormField>
                            <FormField label="Lot code" required>
                                <Input value={lCode} onChange={(e) => setLCode(e.target.value)} placeholder="e.g. BATCH-2027-04" />
                            </FormField>
                            <FormField label="Initial quantity" hint="Optional — posts an opening RECEIPT.">
                                <Input inputMode="decimal" value={lQty} onChange={(e) => setLQty(e.target.value)} placeholder="0" />
                            </FormField>
                            <FormField label="Expires" hint="Optional.">
                                <DatePicker value={lExpires} onChange={setLExpires} clearable placeholder="Select date" />
                            </FormField>
                        </div>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => setShowLot(false)}>Cancel</Button>
                        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!lItemId || !lCode || busy}>Create lot</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>

            {/* Lot detail + movement */}
            <Modal showModal={!!activeLotId} setShowModal={(v) => !v && setActiveLotId(null)} size="lg" title="Lot" description="Stock movements for this lot.">
                <Modal.Header
                    title={lotDetail ? `${lotDetail.item.name} — ${lotDetail.lotCode}` : 'Lot'}
                    description={lotDetail ? `On hand: ${lotDetail.quantityOnHand} ${lotDetail.unit.symbol}` : undefined}
                />
                <Modal.Body>
                    {error && activeLotId && (
                        <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">{error}</div>
                    )}
                    <form id="movement-form" onSubmit={postMovement} className="space-y-default border-b border-border-subtle pb-default">
                        <ToggleGroup
                            ariaLabel="Movement type"
                            options={[
                                { value: 'receive', label: 'Receive' },
                                { value: 'adjust', label: 'Adjust' },
                            ]}
                            selected={mvMode}
                            selectAction={(v) => setMvMode(v as 'receive' | 'adjust')}
                        />
                        <div className="flex items-end gap-compact">
                            <FormField label={mvMode === 'receive' ? 'Quantity in' : 'Signed delta'} className="flex-1">
                                <Input inputMode="decimal" value={mvQty} onChange={(e) => setMvQty(e.target.value)} placeholder={mvMode === 'receive' ? '0' : 'e.g. -2.5'} />
                            </FormField>
                            <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!mvQty || (mvMode === 'adjust' && !mvReason) || busy}>
                                Post
                            </Button>
                        </div>
                        {mvMode === 'adjust' && (
                            <FormField label="Reason" required>
                                <Input value={mvReason} onChange={(e) => setMvReason(e.target.value)} placeholder="e.g. stock count correction" />
                            </FormField>
                        )}
                    </form>

                    <div className="mt-default">
                        <Heading level={3}>Ledger</Heading>
                        {lotDetail?.ledger?.length ? (
                            <ul className="mt-2 space-y-tight text-sm">
                                {lotDetail.ledger.map((t) => (
                                    <li key={t.id} className="flex items-center justify-between border-b border-border-subtle py-1.5">
                                        <span className="flex items-center gap-compact">
                                            <StatusBadge variant={t.quantityDelta < 0 ? 'error' : 'success'}>{t.type}</StatusBadge>
                                            <span className="text-content-muted">{formatDate(t.occurredAt)}</span>
                                            {t.reason && <span className="text-content-subtle">· {t.reason}</span>}
                                        </span>
                                        <span className={t.quantityDelta < 0 ? 'text-content-error' : 'text-content-success'}>
                                            {t.quantityDelta > 0 ? '+' : ''}
                                            {t.quantityDelta} {t.unitSymbol}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-content-subtle">No movements yet.</p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="secondary" size="sm" type="button" onClick={() => setActiveLotId(null)}>Close</Button>
                </Modal.Actions>
            </Modal>
        </ListPageShell>
    );
}
