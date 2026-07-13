-- Part A (PR2) — ensure EPSG:7801 (BGS2005 / КС2005 Lambert Conformal Conic 2SP,
-- the official Bulgarian cadastre CRS) exists in PostGIS `spatial_ref_sys`.
-- CI's postgis:16-3.4 ships it, but some self-hosted PostGIS builds omit the
-- national grids — so we insert the official EPSG definition idempotently. The
-- cadastre reprojection path (`ST_Transform(..., 4326)`) throws without it.
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
VALUES (
    7801,
    'EPSG',
    7801,
    '+proj=lcc +lat_1=42 +lat_2=43.33333333333334 +lat_0=42.66787568333333 +lon_0=25.5 +x_0=500000 +y_0=4725824.3591 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    'PROJCS["BGS2005 / CCS2005",GEOGCS["BGS2005",DATUM["Bulgaria_Geodetic_System_2005",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1167"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","7798"]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["latitude_of_origin",42.6678756833333],PARAMETER["central_meridian",25.5],PARAMETER["standard_parallel_1",42],PARAMETER["standard_parallel_2",43.3333333333333],PARAMETER["false_easting",500000],PARAMETER["false_northing",4725824.3591],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Northing",NORTH],AXIS["Easting",EAST],AUTHORITY["EPSG","7801"]]'
)
ON CONFLICT (srid) DO NOTHING;

-- Part B (PR2) — GLOBAL cache of downloaded КАИС OpenData settlement archives
-- (no tenantId — public open data shared across tenants, like "SoilSample").
CREATE TABLE "CadastreArchive" (
    "id" TEXT NOT NULL,
    "ekatte" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sourcePath" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadastreArchive_pkey" PRIMARY KEY ("id")
);

-- Unique (and index) on the 5-digit ЕКАТТЕ — the sole cache lookup key.
CREATE UNIQUE INDEX "CadastreArchive_ekatte_key" ON "CadastreArchive"("ekatte");
