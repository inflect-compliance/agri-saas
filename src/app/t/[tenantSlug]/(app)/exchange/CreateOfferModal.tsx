'use client';

/**
 * Create-offer modal — publish a SELL or BUY listing to the Exchange.
 *
 * region is chosen by oblast (Combobox from bulgaria-regions); the server
 * derives regionName/lat/lon from the code. commodity is a seeded catalogue
 * that also accepts a free-text entry (Combobox `onCreate`). Free text
 * (description / sellerDisplayName) is sanitized server-side. On success the
 * parent optimistically adds the new listing to the map + list.
 */
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { BULGARIA_REGION_OPTIONS } from '@/lib/geo/bulgaria-regions';
import type { ExchangePublicListing } from '@/lib/exchange/public-listing';

const COMMODITY_SEED = [
    'Wheat', 'Maize', 'Sunflower', 'Barley', 'Rapeseed',
    'Oats', 'Rye', 'Soybean', 'Peas', 'Lentils',
];

interface CreateOfferModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    /** Fallback public display name (the tenant name) shown in the hint. */
    defaultSellerName?: string;
    onCreated: (listing: ExchangePublicListing) => void;
}

export function CreateOfferModal({ open, setOpen, defaultSellerName, onCreated }: CreateOfferModalProps) {
    const buildUrl = useTenantApiUrl();

    const [side, setSide] = useState<'SELL' | 'BUY'>('SELL');
    const [commodity, setCommodity] = useState('');
    const [commodityExtra, setCommodityExtra] = useState<string[]>([]);
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [currency, setCurrency] = useState('BGN');
    const [regionCode, setRegionCode] = useState('');
    const [description, setDescription] = useState('');
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const commodityOptions = useMemo<ComboboxOption[]>(
        () => [...COMMODITY_SEED, ...commodityExtra].map((c) => ({ value: c, label: c })),
        [commodityExtra],
    );
    const regionOptions = useMemo<ComboboxOption[]>(() => [...BULGARIA_REGION_OPTIONS], []);

    const qtyNum = Number(quantity);
    const canSubmit =
        commodity.trim().length > 0 &&
        regionCode.length > 0 &&
        quantity.trim().length > 0 &&
        Number.isFinite(qtyNum) &&
        qtyNum > 0 &&
        !submitting;

    const isDirty =
        commodity !== '' || regionCode !== '' || quantity !== '' || price !== '' ||
        description !== '' || displayName !== '' || expiresAt !== null;

    function reset() {
        setSide('SELL'); setCommodity(''); setCommodityExtra([]); setQuantity('');
        setPrice(''); setCurrency('BGN'); setRegionCode(''); setDescription('');
        setExpiresAt(null); setDisplayName(''); setError(null);
    }

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            const created = await apiPost<ExchangePublicListing>(buildUrl('/exchange/listings'), {
                side,
                commodity: commodity.trim(),
                quantityTonnes: quantity.trim(),
                pricePerTonne: price.trim() === '' ? null : price.trim(),
                priceCurrency: currency.trim() || 'BGN',
                regionCode,
                description: description.trim() === '' ? null : description.trim(),
                sellerDisplayName: displayName.trim() === '' ? null : displayName.trim(),
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
            });
            onCreated(created);
            setOpen(false);
            reset();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create offer');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="lg"
            title="New offer"
            description="Publish a sell or buy offer to the cross-tenant marketplace."
            preventDefaultClose={submitting}
            isDirty={isDirty}
        >
            <Modal.Header title="New offer" description="Publish a sell or buy offer to the marketplace." />
            <Modal.Form id="exchange-offer-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <Modal.Body>
                    {error && (
                        <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                            {error}
                        </div>
                    )}
                    <fieldset disabled={submitting} className="m-0 space-y-default border-0 p-0">
                        <FormField label="Side" required>
                            <RadioGroup
                                value={side}
                                onValueChange={(v) => setSide(v as 'SELL' | 'BUY')}
                                className="flex gap-section"
                            >
                                <label className="flex items-center gap-compact text-sm">
                                    <RadioGroupItem value="SELL" /> Selling
                                </label>
                                <label className="flex items-center gap-compact text-sm">
                                    <RadioGroupItem value="BUY" /> Buying
                                </label>
                            </RadioGroup>
                        </FormField>

                        <FormField label="Commodity" required>
                            <Combobox
                                id="exchange-commodity"
                                options={commodityOptions}
                                selected={commodityOptions.find((o) => o.value === commodity) ?? null}
                                setSelected={(o) => setCommodity(o?.value ?? '')}
                                placeholder="Select or type a commodity"
                                searchPlaceholder="Search commodities…"
                                matchTriggerWidth
                                onCreate={async (search) => {
                                    const v = search.trim();
                                    if (!v) return false;
                                    setCommodityExtra((prev) => (prev.includes(v) ? prev : [...prev, v]));
                                    setCommodity(v);
                                    return true;
                                }}
                                createLabel={(search) => `Use "${search.trim()}"`}
                            />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-3">
                            <FormField label="Quantity (t)" required>
                                <Input id="exchange-qty" inputMode="decimal" autoComplete="off" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 250" />
                            </FormField>
                            <FormField label="Price / tonne" hint={side === 'BUY' ? 'Optional — leave blank for market' : 'Optional'}>
                                <Input id="exchange-price" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 320" />
                            </FormField>
                            <FormField label="Currency">
                                <Input id="exchange-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="BGN" maxLength={8} />
                            </FormField>
                        </div>

                        <FormField label="Region" required description="Bulgarian oblast — the map pin is placed at its centre.">
                            <Combobox
                                id="exchange-region"
                                options={regionOptions}
                                selected={regionOptions.find((o) => o.value === regionCode) ?? null}
                                setSelected={(o) => setRegionCode(o?.value ?? '')}
                                placeholder="Select a region"
                                searchPlaceholder="Search regions…"
                                matchTriggerWidth
                            />
                        </FormField>

                        <FormField label="Description" hint="Shown publicly to every tenant.">
                            <Textarea id="exchange-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Grade, moisture, delivery terms…" />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label="Expires" hint="Optional — auto-hides after this date.">
                                <DatePicker id="exchange-expires" className="w-full" value={expiresAt} onChange={setExpiresAt} clearable placeholder="Select date" disabledDays={{ before: new Date() }} />
                            </FormField>
                            <FormField label="Public seller name" hint={`Optional. Shown publicly. Blank = ${defaultSellerName || 'your tenant name'}.`}>
                                <Input id="exchange-seller-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={defaultSellerName || 'Your farm name'} maxLength={120} />
                            </FormField>
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button variant="primary" size="sm" type="submit" loading={submitting} disabled={!canSubmit}>
                        Create offer
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
