/**
 * БАБХ "ДНЕВНИК за проведените растителнозащитни мероприятия и торене"
 * (Приложение 1 към заповед № РД 11-3194/31.12.2021 г.) PDF generator.
 *
 * Structure mirrors the other generators (`year-on-farm.ts`): data is
 * pulled INSIDE the usecase and the built doc is returned WITHOUT calling
 * `.end()` (the route's collectPdfBuffer finalises).
 *
 * The document language is Bulgarian regardless of UI locale, so every
 * label is an inline literal in the `L` map below.
 *
 * Cyrillic: the doc is created with `fontFamily: 'unicode'`, which makes
 * `createPdfDocument` register DejaVu Sans over the 'Helvetica' names — so
 * every `.font('Helvetica'…)` call renders Cyrillic instead of tofu.
 *
 * Layout: the shared table/section/layout helpers are A4-portrait-locked,
 * so the wide (landscape) tables are drawn by the small orientation-aware
 * helpers in this file (`drawRuledTable`, cover primitives).
 */
import type { RequestContext } from '@/app-layer/types';
import { assertCanRead } from '@/app-layer/policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { resolveOperationType } from '@/app-layer/usecases/field-operation';
import { createPdfDocument } from '@/lib/pdf/pdfKitFactory';
import type { ReportMeta } from '@/lib/pdf/types';

// ─────────────────────────────────────────────────────────────────────
// Bulgarian labels (document language is BG regardless of UI locale)
// ─────────────────────────────────────────────────────────────────────

export interface DiaryLabels {
    appendixLine: string;
    title1: string;
    title2: string;
    municipality: string;
    settlement: string;
    producer: string;
    producerHint: string;
    address: string;
    egn: string;
    eik: string;
    agriDirectorate: string;
    registrationPlace: string;
    ekatte: string;
    odbh: string;
    legalLine: string;
    observationSection: string;
    chemicalSection: string;
    fertilizerSection: string;
    samplingSection: string;
    inspectorSection: string;
    field: string;
    culture: string;
    variety: string;
    sownArea: string;
    predecessor: string;
    page: string;
    of: string;
    period: string;
    // column header groups
    obsCols: string[];
    chemCols: string[];
    fertCols: string[];
    sampleCols: string[];
    inspectorCols: string[];
}

