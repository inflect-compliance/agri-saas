/**
 * ДНЕВНИК print-integrity ratchet — the legally-filed БАБХ farm record
 * (farm-record-diary.ts) must print the RIGHT DATA in the RIGHT COLUMNS.
 *
 * Three invariant families, each with a mutation self-test so the
 * detector itself can't rot:
 *
 *   1. LIFECYCLE — every `logEntry.findMany` in the generator either
 *      filters `deletedAt: null` or carries an explicit
 *      `diary-allow: soft-deleted` sentinel with a written reason.
 *      (Regression class: a soft-deleted "mistaken" observation printing
 *      in a legal document — found live in the July 2026 audit.)
 *
 *   2. PLAIN TEXT — journal `notes` are sanitized RICH-TEXT HTML; the
 *      „Болест" cell must receive them only through
 *      `htmlNotesToPlainText(...)`, never raw.
 *
 *   3. COLUMNS — the BG_LABELS header arrays and the pure row builders
 *      agree on shape AND meaning: cell counts match header counts, and
 *      the semantically-critical headers sit at the exact indexes the
 *      builders target (product name under „Употребено средство…",
 *      operator cert under „чл. 84, ал. 2", agronomist under „ал. 1",
 *      disease under „Болест", pest under „Неприятел", …).
 *
 * Column-order changes are legitimate ONLY when the header array and the
 * row builder move together — then the pins below are updated in the
 * same diff, which is exactly the review this ratchet exists to force.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    BG_LABELS,
    buildChemicalRows,
    buildFertilizerRows,
    buildObservationRows,
    htmlNotesToPlainText,
    type SprayLineData,
    type FertilizeLineData,
    type ObservationData,
} from '@/app-layer/reports/pdf/farm-record-diary';

const GENERATOR_PATH = path.resolve(
    __dirname,
    '../../src/app-layer/reports/pdf/farm-record-diary.ts',
);
const SRC = fs.readFileSync(GENERATOR_PATH, 'utf8');

// ─── 1. Lifecycle: no soft-deleted rows without an explicit sentinel ──

/**
 * For each `logEntry.findMany` call site: PASS when `deletedAt: null`
 * appears in the following argument window, or the sentinel comment
 * `diary-allow: soft-deleted` appears in the preceding comment block.
 * Returns the character offsets of VIOLATING call sites.
 */
function findUnfilteredLogEntryQueries(src: string): number[] {
    const violations: number[] = [];
    const needle = 'logEntry.findMany';
    let idx = src.indexOf(needle);
    while (idx !== -1) {
        const before = src.slice(Math.max(0, idx - 600), idx);
        const after = src.slice(idx, idx + 700);
        const sentinelled = /diary-allow: soft-deleted/.test(before);
        const filtered = /deletedAt:\s*null/.test(after);
        if (!sentinelled && !filtered) violations.push(idx);
        idx = src.indexOf(needle, idx + needle.length);
    }
    return violations;
}

describe('ДНЕВНИК lifecycle — soft-deleted entries never print', () => {
    it('every logEntry.findMany filters deletedAt: null or carries the diary-allow sentinel', () => {
        expect(SRC).toContain('logEntry.findMany'); // the scan has a subject
        expect(findUnfilteredLogEntryQueries(SRC)).toEqual([]);
    });

    it('the OBSERVATION query is the filtered one (the sentinel is not blanket)', () => {
        // The observation block must carry the real filter — a future move
        // of the sentinel onto it would silently re-open the leak.
        const obsIdx = SRC.indexOf("type: 'OBSERVATION'");
        expect(obsIdx).toBeGreaterThan(-1);
        const window = SRC.slice(Math.max(0, obsIdx - 300), obsIdx + 300);
        expect(window).toMatch(/deletedAt:\s*null/);
        expect(window).not.toMatch(/diary-allow: soft-deleted/);
    });

    it('SELF-TEST: removing the filter is detected', () => {
        const mutated = SRC.replace(/deletedAt:\s*null,?/g, '');
        expect(findUnfilteredLogEntryQueries(mutated).length).toBeGreaterThan(0);
    });
});

// ─── 2. Plain text: HTML notes never reach a printed cell raw ─────────

