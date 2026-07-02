/**
 * Unit tests — farm-record register filename encoding (PR3).
 * The register lists/labels generated diaries purely from the FileRecord
 * originalName (`dnevnik-<locationId>-<from>_<to>[-auto].pdf`), so the parse
 * must be exact + location-scoped.
 */
import {
    parseFarmRecordFileName,
    farmRecordNamePrefix,
} from '@/app-layer/reports/pdf/farm-record-diary';

const LOC = 'clocation123';

describe('farm-record filename encoding', () => {
    test('prefix is location-scoped with a trailing hyphen', () => {
        expect(farmRecordNamePrefix(LOC)).toBe('dnevnik-clocation123-');
    });

    test('parses a manual diary filename', () => {
        expect(
            parseFarmRecordFileName('dnevnik-clocation123-2026-01-01_2026-07-02.pdf', LOC),
        ).toEqual({ from: '2026-01-01', to: '2026-07-02', auto: false });
    });

    test('parses an auto-generated filename (the -auto suffix)', () => {
        expect(
            parseFarmRecordFileName('dnevnik-clocation123-2026-01-01_2026-07-02-auto.pdf', LOC),
        ).toEqual({ from: '2026-01-01', to: '2026-07-02', auto: true });
    });

    test('rejects another location, a prefix-collision, or a non-diary name', () => {
        expect(parseFarmRecordFileName('dnevnik-other-2026-01-01_2026-07-02.pdf', LOC)).toBeNull();
        // trailing hyphen in the prefix guards against clocation123 vs clocation1234
        expect(parseFarmRecordFileName('dnevnik-clocation1234-2026-01-01_2026-07-02.pdf', LOC)).toBeNull();
        expect(parseFarmRecordFileName('some-report.pdf', LOC)).toBeNull();
    });
});
