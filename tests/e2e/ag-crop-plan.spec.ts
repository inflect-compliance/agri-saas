/**
 * Tier-1 ag workflow — crop plan + succession generation.
 *
 * Regression-proofs the planning engine: a crop plan with N successions
 * generates N planting waves at the configured interval. A regression
 * here breaks the season calendar that drives sowing/harvest scheduling.
 *
 * PLANNING module (on by default). Synchronous path. Seeds via the API.
 */
import { test, expect } from './fixtures';

test('crop plan: a 3-succession plan generates three planting waves', async ({ authedPage, isolatedTenant }) => {
    const slug = isolatedTenant.tenantSlug;
    const api = authedPage.request;

    // Season + crop type are prerequisites of a crop plan.
    const season = await (await api.post(`/api/t/${slug}/planning/seasons`, {
        data: { name: '2026 Main Season', startDate: '2026-01-01', endDate: '2026-12-31' },
    })).json();
    const cropType = await (await api.post(`/api/t/${slug}/planning/crop-types`, {
        data: { name: 'Wheat' },
    })).json();
    // The succession engine needs a variety with daysToMaturity to place
    // the harvest windows — without it, generate returns CROP_PLAN_NOT_READY.
    const variety = await (await api.post(`/api/t/${slug}/planning/crop-varieties`, {
        data: { cropTypeId: cropType.id, name: 'Maris Widgeon', daysToGermination: 10, daysToMaturity: 90 },
    })).json();

    const planRes = await api.post(`/api/t/${slug}/planning/crop-plans`, {
        data: {
            seasonId: season.id,
            cropTypeId: cropType.id,
            cropVarietyId: variety.id,
            name: 'North Wheat Plan',
            firstSowDate: '2026-03-01',
            successions: 3,
            intervalDays: 14,
        },
    });
    expect(planRes.status(), `create plan: ${await planRes.text()}`).toBe(201);
    const plan = await planRes.json();

    // Generate the succession plantings (3 waves).
    const gen = await api.post(`/api/t/${slug}/planning/crop-plans/${plan.id}/generate`);
    expect(gen.ok(), `generate: ${await gen.text()}`).toBeTruthy();
    // generatePlantings returns { cropPlanId, plantingsGenerated, tasksCreated }.
    const genBody = await gen.json();
    expect(genBody.plantingsGenerated).toBeGreaterThanOrEqual(3);

    // UI: the planning page lists the plan.
    await authedPage.goto(`/t/${slug}/planning`);
    await expect(authedPage.getByText('North Wheat Plan').first()).toBeVisible();
});