describe('ДНЕВНИК plain text — „Болест" receives flattened notes, never raw HTML', () => {
    it('the observation mapping routes notes through htmlNotesToPlainText', () => {
        expect(SRC).toMatch(/disease:\s*htmlNotesToPlainText\(/);
        expect(SRC).not.toMatch(/disease:\s*o\.notes/);
    });

    it('SELF-TEST: reverting to raw notes is detected', () => {
        const mutated = SRC.replace(
            /disease:\s*htmlNotesToPlainText\(o\.notes\)/,
            'disease: o.notes ?? null',
        );
        expect(/disease:\s*o\.notes/.test(mutated)).toBe(true);
    });

    it('htmlNotesToPlainText strips tags, decodes entities, spaces block joins', () => {
        expect(htmlNotesToPlainText('<p>Мана</p><p>по листата</p>')).toBe('Мана по листата');
        expect(htmlNotesToPlainText('листа &amp; стъбло')).toBe('листа & стъбло');
        expect(htmlNotesToPlainText('първи ред<br>втори ред')).toBe('първи ред втори ред');
        expect(htmlNotesToPlainText('<b>силно</b> нападение')).toBe('силно нападение');
        expect(htmlNotesToPlainText(null)).toBeNull();
        expect(htmlNotesToPlainText('   ')).toBeNull();
        expect(htmlNotesToPlainText('<p></p>')).toBeNull();
    });
});

// ─── 3. Columns: headers ↔ builder cells agree in count AND meaning ───

const SPRAY: SprayLineData = {
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
};

const FERT: FertilizeLineData = {
    completedAt: new Date('2026-04-01T08:00:00Z'),
    productName: 'Амониев нитрат',
    activeIngredient: 'N 34.4%',
    dose: '25 кг/дка',
    areaHa: 3.5,
};

const OBS: ObservationData = {
    occurredAt: new Date('2026-05-01T08:00:00Z'),
    phenophase: 'BBCH 32',
    disease: 'Брашнеста мана',
    pest: 'Листни въшки',
};

describe('ДНЕВНИК columns — header/cell counts locked', () => {
    it('label arrays carry the official column counts', () => {
        expect(BG_LABELS.obsCols).toHaveLength(11);
        expect(BG_LABELS.chemCols).toHaveLength(12);
        expect(BG_LABELS.fertCols).toHaveLength(5);
        expect(BG_LABELS.sampleCols).toHaveLength(12);
        expect(BG_LABELS.inspectorCols).toHaveLength(4);
    });

    it('every builder emits exactly one cell per header', () => {
        expect(buildChemicalRows([SPRAY])[0]).toHaveLength(BG_LABELS.chemCols.length);
        expect(buildFertilizerRows([FERT])[0]).toHaveLength(BG_LABELS.fertCols.length);
        expect(buildObservationRows([OBS])[0]).toHaveLength(BG_LABELS.obsCols.length);
    });
});

describe('ДНЕВНИК columns — right data under the right header', () => {
    it('chemical table: each critical value sits under its official header', () => {
        const row = buildChemicalRows([SPRAY])[0];
        const col = (needle: string) => {
            const i = BG_LABELS.chemCols.findIndex((h) => h.includes(needle));
            expect(i).toBeGreaterThan(-1);
            return i;
        };
        expect(row[col('Вредител')]).toBe('Житна пиявица');
        expect(row[col('Употребено средство')]).toBe('Карате Зеон');
        expect(row[col('Доза')]).toBe('0.15 л/дка');
        expect(row[col('Третирани площи')]).toBe('35'); // 3.5 ha → 35 дка
        expect(row[col('Техника')]).toBe('Наземна пръскачка');
        expect(row[col('Карантинен срок')]).toBe('30');
        expect(row[col('Най-ранна дата')]).toBe('09.06.2026'); // completedAt + 30d
        expect(row[col('ал. 2')]).toBe('APP-123'); // applicator cert (чл. 84, ал. 2)
        expect(row[col('ал. 1')]).toBe('Мария Иванова / AGR-456'); // agronomist (ал. 1)
        expect(row[col('Подпис')]).toBe(''); // always wet-signed by hand
    });

    it('fertilizer table: composition, dose and area under their headers', () => {
        const row = buildFertilizerRows([FERT])[0];
        const col = (needle: string) => {
            const i = BG_LABELS.fertCols.findIndex((h) => h.includes(needle));
            expect(i).toBeGreaterThan(-1);
            return i;
        };
        expect(row[col('Търговско наименование')]).toBe('Амониев нитрат; N 34.4%');
        expect(row[col('Употребено количество')]).toBe('25 кг/дка');
        expect(row[col('Наторени площи')]).toBe('35');
    });

    it('observation table: disease under „Болест", pest under „Неприятел"', () => {
        const row = buildObservationRows([OBS])[0];
        expect(row[BG_LABELS.obsCols.indexOf('Болест')]).toBe('Брашнеста мана');
        expect(row[BG_LABELS.obsCols.indexOf('Неприятел')]).toBe('Листни въшки');
        const phenoIdx = BG_LABELS.obsCols.findIndex((h) => h.includes('Фенофаза'));
        expect(row[phenoIdx]).toBe('BBCH 32');
        expect(row[0]).toBe('01.05.2026'); // Дата, месец, година
    });

    it('SELF-TEST: a swapped column order is detected', () => {
        // Simulate the classic regression: someone swaps two builder cells.
        const row = buildObservationRows([OBS])[0];
        const swapped = [...row];
        const b = BG_LABELS.obsCols.indexOf('Болест');
        const n = BG_LABELS.obsCols.indexOf('Неприятел');
        [swapped[b], swapped[n]] = [swapped[n], swapped[b]];
        expect(swapped[b]).not.toBe(row[b]);
    });
});
