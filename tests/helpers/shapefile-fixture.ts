/**
 * Minimal ESRI Shapefile (polygon) zip encoder for tests.
 *
 * Real Bulgarian КАИС / КВС cadastre exports ship as EPSG:7801 (BGS2005 /
 * CCS2005 Lambert) or EPSG:32635 (UTM 35N) shapefiles whose coordinates are
 * PROJECTED METRES, not WGS84 degrees. This encoder writes a single-polygon
 * `.shp` (the only geometry the importer reads) plus an optional `.prj`, zips
 * them, and returns the buffer — so a test can exercise the reprojection path
 * WITHOUT committing an opaque binary or depending on proj4 at runtime.
 *
 * The `.shp` layout follows the ESRI whitepaper: a 100-byte header then one
 * polygon record (record header + shape type 5 + bbox + parts + points), all
 * little-endian except the big-endian file code / lengths.
 */
import JSZip from 'jszip';

/** WKT for EPSG:7801 (BGS2005 / CCS2005) carrying the EPSG authority code. */
export const PRJ_WKT_7801 =
    'PROJCS["BGS2005 / CCS2005",GEOGCS["BGS2005",DATUM["Bulgaria_Geodetic_System_2005",' +
    'SPHEROID["GRS 1980",6378137,298.257222101],TOWGS84[0,0,0,0,0,0,0]],' +
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],' +
    'PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",42],' +
    'PARAMETER["standard_parallel_2",43.33333333333334],' +
    'PARAMETER["latitude_of_origin",42.66787568333333],PARAMETER["central_meridian",25.5],' +
    'PARAMETER["false_easting",500000],PARAMETER["false_northing",4725824.3591],' +
    'UNIT["metre",1],AXIS["Northing",NORTH],AXIS["Easting",EAST],AUTHORITY["EPSG","7801"]]';

/** Encode a single closed ring (`[[x,y], …]`, first==last) as a polygon `.shp`. */
export function encodePolygonShp(ring: Array<[number, number]>): Buffer {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const xmin = Math.min(...xs);
    const ymin = Math.min(...ys);
    const xmax = Math.max(...xs);
    const ymax = Math.max(...ys);
    const numPoints = ring.length;
    // shapeType(4) + box(32) + numParts(4) + numPoints(4) + parts(4) + points(16·n)
    const contentLen = 4 + 32 + 4 + 4 + 4 + 16 * numPoints;
    const total = 100 + 8 + contentLen;
    const buf = Buffer.alloc(total);
    buf.writeInt32BE(9994, 0); // file code
    buf.writeInt32BE(total / 2, 24); // file length in 16-bit words
    buf.writeInt32LE(1000, 28); // version
    buf.writeInt32LE(5, 32); // shape type: polygon
    buf.writeDoubleLE(xmin, 36);
    buf.writeDoubleLE(ymin, 44);
    buf.writeDoubleLE(xmax, 52);
    buf.writeDoubleLE(ymax, 60);
    let o = 100;
    buf.writeInt32BE(1, o); // record number
    o += 4;
    buf.writeInt32BE(contentLen / 2, o); // content length (16-bit words)
    o += 4;
    buf.writeInt32LE(5, o); // shape type
    o += 4;
    buf.writeDoubleLE(xmin, o); o += 8;
    buf.writeDoubleLE(ymin, o); o += 8;
    buf.writeDoubleLE(xmax, o); o += 8;
    buf.writeDoubleLE(ymax, o); o += 8;
    buf.writeInt32LE(1, o); o += 4; // numParts
    buf.writeInt32LE(numPoints, o); o += 4; // numPoints
    buf.writeInt32LE(0, o); o += 4; // part 0 offset
    for (const [px, py] of ring) {
        buf.writeDoubleLE(px, o); o += 8;
        buf.writeDoubleLE(py, o); o += 8;
    }
    return buf;
}

/** WKT for EPSG:32635 (WGS84 / UTM zone 35N) carrying the EPSG authority code. */
export const PRJ_WKT_32635 =
    'PROJCS["WGS 84 / UTM zone 35N",GEOGCS["WGS 84",DATUM["WGS_1984",' +
    'SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],' +
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],' +
    'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],' +
    'PARAMETER["central_meridian",27],PARAMETER["scale_factor",0.9996],' +
    'PARAMETER["false_easting",500000],PARAMETER["false_northing",0],' +
    'UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","32635"]]';

/** Build a shapefile zip (`.shp` + optional `.prj`) for one polygon ring. */
export async function buildPolygonShapefileZip(args: {
    ring: Array<[number, number]>;
    prjWkt?: string;
    name?: string;
}): Promise<Buffer> {
    const base = args.name ?? 'parcel';
    const zip = new JSZip();
    zip.file(`${base}.shp`, encodePolygonShp(args.ring));
    if (args.prjWkt) zip.file(`${base}.prj`, args.prjWkt);
    return zip.generateAsync({ type: 'nodebuffer' });
}

