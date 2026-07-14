/**
 * Cadastre COMPANY-ownership extraction — privacy guardrail.
 *
 * The load-bearing invariant: `extractCompanyOwners` returns ONLY legal
 * entities (readable name + numeric ЕИК) and NEVER a physical person
 * (asterisk-masked «име на лицето», hex-encrypted ЕГН). If a future change
 * relaxes the gate, these assertions fail before any personal data can be
 * persisted from the КАИС „собственост ПИ" register.
 */
import JSZip from 'jszip';
import {
    extractCompanyOwners,
    parseOwnershipWorkbook,
    extractCompanyOwnersFromZip,
    type OwnershipSheet,
} from '@/lib/cadastre/ownership';

const HEADERS = [
    'кадастрален идентификатор',
    'идентификационен номер на субекта',
    'вид на лицето',
    'име на лицето',
    'вид на правото',
];
const sheet = (rows: string[][]): OwnershipSheet => ({ headers: HEADERS, rows });

describe('extractCompanyOwners — legal entities only', () => {
    it('keeps legal entities with a readable name + numeric ЕИК', () => {
        const owners = extractCompanyOwners(
            sheet([
                ['02676.1.1', '000024663', 'Община', 'Община Банско', 'собственост'],
                ['02676.5.9', '203045511', 'ЕООД', 'Агро Инвест ЕООД', 'собственост'],
            ]),
        );
        expect(owners).toHaveLength(2);
        expect(owners[0]).toEqual({
            cadastralId: '02676.1.1',
            eik: '000024663',
            name: 'Община Банско',
            rightType: 'собственост',
            subjectKind: 'Община',
        });
        expect(owners[1].name).toBe('Агро Инвест ЕООД');
    });

    it('DROPS physical persons: asterisk-masked name + hex-encrypted ЕГН', () => {
        const owners = extractCompanyOwners(
            sheet([
                ['02676.1.2', 'ac4d5d68b01ae9455d410a5da4de3195', 'физическо лице', '****** ********', 'собственост'],
                ['02676.1.3', 'a8fef17efb656c961a5f61beadbdae3f', 'физическо лице', '******** *********', 'собственост'],
            ]),
        );
        expect(owners).toEqual([]);
    });

    it('DROPS the ambiguous edges (readable name but hex id; numeric ЕИК but masked name)', () => {
        const owners = extractCompanyOwners(
            sheet([
                ['02676.2.1', 'ac4d5d68b01ae9455d410a5da4de3195', 'физическо лице', 'Иван Петров', 'собственост'], // hex id → drop
                ['02676.2.2', '111222333', 'физическо лице', '**** ****', 'собственост'], // masked name → drop
                ['02676.2.3', '', 'държава', 'Държавата', 'собственост'], // no ЕИК → drop (conservative)
            ]),
        );
        expect(owners).toEqual([]);
    });

    it('never returns a name containing an asterisk (belt-and-braces over any row)', () => {
        const owners = extractCompanyOwners(
            sheet([
                ['02676.3.1', '000024663', 'Община', 'Община Банско', 'собственост'],
                ['02676.3.2', '999888777', 'физическо лице', 'Г***** П****', 'собственост'],
            ]),
        );
        expect(owners.every((o) => !o.name.includes('*'))).toBe(true);
        expect(owners).toHaveLength(1);
    });

    it('de-duplicates on (cadastralId, eik, rightType)', () => {
        const owners = extractCompanyOwners(
            sheet([
                ['02676.4.1', '203045511', 'ЕООД', 'Агро ЕООД', 'собственост'],
                ['02676.4.1', '203045511', 'ЕООД', 'Агро ЕООД', 'собственост'],
            ]),
        );
        expect(owners).toHaveLength(1);
    });

    it('returns [] when the register shape is unrecognised (missing key columns)', () => {
        expect(extractCompanyOwners({ headers: ['foo', 'bar'], rows: [['a', 'b']] })).toEqual([]);
    });
});

describe('parseOwnershipWorkbook — nested-zip XLSX reader', () => {
    // Build a minimal „собственост ПИ.zip" (outer zip → .xlsx → sheet) with the
    // register's real `t="str"` inline-cached-string cell encoding.
    async function buildRegisterZip(rows: string[][]): Promise<Buffer> {
        const cell = (ref: string, val: string) =>
            `<c r="${ref}" t="str"><v xml:space="preserve">${val.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</v></c>`;
        const colLetter = (i: number) => String.fromCharCode(65 + i);
        const sheetRows = rows
            .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(`${colLetter(ci)}${ri + 1}`, v)).join('')}</row>`)
            .join('');
        const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
        const inner = new JSZip();
        inner.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
        inner.file('xl/workbook.xml', '<?xml version="1.0"?><workbook/>');
        inner.file('xl/worksheets/sheet1.xml', sheetXml);
        const xlsxBuf = await inner.generateAsync({ type: 'nodebuffer' });
        const outer = new JSZip();
        outer.file('собственост ПИ.xlsx', xlsxBuf);
        return outer.generateAsync({ type: 'nodebuffer' });
    }

    it('parses header + rows and drives extraction (only the company survives)', async () => {
        const zip = await buildRegisterZip([
            HEADERS,
            ['02676.1.1', '000024663', 'Община', 'Община Банско', 'собственост'],
            ['02676.1.2', 'ac4d5d68b01ae9455d410a5da4de3195', 'физическо лице', '****** ********', 'собственост'],
        ]);
        const parsed = await parseOwnershipWorkbook(zip);
        expect(parsed.headers).toContain('кадастрален идентификатор');
        expect(parsed.rows).toHaveLength(2);

        const owners = await extractCompanyOwnersFromZip(zip);
        expect(owners).toHaveLength(1);
        expect(owners[0]).toMatchObject({ cadastralId: '02676.1.1', eik: '000024663', name: 'Община Банско' });
    });

    it('returns empty when the zip carries no worksheet', async () => {
        const empty = new JSZip();
        empty.file('readme.txt', 'no xlsx here');
        const buf = await empty.generateAsync({ type: 'nodebuffer' });
        expect(await parseOwnershipWorkbook(buf)).toEqual({ headers: [], rows: [] });
    });
});
