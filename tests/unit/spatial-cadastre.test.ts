/**
 * Unit tests — Bulgarian КАИС cadastre parsing (Phase 1).
 *
 * Pure functions in src/lib/spatial/parse.ts + src/lib/agriculture/cadastre.ts:
 *   • cadastral identifier parsing / validation (EKATTE.masiv.parcel),
 *     including leading-zero preservation and malformed rejection;
 *   • documentary-area (площ по документ) extraction;
 *   • source-SRID detection from a shapefile `.prj` WKT;
 *   • the >5% area-reconciliation divergence check.
 */
import {
    parseCadastralIdentity,
    pickDocumentaryAreaDca,
    detectSridFromPrj,
    normalizeToParcels,
    parseSpatialFile,
    SpatialParseError,
    DOC_AREA_DCA_KEY,
} from '@/lib/spatial/parse';
import { areaDivergesFromDocument, documentaryAreaDca } from '@/lib/agriculture/cadastre';
import { PRJ_WKT_7801 } from '../helpers/shapefile-fixture';

describe('parseCadastralIdentity', () => {
    it('accepts a valid EKATTE.masiv.parcel identifier', () => {
        expect(parseCadastralIdentity({ CADNUM: '68134.8360.729' })).toEqual({
            cadastralId: '68134.8360.729',
            ekatte: '68134',
        });
    });

    it('preserves leading zeros in the EKATTE prefix (never coerced to Number)', () => {
        expect(parseCadastralIdentity({ IDENT: '01234.5.6' })).toEqual({
            cadastralId: '01234.5.6',
            ekatte: '01234',
        });
    });

    it('composes an identifier from separate EKATTE + masiv + parcel columns', () => {
        expect(parseCadastralIdentity({ EKATTE: '68134', MASIV: '8360', PARCEL: '729' })).toEqual({
            cadastralId: '68134.8360.729',
            ekatte: '68134',
        });
    });

    it('composes preserving a leading-zero EKATTE string', () => {
        expect(parseCadastralIdentity({ ekatte: '00134', masiv: '5', parcel: '6' })).toEqual({
            cadastralId: '00134.5.6',
            ekatte: '00134',
        });
    });

    it('detects a full identifier in any unlabelled string column', () => {
        expect(parseCadastralIdentity({ someCol: '12345.10.20' })).toEqual({
            cadastralId: '12345.10.20',
            ekatte: '12345',
        });
    });

    it('rejects a malformed identifier (non-5-digit EKATTE prefix)', () => {
        expect(parseCadastralIdentity({ CADNUM: '6813.8360.729' })).toEqual({ cadastralId: null, ekatte: null });
    });

    it('rejects a two-part / truncated identifier', () => {
        expect(parseCadastralIdentity({ IDENT: '68134.8360' })).toEqual({ cadastralId: null, ekatte: null });
    });

    it('rejects non-cadastral free text and empty properties', () => {
        expect(parseCadastralIdentity({ name: 'North 40' })).toEqual({ cadastralId: null, ekatte: null });
        expect(parseCadastralIdentity({})).toEqual({ cadastralId: null, ekatte: null });
    });

    it('does not compose from a numeric EKATTE that lost its leading zeros', () => {
        // A DBF number 134 (was 00134) can never be trusted as a 5-digit EKATTE.
        expect(parseCadastralIdentity({ EKATTE: 134, MASIV: 5, PARCEL: 6 })).toEqual({
            cadastralId: null,
            ekatte: null,
        });
    });
});

describe('pickDocumentaryAreaDca', () => {
    it('reads a decare-unit documentary area key', () => {
        expect(pickDocumentaryAreaDca({ AREA_DKA: 12.5 })).toBe(12.5);
    });

    it('reads a generic area key and parses a comma decimal', () => {
        expect(pickDocumentaryAreaDca({ PLOSHT: '10,5' })).toBe(10.5);
    });

    it('ignores geometry-derived area columns and non-positive values', () => {
        expect(pickDocumentaryAreaDca({ SHAPE_AREA: 999 })).toBeNull();
        expect(pickDocumentaryAreaDca({ PLOSHT: 0 })).toBeNull();
        expect(pickDocumentaryAreaDca({})).toBeNull();
    });
});

