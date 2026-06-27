/**
 * Unit tests for the spatial-file parser (src/lib/spatial/parse.ts).
 * Pure module — no DB, no network. Covers GeoJSON + KML parsing,
 * Polygon→MultiPolygon normalization, format detection, bounds, the
 * cadastral-composite + Cyrillic naming, the coordinate-range guard, the
 * skipped-feature count, and the error paths.
 */
import {
    detectFormat,
    normalizeToParcels,
    parseGeoJson,
    parseKml,
    parseSpatialFile,
    SpatialParseError,
} from '@/lib/spatial/parse';

const polygonFC = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: { name: 'North 40', crop: 'wheat' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
            },
        },
    ],
};

const featureWith = (properties: Record<string, unknown>) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties, geometry: polygonFC.features[0].geometry }],
});

describe('detectFormat', () => {
    it('detects by extension', () => {
        expect(detectFormat('parcels.geojson')).toBe('geojson');
        expect(detectFormat('FIELDS.JSON')).toBe('geojson');
        expect(detectFormat('boundary.kml')).toBe('kml');
        expect(detectFormat('export.kmz')).toBe('kml');
        expect(detectFormat('shapes.zip')).toBe('shapefile');
        // Uppercase extension (real-world cadastral exports) still resolves.
        expect(detectFormat('AGROREI_OOD_2026.ZIP')).toBe('shapefile');
    });
    it('falls back to MIME type', () => {
        expect(detectFormat('blob', 'application/vnd.google-earth.kml+xml')).toBe('kml');
        expect(detectFormat('blob', 'application/zip')).toBe('shapefile');
        expect(detectFormat('blob', 'application/geo+json')).toBe('geojson');
    });
    it('returns null for unsupported', () => {
        expect(detectFormat('notes.txt', 'text/plain')).toBeNull();
    });
});

describe('normalizeToParcels', () => {
    it('wraps a Polygon feature into a MultiPolygon parcel and picks the name', () => {
        const { parcels } = normalizeToParcels(polygonFC);
        expect(parcels).toHaveLength(1);
        expect(parcels[0].name).toBe('North 40');
        expect(parcels[0].geometry.type).toBe('MultiPolygon');
        expect(parcels[0].geometry.coordinates).toEqual([
            [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        ]);
        expect(parcels[0].properties.crop).toBe('wheat');
    });

    it('preserves an existing MultiPolygon', () => {
        const mp = {
            type: 'Feature',
            properties: {},
            geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 2], [2, 2], [0, 0]]]] },
        };
        const { parcels } = normalizeToParcels(mp);
        expect(parcels[0].geometry.type).toBe('MultiPolygon');
    });

    it('skips non-polygonal features AND counts them in `skipped`', () => {
        const fc = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } },
                ...polygonFC.features,
            ],
        };
        const { parcels, skipped } = normalizeToParcels(fc);
        expect(parcels).toHaveLength(1);
        expect(parcels[0].name).toBe('North 40');
        expect(skipped).toBe(1);
    });

    it('assigns positional names when properties lack one', () => {
        const fc = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: {}, geometry: polygonFC.features[0].geometry },
                { type: 'Feature', properties: {}, geometry: polygonFC.features[0].geometry },
            ],
        };
        const { parcels } = normalizeToParcels(fc);
        expect(parcels.map((p) => p.name)).toEqual(['Parcel 1', 'Parcel 2']);
    });

    it('flattens an array of FeatureCollections (shpjs multi-layer shape)', () => {
        const { parcels } = normalizeToParcels([polygonFC, polygonFC]);
        expect(parcels).toHaveLength(2);
    });
});