export const BG_LABELS: DiaryLabels = {
    appendixLine:
        'Приложение 1 към заповед № РД 11-3194/31.12.2021 г. на изпълнителния директор на БАБХ',
    title1: 'Д Н Е В Н И К',
    title2: 'ЗА ПРОВЕДЕНИТЕ РАСТИТЕЛНОЗАЩИТНИ МЕРОПРИЯТИЯ И ТОРЕНЕ',
    municipality: 'Община',
    settlement: 'Населено място',
    producer: 'Земеделски производител',
    producerHint: '/ име презиме фамилия / фирма /',
    address: 'Адрес',
    egn: 'ЕГН',
    eik: 'ЕИК',
    agriDirectorate: 'Областна дирекция „Земеделие“ гр.',
    registrationPlace: 'Място на регистриране',
    ekatte: 'ЕКАТТЕ на регистрация',
    odbh: 'Областна дирекция по безопасност на храните (ОДБХ) гр.',
    legalLine:
        'Записите в дневника се водят на основание чл. 115 а и чл. 142, ал. 3 от Закона за защита на растенията',
    observationSection:
        'ПОЯВА, РАЗВИТИЕ, ПЛЪТНОСТ ИЛИ СТЕПЕН НА НАПАДЕНИЕ ОТ ВРЕДИТЕЛИ',
    chemicalSection: 'ПРОВЕДЕНИ ХИМИЧНИ ОБРАБОТКИ',
    fertilizerSection: 'УПОТРЕБЕНИ МИНЕРАЛНИ И ОРГАНИЧНИ ТОРОВЕ',
    samplingSection: 'ВЗЕТИ ПРОБИ',
    inspectorSection: 'РЕЗУЛТАТ ОТ ПРОВЕРКАТА НА ИНСПЕКТОР ОТ ОДБХ',
    field: '№ на полето според единния регистър на площите',
    culture: 'Култура',
    variety: 'Сорт/хибрид',
    sownArea: 'Засята площ (дка)',
    predecessor: 'Предшественик',
    page: 'стр.',
    of: 'от',
    period: 'Период',
    obsCols: [
        'Дата, месец, година',
        'Фенофаза/BBCH',
        'Болест',
        'Обследвана площ (дка)',
        'Нападната площ (дка)',
        'Степен на нападение %',
        'Неприятел',
        'Обследвана площ (дка)',
        'Нападната площ (дка)',
        'Стадии на развитие',
        'Плътност',
    ],
    chemCols: [
        'Пореден №',
        'Дата, месец, година',
        'Вредител',
        'Употребено средство за РЗ /търговско наименование/',
        'Доза на приложение',
        'Третирани площи (дка)',
        'Техника за приложение',
        'Карантинен срок на ПРЗ',
        'Най-ранна дата за прибиране',
        'Име и № на сертификат (чл. 84, ал. 2)',
        'Име и № на сертификат (чл. 84, ал. 1)',
        'Подпис',
    ],
    fertCols: [
        '№',
        'Дата',
        'Търговско наименование (състав; акт. в-во %)',
        'Употребено количество (кг/дка)',
        'Наторени площи (дка)',
    ],
    sampleCols: [
        '№',
        'Дата',
        'Култура',
        'Проба от',
        'Вид анализ',
        'Лаборатория',
        'Резултат',
        'Мярка',
        'МДГ',
        'Съответствие',
        'Забележка',
        'Подпис',
    ],
    inspectorCols: ['Дата', 'Констатации', 'Предписания', 'Подпис на инспектор'],
};

// ─────────────────────────────────────────────────────────────────────
// Data shapes (the render function is pure over these — DB-free, testable)
// ─────────────────────────────────────────────────────────────────────

export interface FarmProfileData {
    producerName: string | null;
    egn: string | null;
    eik: string | null;
    address: string | null;
    municipality: string | null;
    settlement: string | null;
    agricultureDirectorateCity: string | null;
    registrationPlace: string | null;
    registrationEkatte: string | null;
    odbhCity: string | null;
}

export interface SprayLineData {
    completedAt: Date | null;
    targetNote: string | null;
    productName: string;
    dose: string;
    areaHa: number | null;
    applicationTechnique: string | null;
    quarantineDays: number | null;
    operatorCertNo: string | null;
    agronomistName: string | null;
    agronomistCertNo: string | null;
}

export interface FertilizeLineData {
    completedAt: Date | null;
    productName: string;
    activeIngredient: string | null;
    dose: string;
    areaHa: number | null;
}

export interface ObservationData {
    occurredAt: Date | null;
    phenophase: string | null;
    disease: string | null;
    pest: string | null;
}

export interface FarmRecordData {
    locationName: string;
    from: string;
    to: string;
    profile: FarmProfileData;
    sprayLines: SprayLineData[];
    fertilizeLines: FertilizeLineData[];
    observations: ObservationData[];
}

// ─────────────────────────────────────────────────────────────────────
// Pure row builders (unit-tested directly)
// ─────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Decares (дка) = hectares × 10. Rounded to 2 decimals; blank when unset. */
function toDka(areaHa: number | null): string {
    if (areaHa == null) return '';
    return String(Math.round(areaHa * 10 * 100) / 100);
}