describe('detectSridFromPrj', () => {
    it('detects EPSG:7801 from the authority code', () => {
        expect(detectSridFromPrj(PRJ_WKT_7801)).toBe(7801);
    });

    it('detects 7801 from a CCS2005 name signature without an authority code', () => {
        expect(detectSridFromPrj('PROJCS["BGS2005 / CCS2005",...]')).toBe(7801);
    });

    it('detects EPSG:32635 from the authority code and from a UTM 35N name', () => {
        expect(detectSridFromPrj('PROJCS["x",AUTHORITY["EPSG","32635"]]')).toBe(32635);
        expect(detectSridFromPrj('PROJCS["WGS_1984_UTM_Zone_35N",...]')).toBe(32635);
    });

    it('returns null for WGS84 / unrecognised projections', () => {
        expect(detectSridFromPrj('GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]]')).toBeNull();
        expect(detectSridFromPrj('')).toBeNull();
    });
});

describe('normalizeToParcels — cadastral attachment', () => {
    const feature = (properties: Record<string, unknown>) => ({
        type: 'Feature' as const,
        properties,
        geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    });

    it('attaches cadastralId / ekatte and the normalized documentary-area key', () => {
        const { parcels } = normalizeToParcels({
            type: 'FeatureCollection',
            features: [feature({ CADNUM: '68134.8360.729', PLOSHT: 15.2, name: 'North' })],
        });
        expect(parcels).toHaveLength(1);
        expect(parcels[0].cadastralId).toBe('68134.8360.729');
        expect(parcels[0].ekatte).toBe('68134');
        expect(parcels[0].properties[DOC_AREA_DCA_KEY]).toBe(15.2);
    });

    it('leaves cadastralId null and omits the doc-area key when absent', () => {
        const { parcels } = normalizeToParcels({
            type: 'FeatureCollection',
            features: [feature({ name: 'Plain' })],
        });
        expect(parcels[0].cadastralId).toBeNull();
        expect(parcels[0].ekatte).toBeNull();
        expect(parcels[0].properties[DOC_AREA_DCA_KEY]).toBeUndefined();
    });
});

describe('parseSpatialFile — projected-metre GeoJSON without a .prj', () => {
    const geo = (ring: Array<[number, number]>) =>
        Buffer.from(
            JSON.stringify({
                type: 'FeatureCollection',
                features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }],
            }),
        );

    it('assumes EPSG:7801 for a Bulgarian metre bbox (out of WGS84 range)', async () => {
        const ring: Array<[number, number]> = [
            [321459, 4731336],
            [321659, 4731336],
            [321659, 4731536],
            [321459, 4731536],
            [321459, 4731336],
        ];
        const result = await parseSpatialFile({ filename: 'kvs.geojson', buffer: geo(ring) });
        expect(result.srid).toBe(7801);
    });

    it('still rejects a genuinely unknown projection outside the Bulgarian band', async () => {
        const ring: Array<[number, number]> = [
            [7_000_000, 8_000_000],
            [7_000_100, 8_000_000],
            [7_000_100, 8_000_100],
            [7_000_000, 8_000_100],
            [7_000_000, 8_000_000],
        ];
        await expect(parseSpatialFile({ filename: 'weird.geojson', buffer: geo(ring) })).rejects.toThrow(
            SpatialParseError,
        );
    });

    it('leaves srid undefined for a normal WGS84 GeoJSON', async () => {
        const ring: Array<[number, number]> = [[23, 42], [23.01, 42], [23.01, 42.01], [23, 42.01], [23, 42]];
        const result = await parseSpatialFile({ filename: 'wgs84.geojson', buffer: geo(ring) });
        expect(result.srid).toBeUndefined();
    });
});

describe('area reconciliation (>5% divergence)', () => {
    it('flags a documentary area diverging beyond 5% from the mapped area', () => {
        // 1 ha = 10 dca mapped; documentary 12 dca → 20% over → flag.
        expect(areaDivergesFromDocument(1, 12)).toBe(true);
    });

    it('does not flag a within-5% match', () => {
        expect(areaDivergesFromDocument(1, 10.3)).toBe(false);
    });

    it('never flags when either area is missing', () => {
        expect(areaDivergesFromDocument(null, 12)).toBe(false);
        expect(areaDivergesFromDocument(1, null)).toBe(false);
    });

    it('reads the documentary area off a parcel properties bag', () => {
        expect(documentaryAreaDca({ [DOC_AREA_DCA_KEY]: 7.5 })).toBe(7.5);
        expect(documentaryAreaDca({})).toBeNull();
        expect(documentaryAreaDca(null)).toBeNull();
    });
});
