/**
 * Tier-1 ag workflow — field setup + parcel import.
 *
 * Regression-proofs the regulatory base layer: a field is created, its
 * parcels are authored (synchronous draw path → real ST_Area areaHa), and
 * the spatial-file upload affordance accepts a GeoJSON and enqueues the
 * off-thread parse job (202 + jobId). The parse itself runs in the BullMQ
 * worker (not started in the E2E env), so we assert the synchronous
 * stage+enqueue contract here; the parse→persist path is covered by
 * tests/integration/spatial-import-hardening.test.ts.
 *
 * Mutating spec → isolated empty tenant. Seeds via the ag-fixtures HTTP
 * helpers (the E2E twin of prisma/fixtures/ag-demo.ts).
 */
import { test, expect } from './fixtures';
import { createField, addParcel, square } from './ag-fixtures';

test('field setup: author parcels + accept a spatial import upload', async ({ authedPage, isolatedTenant }) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;

    // 1 — create a field, draw two parcels (synchronous authoring).
    const locationId = await createField(api, slug, 'North Farm');
    await addParcel(api, slug, locationId, 'North 40', 0, 0);
    await addParcel(api, slug, locationId, 'North 41', 0.012, 0);

    // Parcels persisted; areaHa derived server-side via ST_Area (never the client).
    const listRes = await api.get(`/api/t/${slug}/locations/${locationId}/parcels`);
    expect(listRes.ok(), `list parcels: ${listRes.status()}`).toBeTruthy();
    // GET /locations/{id}/parcels → { locationId, bounds, parcels: [...] }.
    const body = await listRes.json();
    const arr = Array.isArray(body) ? body : body.parcels;
    expect(arr.length).toBeGreaterThanOrEqual(2);
    expect(Number(arr[0].areaHa)).toBeGreaterThan(0);

    // 2 — the spatial-import upload stages the file + enqueues the parse
    //     job: 202 + a jobId (the synchronous half of the import path).
    const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Imported A' }, geometry: square(0.05, 0.05) }],
    });
    const importRes = await api.post(`/api/t/${slug}/locations/${locationId}/spatial-import`, {
        multipart: { file: { name: 'field.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) } },
    });
    expect(importRes.status(), `spatial import: ${await importRes.text()}`).toBe(202);
    const importBody = await importRes.json();
    expect(importBody.jobId, 'import returns a job id').toBeTruthy();
    expect(importBody.status).toBe('queued');

    // 3 — UI: the field shows on the locations list.
    await authedPage.goto(`/t/${slug}/locations`);
    await expect(authedPage.getByText('North Farm').first()).toBeVisible();
});