/** One 12-column row per completed spray line (химични обработки). */
export function buildChemicalRows(lines: SprayLineData[]): string[][] {
    return lines.map((l, i) => {
        const earliestHarvest =
            l.completedAt && l.quarantineDays != null
                ? fmtDate(new Date(l.completedAt.getTime() + l.quarantineDays * DAY_MS))
                : '';
        const agronomist = [l.agronomistName, l.agronomistCertNo]
            .filter(Boolean)
            .join(' / ');
        return [
            String(i + 1),
            fmtDate(l.completedAt),
            l.targetNote ?? '',
            l.productName,
            l.dose,
            toDka(l.areaHa),
            l.applicationTechnique ?? '',
            l.quarantineDays != null ? String(l.quarantineDays) : '',
            earliestHarvest,
            l.operatorCertNo ?? '',
            agronomist,
            '', // Подпис — always wet-signed by hand
        ];
    });
}

/** One 5-column row per completed fertilize line (торове). */
export function buildFertilizerRows(lines: FertilizeLineData[]): string[][] {
    return lines.map((l, i) => [
        String(i + 1),
        fmtDate(l.completedAt),
        [l.productName, l.activeIngredient].filter(Boolean).join('; '),
        l.dose,
        toDka(l.areaHa),
    ]);
}

/** Best-effort 11-column observation rows from OBSERVATION journal entries. */
export function buildObservationRows(obs: ObservationData[]): string[][] {
    return obs.map((o) => [
        fmtDate(o.occurredAt),
        o.phenophase ?? '',
        o.disease ?? '',
        '',
        '',
        '',
        o.pest ?? '',
        '',
        '',
        '',
        '',
    ]);
}

// ─────────────────────────────────────────────────────────────────────
// Orientation-aware drawing primitives (this file only)
// ─────────────────────────────────────────────────────────────────────

const INK = '#0f172a';
const MUTED = '#64748b';
const GRID = '#cbd5e1';
const HEADER_BG = '#e2e8f0';

interface RuledColumn {
    weight: number;
    align?: 'left' | 'center' | 'right';
}

/**
 * Draw a ruled table (header + data rows + optional blank ruled rows) that
 * fits the CURRENT page's orientation. Repeats the header on page breaks
 * (preserving orientation) and wraps long Cyrillic cell text.
 */
function drawRuledTable(
    doc: PDFKit.PDFDocument,
    startY: number,
    headers: string[],
    columns: RuledColumn[],
    rows: string[][],
    blankRows: number,
): number {
    const pad = 3;
    const fontSize = 7;
    const isLandscape = doc.page.width > doc.page.height;
    const m = doc.page.margins;
    const availW = doc.page.width - m.left - m.right;
    const totalWeight = columns.reduce((s, c) => s + c.weight, 0);
    const widths = columns.map((c) => (c.weight / totalWeight) * availW);

    const drawHeaderRow = (y: number): number => {
        doc.font('Helvetica-Bold').fontSize(fontSize);
        let hh = 0;
        headers.forEach((h, i) => {
            const measured = doc.heightOfString(h, { width: widths[i] - 2 * pad });
            if (measured > hh) hh = measured;
        });
        hh += 2 * pad;
        let x = m.left;
        headers.forEach((h, i) => {
            doc.rect(x, y, widths[i], hh).fillAndStroke(HEADER_BG, '#94a3b8');
            doc.fillColor(INK).text(h, x + pad, y + pad, {
                width: widths[i] - 2 * pad,
                align: columns[i].align ?? 'left',
                lineBreak: true,
            });
            x += widths[i];
        });
        return y + hh;
    };

    const pageBottom = () => doc.page.height - m.bottom;

    let y = drawHeaderRow(startY);

    const drawCells = (cells: string[], minHeight: number): void => {
        doc.font('Helvetica').fontSize(fontSize);
        let rh = 0;
        cells.forEach((txt, i) => {
            const measured = doc.heightOfString(String(txt ?? ''), {
                width: widths[i] - 2 * pad,
            });
            if (measured > rh) rh = measured;
        });
        rh = Math.max(rh + 2 * pad, minHeight);
        if (y + rh > pageBottom()) {
            doc.addPage({
                size: 'A4',
                layout: isLandscape ? 'landscape' : 'portrait',
            });
            y = drawHeaderRow(m.top);
        }
        let x = m.left;
        cells.forEach((txt, i) => {
            doc.rect(x, y, widths[i], rh).stroke(GRID);
            doc.fillColor(INK).text(String(txt ?? ''), x + pad, y + pad, {
                width: widths[i] - 2 * pad,
                align: columns[i].align ?? 'left',
                lineBreak: true,
            });
            x += widths[i];
        });
        y += rh;
    };

    for (const row of rows) drawCells(row, 14);
    for (let i = 0; i < blankRows; i++) drawCells(headers.map(() => ''), 16);

    return y;
}

