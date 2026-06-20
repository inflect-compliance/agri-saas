'use client';

/**
 * ParcelDetailSheet — the parcel "what & how much" card, surfaced as a
 * bottom-sheet (vaul) when an operator taps a parcel on the phone-native
 * map (or a parcel card on the Parcels tab). Replaces the old "scroll way
 * down to a side list" detail with a thumb-reachable sheet pinned to the
 * bottom of the screen, right where the tapped parcel is.
 *
 * Built on the canonical {@link Sheet} primitive (`direction="bottom"`),
 * so it drags + dismisses like every other mobile drawer. On desktop the
 * Location detail keeps its inline side panel; this sheet is the mobile
 * surface.
 *
 * Content: area, crop, last application (graceful empty state until a
 * per-parcel applications query lands), a pure-client apply-rate
 * calculator (rate/ha × area → total product), and a "Start operation
 * here" action that hands the parcel back to the host to launch a spray
 * job.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { QrCode } from '@/components/ui/qr-code';

export interface ParcelSheetData {
    id: string;
    name: string;
    areaHa?: number | null;
    cropType?: string | null;
    /**
     * Most-recent input application on this parcel, when known. Optional:
     * the Location parcels payload doesn't carry it yet, so the sheet
     * renders a tidy empty state until a per-parcel applications query is
     * wired (tracked as a follow-up).
     */
    lastApplication?: { label: string; occurredAt?: string | null } | null;
}

export interface ParcelDetailSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parcel: ParcelSheetData | null;
    /** Launch a spray job seeded with this parcel. Omit to hide the action. */
    onStartOperation?: (parcelId: string) => void;
    /** Absolute deep-link to this parcel — rendered as a scannable QR. */
    deepLinkUrl?: string;
}

function formatNumber(n: number): string {
    // Trim trailing zeros; cap at 2dp so the total reads cleanly.
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function ParcelDetailSheet({ open, onOpenChange, parcel, onStartOperation, deepLinkUrl }: ParcelDetailSheetProps) {
    const [rate, setRate] = useState('');

    // Reset the calculator whenever a different parcel takes the sheet.
    useEffect(() => { setRate(''); }, [parcel?.id]);

    const area = parcel?.areaHa ?? null;
    const total = useMemo(() => {
        const r = Number.parseFloat(rate);
        if (!Number.isFinite(r) || r <= 0 || area == null) return null;
        return r * area;
    }, [rate, area]);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            direction="bottom"
            // Non-modal: the sheet sits over the map while the map-mode
            // toolbar (Select/Draw/Edit/Split + Merge) above it stays
            // reachable — tapping a parcel to inspect it must not lock the
            // operator out of switching modes or merging.
            modal={false}
            title={parcel?.name ?? 'Parcel'}
            description="Parcel detail and apply-rate calculator"
        >
            <Sheet.Header title={parcel?.name ?? 'Parcel'} />
            <Sheet.Body className="space-y-section">
                <dl className="grid grid-cols-2 gap-default text-sm">
                    <div>
                        <dt className="text-content-secondary">Area</dt>
                        <dd className="font-medium" data-testid="parcel-sheet-area">
                            {area != null ? `${formatNumber(area)} ha` : '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-content-secondary">Crop</dt>
                        <dd className="font-medium" data-testid="parcel-sheet-crop">{parcel?.cropType ?? '—'}</dd>
                    </div>
                    <div className="col-span-2">
                        <dt className="text-content-secondary">Last application</dt>
                        <dd className="font-medium">
                            {parcel?.lastApplication
                                ? `${parcel.lastApplication.label}${parcel.lastApplication.occurredAt ? ` · ${parcel.lastApplication.occurredAt}` : ''}`
                                : 'No applications recorded yet'}
                        </dd>
                    </div>
                </dl>

                {/* Apply-rate calculator — pure client maths, no round-trip. */}
                <div className="space-y-default rounded-lg border border-border-subtle p-4">
                    <p className="text-sm font-medium text-content-emphasis">Apply-rate calculator</p>
                    <FormField label="Rate per hectare">
                        <Input
                            value={rate}
                            onChange={(e) => setRate(e.target.value)}
                            inputMode="decimal"
                            placeholder="e.g. 2.5"
                            aria-label="Rate per hectare"
                            data-testid="parcel-sheet-rate"
                        />
                    </FormField>
                    <p className="text-sm text-content-secondary" data-testid="parcel-sheet-total" aria-live="polite">
                        {total != null
                            ? `Total for this parcel: ${formatNumber(total)} (${formatNumber(Number.parseFloat(rate))} × ${formatNumber(area!)} ha)`
                            : area == null
                                ? 'Parcel area unknown — total can’t be computed.'
                                : 'Enter a rate to compute the total for this parcel.'}
                    </p>
                </div>

                {deepLinkUrl && (
                    <div className="flex items-center gap-default rounded-lg border border-border-subtle p-4">
                        <QrCode
                            value={deepLinkUrl}
                            size={96}
                            title={`QR code linking to ${parcel?.name ?? 'this field'}`}
                            className="shrink-0 rounded-md bg-white p-1"
                        />
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-content-emphasis">Field QR</p>
                            <p className="text-xs text-content-secondary">
                                Scan to open this field on a phone — pin it by the gate or in the cab.
                            </p>
                        </div>
                    </div>
                )}
            </Sheet.Body>
            {onStartOperation && parcel && (
                <Sheet.Actions align="between">
                    <Sheet.Close asChild>
                        <Button variant="secondary" size="lg">Close</Button>
                    </Sheet.Close>
                    <Button
                        variant="primary"
                        size="lg"
                        data-testid="parcel-sheet-start-operation"
                        onClick={() => onStartOperation(parcel.id)}
                    >
                        Start operation here
                    </Button>
                </Sheet.Actions>
            )}
        </Sheet>
    );
}

export default ParcelDetailSheet;