/** Encode a MULTI-record polygon `.shp` (one polygon per ring). */
export function encodeMultiPolygonShp(rings: Array<Array<[number, number]>>): Buffer {
    // Per-record content: shapeType(4)+box(32)+numParts(4)+numPoints(4)+parts(4)+points(16n)
    const recBuffers = rings.map((ring, idx) => {
        const xs = ring.map((p) => p[0]);
        const ys = ring.map((p) => p[1]);
        const xmin = Math.min(...xs), ymin = Math.min(...ys);
        const xmax = Math.max(...xs), ymax = Math.max(...ys);
        const n = ring.length;
        const contentLen = 4 + 32 + 4 + 4 + 4 + 16 * n;
        const rb = Buffer.alloc(8 + contentLen);
        rb.writeInt32BE(idx + 1, 0); // record number (1-based)
        rb.writeInt32BE(contentLen / 2, 4); // content length in 16-bit words
        let o = 8;
        rb.writeInt32LE(5, o); o += 4;
        rb.writeDoubleLE(xmin, o); o += 8;
        rb.writeDoubleLE(ymin, o); o += 8;
        rb.writeDoubleLE(xmax, o); o += 8;
        rb.writeDoubleLE(ymax, o); o += 8;
        rb.writeInt32LE(1, o); o += 4; // numParts
        rb.writeInt32LE(n, o); o += 4; // numPoints
        rb.writeInt32LE(0, o); o += 4; // part 0 offset
        for (const [px, py] of ring) {
            rb.writeDoubleLE(px, o); o += 8;
            rb.writeDoubleLE(py, o); o += 8;
        }
        return rb;
    });
    const allXs = rings.flat().map((p) => p[0]);
    const allYs = rings.flat().map((p) => p[1]);
    const body = Buffer.concat(recBuffers);
    const total = 100 + body.length;
    const header = Buffer.alloc(100);
    header.writeInt32BE(9994, 0);
    header.writeInt32BE(total / 2, 24);
    header.writeInt32LE(1000, 28);
    header.writeInt32LE(5, 32);
    header.writeDoubleLE(Math.min(...allXs), 36);
    header.writeDoubleLE(Math.min(...allYs), 44);
    header.writeDoubleLE(Math.max(...allXs), 52);
    header.writeDoubleLE(Math.max(...allYs), 60);
    return Buffer.concat([header, body]);
}

/**
 * Encode a minimal dBASE III `.dbf` with Character fields only. `records` are
 * plain objects keyed by field name; `fields` fixes column order + widths.
 */
export function encodeDbf(
    fields: Array<{ name: string; length: number }>,
    records: Array<Record<string, string>>,
): Buffer {
    const headerLen = 32 + 32 * fields.length + 1;
    const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0);
    const buf = Buffer.alloc(headerLen + records.length * recordLen + 1);
    buf.writeUInt8(0x03, 0); // dBASE III, no memo
    buf.writeUInt8(26, 1); // YY (2026)
    buf.writeUInt8(7, 2); // MM
    buf.writeUInt8(13, 3); // DD
    buf.writeUInt32LE(records.length, 4);
    buf.writeUInt16LE(headerLen, 8);
    buf.writeUInt16LE(recordLen, 10);
    let o = 32;
    for (const f of fields) {
        buf.write(f.name.slice(0, 10), o, 'ascii'); // name (11 bytes, null-padded)
        buf.writeUInt8(0x43, o + 11); // 'C' (character)
        buf.writeUInt8(f.length, o + 16); // field length
        o += 32;
    }
    buf.writeUInt8(0x0d, o); // header terminator
    o += 1;
    for (const rec of records) {
        buf.writeUInt8(0x20, o); // not-deleted flag
        o += 1;
        for (const f of fields) {
            const val = (rec[f.name] ?? '').slice(0, f.length);
            buf.write(val.padEnd(f.length, ' '), o, 'ascii');
            o += f.length;
        }
    }
    buf.writeUInt8(0x1a, o); // EOF
    return buf;
}

/**
 * Build a cadastre-shaped shapefile zip: N polygon features, each with a
 * `CADNUM` attribute (`ЕКАТТЕ.масив.номер`). Used by the КАИС import job test.
 */
export async function buildCadastreShapefileZip(args: {
    features: Array<{ ring: Array<[number, number]>; cadnum: string; extra?: Record<string, string> }>;
    prjWkt?: string;
    name?: string;
    /** Extra Character columns (name + width), e.g. an owner column to strip. */
    extraFields?: Array<{ name: string; length: number }>;
}): Promise<Buffer> {
    const base = args.name ?? 'parcels';
    const fields = [{ name: 'CADNUM', length: 20 }, ...(args.extraFields ?? [])];
    const records = args.features.map((f) => ({ CADNUM: f.cadnum, ...(f.extra ?? {}) }));
    const zip = new JSZip();
    zip.file(`${base}.shp`, encodeMultiPolygonShp(args.features.map((f) => f.ring)));
    zip.file(`${base}.dbf`, encodeDbf(fields, records));
    if (args.prjWkt) zip.file(`${base}.prj`, args.prjWkt);
    return zip.generateAsync({ type: 'nodebuffer' });
}