/** A row of `count` small boxed cells (ЕГН/ЕИК/ЕКАТТЕ), digits filled from `value`. */
function drawBoxedCells(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    count: number,
    value: string | null,
): void {
    const cw = 14;
    const ch = 16;
    const digits = (value ?? '').replace(/\s/g, '').slice(0, count).split('');
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    for (let i = 0; i < count; i++) {
        const cx = x + i * cw;
        doc.rect(cx, y, cw, ch).stroke(GRID);
        if (digits[i]) {
            doc.text(digits[i], cx, y + 3, { width: cw, align: 'center', lineBreak: false });
        }
    }
}

/** "Label ......value......" — value when set, else a dotted rule. */
function drawLabeledLine(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    label: string,
    value: string | null,
): number {
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    const labelText = `${label}: `;
    const labelW = doc.widthOfString(labelText);
    doc.text(labelText, x, y, { lineBreak: false });
    const valueX = x + labelW;
    const valueW = width - labelW;
    if (value && value.trim()) {
        doc.text(value, valueX, y, { width: valueW, lineBreak: false });
    } else {
        // dotted fill
        doc.fillColor(MUTED).text('.'.repeat(Math.max(3, Math.floor(valueW / 3))), valueX, y, {
            width: valueW,
            lineBreak: false,
        });
        doc.fillColor(INK);
    }
    return y + 20;
}

// ─────────────────────────────────────────────────────────────────────
// Pure render (DB-free) — draws the whole form from shaped data
// ─────────────────────────────────────────────────────────────────────

