/**
 * Unit tests — БАБХ ДНЕВНИК generator (PR2).
 *   - pure row builders (дка = ha×10, earliest-harvest = completedAt + PHI)
 *   - full render smoke: Cyrillic renders (no throw), embeds DejaVu, valid PDF
 *   - blank-profile tolerance
 * DB-free: exercises the pure `renderFarmRecordDiary` over fixture data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createPdfDocument } from '@/lib/pdf/pdfKitFactory';
import {
    renderFarmRecordDiary,
    buildChemicalRows,
    buildFertilizerRows,
    buildObservationRows,
    BG_LABELS,
    type FarmRecordData,
    type SprayLineData,
    type FertilizeLineData,
    type FarmProfileData,
} from '@/app-layer/reports/pdf/farm-record-diary';

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

const PROFILE: FarmProfileData = {
    producerName: 'ЕТ „Иван Петров“',
    egn: '7501011234',
    eik: '203456789',
    address: 'с. Труд, ул. Роза 5',
    municipality: 'Марица',
    settlement: 'Труд',
    agricultureDirectorateCity: 'Пловдив',
    registrationPlace: 'Пловдив',
    registrationEkatte: '73242',
    odbhCity: 'Пловдив',
};

const SPRAY: SprayLineData[] = [
    {
        completedAt: new Date('2026-05-10T08:00:00Z'),
        targetNote: 'Житна пиявица',
        productName: 'Карате Зеон',
        dose: '0.15 л/дка',
        areaHa: 3.5,
        applicationTechnique: 'Наземна пръскачка',
        quarantineDays: 30,
        operatorCertNo: 'APP-123',
        agronomistName: 'Мария Иванова',
        agronomistCertNo: 'AGR-456',
    },
    {
        completedAt: new Date('2026-05-20T08:00:00Z'),
        targetNote: 'Брашнеста мана',
        productName: 'Топас 100 ЕК',
        dose: '0.5 л/дка',
        areaHa: 2,
        applicationTechnique: null,
        quarantineDays: 14,
        operatorCertNo: null,
        agronomistName: null,
        agronomistCertNo: null,
    },
];

const FERT: FertilizeLineData[] = [
    {
        completedAt: new Date('2026-04-01T08:00:00Z'),
        productName: 'Амониев нитрат',
        activeIngredient: 'N 34.4%',
        dose: '25 кг/дка',
        areaHa: 3.5,
    },
];

function fixture(profile: FarmProfileData): FarmRecordData {
    return {
        locationName: 'Северна нива',
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
        profile,
        sprayLines: SPRAY,
        fertilizeLines: FERT,
        observations: [],
    };
}

describe('farm-record-diary — Cyrillic font invariant (guard)', () => {
    // The ДНЕВНИК is Bulgarian: it MUST be built with fontFamily:'unicode'
    // so createPdfDocument remaps Helvetica → DejaVu Sans. Without it the
    // built-in AFM Helvetica renders tofu (or throws) for Cyrillic. This
    // structural guard fails if a refactor drops the unicode opt-in.
    test('the generator creates its document with fontFamily: "unicode"', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../src/app-layer/reports/pdf/farm-record-diary.ts'),
            'utf8',
        );
        expect(src).toMatch(/fontFamily:\s*'unicode'/);
    });
});

describe('farm-record-diary — pure row builders', () => {
    test('buildChemicalRows: one row per spray line, дка = ha×10, earliest-harvest = completedAt + PHI', () => {
        const rows = buildChemicalRows(SPRAY);
        expect(rows).toHaveLength(2);
        // Row 1: area 3.5 ha → 35 дка; PHI 30d from 2026-05-10 → 2026-06-09.
        expect(rows[0][0]).toBe('1');
        expect(rows[0][5]).toBe('35'); // дка column
        expect(rows[0][8]).toBe('09.06.2026'); // earliest harvest
        expect(rows[0][9]).toBe('APP-123'); // operator cert (чл. 84 ал. 2)
        expect(rows[0][10]).toBe('Мария Иванова / AGR-456'); // agronomist (ал. 1)
        expect(rows[0][11]).toBe(''); // Подпис blank
        // Row 2: area 2 ha → 20 дка; blank certs.
        expect(rows[1][5]).toBe('20');
        expect(rows[1][9]).toBe('');
    });

    test('buildFertilizerRows: дка conversion + composition', () => {
        const rows = buildFertilizerRows(FERT);
        expect(rows).toHaveLength(1);
        expect(rows[0][2]).toBe('Амониев нитрат; N 34.4%');
        expect(rows[0][4]).toBe('35'); // 3.5 ha → 35 дка
    });

    test('buildObservationRows: 11 cells, disease/pest at their columns, blanks elsewhere', () => {
        const rows = buildObservationRows([
            {
                occurredAt: new Date('2026-05-01T08:00:00Z'),
                phenophase: 'BBCH 32',
                disease: 'Брашнеста мана',
                pest: 'Листни въшки',
            },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveLength(BG_LABELS.obsCols.length);
        expect(rows[0][0]).toBe('01.05.2026');
        expect(rows[0][1]).toBe('BBCH 32');
        expect(rows[0][2]).toBe('Брашнеста мана'); // Болест
        expect(rows[0][6]).toBe('Листни въшки'); // Неприятел
        // Manually-filled survey columns stay blank (ruled for hand entry).
        for (const i of [3, 4, 5, 7, 8, 9, 10]) expect(rows[0][i]).toBe('');
    });
});

describe('farm-record-diary — render smoke', () => {
    test('renders a multi-section Cyrillic PDF that embeds DejaVu (no tofu, no throw)', async () => {
        const doc = createPdfDocument({
            tenantName: 'Северна нива',
            reportTitle: 'Дневник',
            generatedAt: new Date(0).toISOString(),
            fontFamily: 'unicode',
        });
        expect(() => renderFarmRecordDiary(doc, fixture(PROFILE), BG_LABELS)).not.toThrow();
        const pdf = await collect(doc);
        expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(1000);
        // DejaVu embedded → real Cyrillic glyphs, not Helvetica tofu.
        expect(pdf.includes(Buffer.from('DejaVu'))).toBe(true);
    });

    test('tolerates an all-blank FarmProfile (dotted lines, no throw)', async () => {
        const blank: FarmProfileData = {
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
        const doc = createPdfDocument({
            tenantName: 'Farm',
            reportTitle: 'Дневник',
            generatedAt: new Date(0).toISOString(),
            fontFamily: 'unicode',
        });
        expect(() => renderFarmRecordDiary(doc, fixture(blank), BG_LABELS)).not.toThrow();
        const pdf = await collect(doc);
        expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    });
});
