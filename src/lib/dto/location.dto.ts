/**
 * Location / Parcel / Field-operation DTOs — mirror the shapes returned
 * by LocationRepository and ParcelRepository. Geometry is serialized as
 * GeoJSON (never the raw PostGIS column); areaHa is a denormalized
 * hectare value computed by ST_Area at import time.
 */
import { z } from '@/lib/openapi/zod';
import { UserRefSchema } from './common';

// ─── Location List Item ───

export const LocationListItemDTOSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    key: z.string().nullable().optional(),
    name: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    ownerUserId: z.string().nullable().optional(),
    spatialFileId: z.string().nullable().optional(),
    spatialFormat: z.string().nullable().optional(),
    boundsJson: z.unknown().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    owner: UserRefSchema.nullable().optional(),
    _count: z.object({
        parcels: z.number().optional(),
    }).optional(),
}).passthrough().openapi('LocationListItem', {
    description: 'Location as it appears in list views. A Location holds a set of imported Parcels (PostGIS polygons).',
});

export type LocationListItemDTO = z.infer<typeof LocationListItemDTOSchema>;

// ─── Parcel (with GeoJSON geometry) ───

export const ParcelDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    cropType: z.string().nullable().optional(),
    areaHa: z.number().nullable().optional(),
    /** GeoJSON MultiPolygon (WGS84), serialized via ST_AsGeoJSON. */
    geometry: z.unknown().nullable().optional(),
    properties: z.unknown().nullable().optional(),
}).passthrough().openapi('Parcel', {
    description: 'One imported parcel polygon. geometry is GeoJSON MultiPolygon in WGS84; areaHa is the on-ellipsoid area in hectares.',
});

export type ParcelDTO = z.infer<typeof ParcelDTOSchema>;

// ─── Location Detail (with parcel GeoJSON FeatureCollection) ───

export const LocationDetailDTOSchema = LocationListItemDTOSchema.extend({
    parcels: z.array(ParcelDTOSchema).optional(),
}).openapi('LocationDetail', {
    description: 'Location with its parcels. Returned by GET /locations/{id}.',
});

export type LocationDetailDTO = z.infer<typeof LocationDetailDTOSchema>;
