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