export function renderFarmRecordDiary(
    doc: PDFKit.PDFDocument,
    data: FarmRecordData,
    L: DiaryLabels,
): void {
    const p = data.profile;

    // ── PORTRAIT COVER ──────────────────────────────────────────────
    const m = doc.page.margins;
    const contentW = doc.page.width - m.left - m.right;
    let y = m.top;

    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(L.appendixLine, m.left, y, { width: contentW, align: 'center' });
    y = doc.y + 14;

    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK);
    doc.text(L.title1, m.left, y, { width: contentW, align: 'center' });
    y = doc.y + 2;
    doc.fontSize(12).text(L.title2, m.left, y, { width: contentW, align: 'center' });
    y = doc.y + 20;

    y = drawLabeledLine(doc, m.left, y, contentW, L.municipality, p.municipality);
    y = drawLabeledLine(doc, m.left, y, contentW, L.settlement, p.settlement);
    y = drawLabeledLine(doc, m.left, y, contentW, L.producer, p.producerName);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(L.producerHint, m.left, y - 4, {
        width: contentW,
    });
    y += 8;
    y = drawLabeledLine(doc, m.left, y, contentW, L.address, p.address);

    // Boxed ЕГН (10) + ЕИК (13)
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${L.egn}:`, m.left, y, { lineBreak: false });
    drawBoxedCells(doc, m.left + 40, y - 3, 10, p.egn);
    y += 24;
    doc.text(`${L.eik}:`, m.left, y, { lineBreak: false });
    drawBoxedCells(doc, m.left + 40, y - 3, 13, p.eik);
    y += 28;

    y = drawLabeledLine(doc, m.left, y, contentW, L.agriDirectorate, p.agricultureDirectorateCity);
    y = drawLabeledLine(doc, m.left, y, contentW, L.registrationPlace, p.registrationPlace);
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${L.ekatte}:`, m.left, y, { lineBreak: false });
    drawBoxedCells(doc, m.left + 130, y - 3, 5, p.registrationEkatte);
    y += 26;
    y = drawLabeledLine(doc, m.left, y, contentW, L.odbh, p.odbhCity);
    y += 8;

    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(L.legalLine, m.left, y, { width: contentW });
    y = doc.y + 8;
    doc.fontSize(9).fillColor(INK).text(
        `${L.period}: ${fmtDate(new Date(data.from))} – ${fmtDate(new Date(data.to))}   •   ${data.locationName}`,
        m.left,
        y,
        { width: contentW },
    );

    // ── LANDSCAPE: observation section ──────────────────────────────
    doc.addPage({ size: 'A4', layout: 'landscape' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text(L.observationSection, doc.page.margins.left, doc.page.margins.top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
    });
    const obsRows = buildObservationRows(data.observations);
    const obsCols: RuledColumn[] = L.obsCols.map(() => ({ weight: 1 }));
    drawRuledTable(
        doc,
        doc.y + 8,
        L.obsCols,
        obsCols,
        obsRows,
        Math.max(0, 8 - obsRows.length),
    );

    // ── LANDSCAPE: chemical treatments (the core) ───────────────────
    doc.addPage({ size: 'A4', layout: 'landscape' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text(L.chemicalSection, doc.page.margins.left, doc.page.margins.top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
    });
    const chemRows = buildChemicalRows(data.sprayLines);
    // Column weights ~ the form's relative widths.
    const chemWeights = [0.6, 1.1, 1.3, 2.2, 1.1, 1, 1.3, 1, 1.3, 2, 2, 1];
    const chemCols: RuledColumn[] = chemWeights.map((w, i) => ({
        weight: w,
        align: i === 0 ? 'center' : 'left',
    }));
    drawRuledTable(
        doc,
        doc.y + 8,
        L.chemCols,
        chemCols,
        chemRows,
        Math.max(0, 6 - chemRows.length),
    );

    // ── PORTRAIT: fertilizers ───────────────────────────────────────
    doc.addPage({ size: 'A4', layout: 'portrait' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text(L.fertilizerSection, doc.page.margins.left, doc.page.margins.top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
    });
    const fertRows = buildFertilizerRows(data.fertilizeLines);
    const fertCols: RuledColumn[] = [
        { weight: 0.5, align: 'center' },
        { weight: 1.2 },
        { weight: 3 },
        { weight: 1.6, align: 'right' },
        { weight: 1.4, align: 'right' },
    ];
    drawRuledTable(
        doc,
        doc.y + 8,
        L.fertCols,
        fertCols,
        fertRows,
        Math.max(0, 6 - fertRows.length),
    );

    // ── LANDSCAPE: sampling (empty ruled) ───────────────────────────
    doc.addPage({ size: 'A4', layout: 'landscape' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text(L.samplingSection, doc.page.margins.left, doc.page.margins.top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
    });
    drawRuledTable(doc, doc.y + 8, L.sampleCols, L.sampleCols.map(() => ({ weight: 1 })), [], 8);

    // ── PORTRAIT: ОДБХ inspector result (empty ruled) ───────────────
    doc.addPage({ size: 'A4', layout: 'portrait' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text(L.inspectorSection, doc.page.margins.left, doc.page.margins.top, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
    });
    drawRuledTable(
        doc,
        doc.y + 8,
        L.inspectorCols,
        [{ weight: 1 }, { weight: 3 }, { weight: 3 }, { weight: 1.5 }],
        [],
        8,
    );

    stampPageNumbers(doc, L);
}

/** Stamp "стр. X от Y" in the bottom margin of every buffered page. */
function stampPageNumbers(doc: PDFKit.PDFDocument, L: DiaryLabels): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const w = doc.page.width;
        const h = doc.page.height;
        const mp = doc.page.margins;
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
            `${L.page} ${i - range.start + 1} ${L.of} ${range.count}`,
            mp.left,
            h - mp.bottom + 12,
            { width: w - mp.left - mp.right, align: 'center', lineBreak: false, height: 12 },
        );
    }
}

// ─────────────────────────────────────────────────────────────────────
// Data gathering (DB) + public entry point
// ─────────────────────────────────────────────────────────────────────

interface CertSnapshot {
    operatorCertNo?: string | null;
    agronomistName?: string | null;
    agronomistCertNo?: string | null;
    applicationTechnique?: string | null;
}

const EMPTY_PROFILE: FarmProfileData = {
    producerName: null,
    egn: null,
    eik: null,
    address: null,
    municipality: null,
    settlement: null,
    agricultureDirectorateCity: null,
    registrationPlace: null,
    registrationEkatte: null,
    odbhCity: null,
};

export async function gatherFarmRecordData(
    ctx: RequestContext,
    locationId: string,
    from: string,
    to: string,
): Promise<FarmRecordData> {
    // Report read-gate (same privilege model as year-on-farm). Read the
    // FarmProfile directly (NOT via getFarmProfile, which requires
    // admin-settings permission) — the Epic B extension still decrypts
    // egn/eik transparently on this read.
    assertCanRead(ctx);
    const fromD = new Date(from);
    const toD = new Date(to);

    return runInTenantContext(ctx, async (db) => {
        const location = await db.location.findFirst({
            where: { id: locationId, tenantId: ctx.tenantId },
            select: { name: true },
        });

        const profileRow = await db.farmProfile.findUnique({
            where: { tenantId: ctx.tenantId },
        });
        const profile: FarmProfileData = profileRow
            ? {
                  producerName: profileRow.producerName ?? null,
                  egn: profileRow.egn ?? null,
                  eik: profileRow.eik ?? null,
                  address: profileRow.address ?? null,
                  municipality: profileRow.municipality ?? null,
                  settlement: profileRow.settlement ?? null,
                  agricultureDirectorateCity: profileRow.agricultureDirectorateCity ?? null,
                  registrationPlace: profileRow.registrationPlace ?? null,
                  registrationEkatte: profileRow.registrationEkatte ?? null,
                  odbhCity: profileRow.odbhCity ?? null,
              }
            : { ...EMPTY_PROFILE };

        const links = await db.taskLink.findMany({
            where: { tenantId: ctx.tenantId, entityType: 'LOCATION', entityId: locationId },
            select: { taskId: true },
        });
        const taskIds = links.map((l) => l.taskId);

        const lines = taskIds.length
            ? await db.operationParcel.findMany({
                  where: {
                      tenantId: ctx.tenantId,
                      taskId: { in: taskIds },
                      status: 'DONE',
                      completedAt: { gte: fromD, lte: toD },
                  },
                  include: {
                      task: {
                          select: {
                              operationType: true,
                              applicationTechnique: true,
                              title: true,
                              key: true,
                              assigneeUserId: true,
                          },
                      },
                      product: {
                          select: {
                              name: true,
                              quarantinePeriodDays: true,
                              activeIngredient: true,
                              pppRegistrationNo: true,
                          },
                      },
                      doseUnit: { select: { symbol: true } },
                      parcel: { select: { name: true, cropType: true, areaHa: true } },
                  },
                  orderBy: { completedAt: 'asc' },
              })
            : [];

        // Cert snapshots (frozen at completion) keyed by operationParcelId.
        const lineIds = lines.map((l) => l.id);
        const logs = lineIds.length
            ? await db.logEntry.findMany({
                  where: {
                      tenantId: ctx.tenantId,
                      type: 'INPUT_APPLICATION',
                      operationParcelId: { in: lineIds },
                  },
                  select: { operationParcelId: true, conditionsJson: true },
              })
            : [];
        const condByLine = new Map<string, CertSnapshot>();
        for (const le of logs) {
            if (le.operationParcelId && le.conditionsJson && typeof le.conditionsJson === 'object') {
                condByLine.set(le.operationParcelId, le.conditionsJson as CertSnapshot);
            }
        }

        // Live-membership fallback for legacy lines with no snapshot.
        const fallbackUserIds = [
            ...new Set(
                lines
                    .filter((l) => !condByLine.get(l.id))
                    .map((l) => l.task.assigneeUserId)
                    .filter((v): v is string => Boolean(v)),
            ),
        ];
        const memberByUser = new Map<
            string,
            { applicatorCertNo: string | null; agronomistCertNo: string | null; agronomistName: string | null }
        >();
        if (fallbackUserIds.length) {
            const members = await db.tenantMembership.findMany({
                where: { tenantId: ctx.tenantId, userId: { in: fallbackUserIds } },
                select: {
                    userId: true,
                    applicatorCertNo: true,
                    agronomistCertNo: true,
                    agronomistName: true,
                },
            });
            for (const mem of members) memberByUser.set(mem.userId, mem);
        }

        const sprayLines: SprayLineData[] = [];
        const fertilizeLines: FertilizeLineData[] = [];
        for (const l of lines) {
            const opType = resolveOperationType(l.task);
            const cond = condByLine.get(l.id);
            const fb = l.task.assigneeUserId ? memberByUser.get(l.task.assigneeUserId) : undefined;
            const dose = `${Number(l.doseValue)} ${l.doseUnit?.symbol ?? ''}`.trim();
            const areaHa = l.parcel?.areaHa != null ? Number(l.parcel.areaHa) : null;

            if (opType === 'FERTILIZE') {
                fertilizeLines.push({
                    completedAt: l.completedAt,
                    productName: l.product?.name ?? '',
                    activeIngredient: l.product?.activeIngredient ?? null,
                    dose,
                    areaHa,
                });
            } else {
                sprayLines.push({
                    completedAt: l.completedAt,
                    targetNote: l.targetNote,
                    productName: l.product?.name ?? '',
                    dose,
                    areaHa,
                    applicationTechnique:
                        cond?.applicationTechnique ?? l.task.applicationTechnique ?? null,
                    quarantineDays: l.product?.quarantinePeriodDays ?? null,
                    operatorCertNo: cond?.operatorCertNo ?? fb?.applicatorCertNo ?? null,
                    agronomistName: cond?.agronomistName ?? fb?.agronomistName ?? null,
                    agronomistCertNo: cond?.agronomistCertNo ?? fb?.agronomistCertNo ?? null,
                });
            }
        }

        const obs = await db.logEntry.findMany({
            where: {
                tenantId: ctx.tenantId,
                type: 'OBSERVATION',
                occurredAt: { gte: fromD, lte: toD },
            },
            select: { occurredAt: true, title: true, notes: true },
            orderBy: { occurredAt: 'asc' },
            take: 100,
        });
        const observations: ObservationData[] = obs.map((o) => ({
            occurredAt: o.occurredAt,
            phenophase: o.title ?? null,
            disease: o.notes ?? null,
            pest: null,
        }));

        return {
            locationName: location?.name ?? '',
            from,
            to,
            profile,
            sprayLines,
            fertilizeLines,
            observations,
        };
    });
}

export async function generateFarmRecordDiaryPdf(
    ctx: RequestContext,
    opts: { locationId: string; from: string; to: string },
): Promise<PDFKit.PDFDocument> {
    const data = await gatherFarmRecordData(ctx, opts.locationId, opts.from, opts.to);

    const meta: ReportMeta = {
        tenantName: data.locationName || 'Farm',
        reportTitle: 'Дневник за проведените растителнозащитни мероприятия и торене',
        reportSubtitle: data.locationName,
        generatedAt: new Date().toISOString(),
        watermark: 'NONE',
        fontFamily: 'unicode',
    };

    const doc = createPdfDocument(meta);
    renderFarmRecordDiary(doc, data, BG_LABELS);

    // NOTE: do NOT call doc.end() — the route's collectPdfBuffer finalises.
    return doc;
}