describe('pickName — cadastral composite + Cyrillic (Fix 3)', () => {
    it('prefixes a cadastral code onto the name (EKATTE 15655 + NAME 3 → "15655-3")', () => {
        const { parcels } = normalizeToParcels(featureWith({ EKATTE: '15655', NAME: '3' }));
        expect(parcels[0].name).toBe('15655-3');
    });

    it('accepts a numeric code/name and stringifies it', () => {
        const { parcels } = normalizeToParcels(featureWith({ EKATTE: 15655, NAME: 19 }));
        expect(parcels[0].name).toBe('15655-19');
    });

    it('falls back to the bare name when no code key is present', () => {
        const { parcels } = normalizeToParcels(featureWith({ NAME: '3' }));
        expect(parcels[0].name).toBe('3');
    });

    it('uses the code alone when there is no name', () => {
        const { parcels } = normalizeToParcels(featureWith({ EKATTE: '15655' }));
        expect(parcels[0].name).toBe('15655');
    });

    it('does not duplicate when code === name', () => {
        const { parcels } = normalizeToParcels(featureWith({ EKATTE: '15655', NAME: '15655' }));
        expect(parcels[0].name).toBe('15655');
    });

    it('preserves Cyrillic verbatim in the name AND properties (no mojibake)', () => {
        const { parcels } = normalizeToParcels(
            featureWith({ EKATTE: '15655', NAME: 'Северно поле', SUBJ_NAME: 'АГРОРЕИ ООД' }),
        );
        expect(parcels[0].name).toBe('15655-Северно поле');
        expect(parcels[0].properties.SUBJ_NAME).toBe('АГРОРЕИ ООД');
    });
});

describe('parseGeoJson', () => {
    it('parses valid GeoJSON', () => {
        expect(parseGeoJson(JSON.stringify(polygonFC)).parcels).toHaveLength(1);
    });
    it('throws on invalid JSON', () => {
        expect(() => parseGeoJson('{not json')).toThrow(SpatialParseError);
    });
});

describe('parseKml', () => {
    const kmlDoc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Field A</name>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>0,0 0,1 1,1 1,0 0,0</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
</Document></kml>`;

    it('parses a KML polygon placemark', () => {
        const { parcels } = parseKml(kmlDoc);
        expect(parcels).toHaveLength(1);
        expect(parcels[0].name).toBe('Field A');
        expect(parcels[0].geometry.type).toBe('MultiPolygon');
    });
});

describe('parseSpatialFile', () => {
    it('dispatches GeoJSON and computes bounds', async () => {
        const result = await parseSpatialFile({
            filename: 'p.geojson',
            buffer: Buffer.from(JSON.stringify(polygonFC), 'utf8'),
        });
        expect(result.format).toBe('geojson');
        expect(result.parcels).toHaveLength(1);
        expect(result.bounds).toEqual([0, 0, 1, 1]);
        expect(result.skipped).toBe(0);
    });

    it('reports the REAL skipped count, not a hardcoded 0 (Fix 2)', async () => {
        const mixed = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
                { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
                ...polygonFC.features,
            ],
        };
        const result = await parseSpatialFile({
            filename: 'p.geojson',
            buffer: Buffer.from(JSON.stringify(mixed)),
        });
        expect(result.parcels).toHaveLength(1);
        expect(result.skipped).toBe(2);
    });

    it('rejects coordinates outside the WGS84 range — un-reprojected CRS (Fix 1)', async () => {
        // UTM-metre coordinates (easting ~500000, northing ~4_770_000) that were
        // never reprojected — must NOT be silently stored as garbage lat/lon.
        const utm = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'X' },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [500000, 4770000], [500100, 4770000],
                            [500100, 4770100], [500000, 4770100], [500000, 4770000],
                        ]],
                    },
                },
            ],
        };
        await expect(
            parseSpatialFile({ filename: 'p.geojson', buffer: Buffer.from(JSON.stringify(utm)) }),
        ).rejects.toThrow(/WGS84|EPSG:4326|reprojected/);
    });

    it('accepts coordinates at the WGS84 boundary', async () => {
        const edge = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'edge' },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[[179, 89], [180, 89], [180, 90], [179, 90], [179, 89]]],
                    },
                },
            ],
        };
        const result = await parseSpatialFile({
            filename: 'p.geojson',
            buffer: Buffer.from(JSON.stringify(edge)),
        });
        expect(result.parcels).toHaveLength(1);
    });

    it('throws on unsupported file type', async () => {
        await expect(
            parseSpatialFile({ filename: 'x.txt', buffer: Buffer.from('hi'), mimeType: 'text/plain' }),
        ).rejects.toThrow(SpatialParseError);
    });

    it('throws when no polygons are present', async () => {
        const fc = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }],
        };
        await expect(
            parseSpatialFile({ filename: 'p.geojson', buffer: Buffer.from(JSON.stringify(fc)) }),
        ).rejects.toThrow(/No polygon parcels/);
    });
});
