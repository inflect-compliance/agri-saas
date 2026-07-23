#!/usr/bin/env tsx
/**
 * Seed the crop-planning catalog (CropType + CropVariety) with common
 * market-garden + field crops, each carrying several representative
 * varieties.
 *
 * Content provenance: the agronomic figures below (days to maturity,
 * spacing, seeds-per-gram, germination) are GENERIC public-domain
 * horticultural norms, modelled on the OpenFarm crop dataset — released
 * CC0 / public domain (https://openfarm.cc — "all data is licensed
 * CC0"). Public-domain data is embedded + redistributed freely;
 * `sourceUrn: 'openfarm:cc0'` records provenance on every variety. No
 * proprietary seed-catalog data (named cultivar performance, branded
 * descriptions, MSDS text) is copied — every figure is a generic
 * agronomic norm authored for this seed.
 *
 * Each entry becomes a CropType plus N representative CropVarieties in
 * the target tenant. Idempotent: CropType upserts on (tenantId, key),
 * each CropVariety on (tenantId, cropTypeId, key); re-running skips rows
 * already present.
 *
 * Usage:
 *   tsx scripts/import-crop-varieties.ts                 # first tenant
 *   tsx scripts/import-crop-varieties.ts --tenant <slug> # a specific tenant
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type Method = 'DIRECT_SOW' | 'TRANSPLANT';

/** One variety's succession-engine defaults. */
interface VarietySeed {
    key: string;
    name: string;
    defaultMethod: Method;
    daysToGermination: number;
    /** Sow → transplant (TRANSPLANT crops); null for direct-sow. */
    daysToTransplant: number | null;
    daysToMaturity: number;
    harvestWindowDays: number;
    inRowSpacingCm: number;
    betweenRowSpacingCm: number;
    seedsPerGram: number;
    germinationRate: number;
    seedsPerCell: number;
}

/** A CropType + its representative varieties. */
interface CropSeed {
    cropType: { key: string; name: string; family: string; category: string };
    varieties: VarietySeed[];
}

/**
 * ~28 common crops with CC0 (OpenFarm-style) agronomic norms and several
 * representative varieties each (~70 varieties total). Generic
 * public-domain figures — NOT transcribed from any proprietary source.
 *
 * Within a crop, the per-variety numbers vary only where the variety
 * meaningfully differs agronomically (e.g. cherry vs. beefsteak tomato
 * days-to-maturity); the rest inherit the crop's typical norm.
 */
export const CROP_VARIETIES: CropSeed[] = [
    {
        cropType: { key: 'tomato', name: 'Tomato', family: 'Solanaceae', category: 'fruiting' },
        varieties: [
            { key: 'tomato-cherry', name: 'Cherry', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 42, daysToMaturity: 60, harvestWindowDays: 49, inRowSpacingCm: 45, betweenRowSpacingCm: 90, seedsPerGram: 350, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'tomato-beefsteak', name: 'Beefsteak', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 42, daysToMaturity: 80, harvestWindowDays: 35, inRowSpacingCm: 50, betweenRowSpacingCm: 90, seedsPerGram: 350, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'tomato-paste', name: 'Paste (Roma)', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 42, daysToMaturity: 75, harvestWindowDays: 28, inRowSpacingCm: 45, betweenRowSpacingCm: 90, seedsPerGram: 350, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'tomato-heirloom', name: 'Heirloom Slicing', defaultMethod: 'TRANSPLANT', daysToGermination: 8, daysToTransplant: 42, daysToMaturity: 78, harvestWindowDays: 35, inRowSpacingCm: 50, betweenRowSpacingCm: 90, seedsPerGram: 350, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'lettuce', name: 'Lettuce', family: 'Asteraceae', category: 'leafy green' },
        varieties: [
            { key: 'lettuce-butterhead', name: 'Butterhead', defaultMethod: 'TRANSPLANT', daysToGermination: 5, daysToTransplant: 28, daysToMaturity: 50, harvestWindowDays: 14, inRowSpacingCm: 25, betweenRowSpacingCm: 30, seedsPerGram: 800, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'lettuce-romaine', name: 'Romaine', defaultMethod: 'TRANSPLANT', daysToGermination: 5, daysToTransplant: 28, daysToMaturity: 60, harvestWindowDays: 14, inRowSpacingCm: 30, betweenRowSpacingCm: 30, seedsPerGram: 800, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'lettuce-looseleaf', name: 'Looseleaf', defaultMethod: 'TRANSPLANT', daysToGermination: 5, daysToTransplant: 21, daysToMaturity: 45, harvestWindowDays: 21, inRowSpacingCm: 20, betweenRowSpacingCm: 30, seedsPerGram: 800, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'lettuce-crisphead', name: 'Crisphead', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 28, daysToMaturity: 70, harvestWindowDays: 10, inRowSpacingCm: 30, betweenRowSpacingCm: 35, seedsPerGram: 800, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'carrot', name: 'Carrot', family: 'Apiaceae', category: 'root' },
        varieties: [
            { key: 'carrot-nantes', name: 'Nantes', defaultMethod: 'DIRECT_SOW', daysToGermination: 14, daysToTransplant: null, daysToMaturity: 70, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 30, seedsPerGram: 750, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'carrot-danvers', name: 'Danvers', defaultMethod: 'DIRECT_SOW', daysToGermination: 14, daysToTransplant: null, daysToMaturity: 75, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 30, seedsPerGram: 750, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'carrot-imperator', name: 'Imperator', defaultMethod: 'DIRECT_SOW', daysToGermination: 14, daysToTransplant: null, daysToMaturity: 80, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 35, seedsPerGram: 750, germinationRate: 0.78, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'beet', name: 'Beet', family: 'Amaranthaceae', category: 'root' },
        varieties: [
            { key: 'beet-detroit', name: 'Detroit Dark Red', defaultMethod: 'DIRECT_SOW', daysToGermination: 10, daysToTransplant: null, daysToMaturity: 55, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 55, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'beet-golden', name: 'Golden', defaultMethod: 'DIRECT_SOW', daysToGermination: 12, daysToTransplant: null, daysToMaturity: 55, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 55, germinationRate: 0.72, seedsPerCell: 1 },
            { key: 'beet-cylindra', name: 'Cylindra', defaultMethod: 'DIRECT_SOW', daysToGermination: 10, daysToTransplant: null, daysToMaturity: 60, harvestWindowDays: 21, inRowSpacingCm: 8, betweenRowSpacingCm: 30, seedsPerGram: 55, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'bean', name: 'Bush Bean', family: 'Fabaceae', category: 'legume' },
        varieties: [
            { key: 'bean-bush-green', name: 'Bush Green Snap', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 55, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 45, seedsPerGram: 3, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'bean-bush-yellow', name: 'Bush Yellow Wax', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 55, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 45, seedsPerGram: 3, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'bean-pole', name: 'Pole Snap', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 65, harvestWindowDays: 42, inRowSpacingCm: 15, betweenRowSpacingCm: 90, seedsPerGram: 3, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'pea', name: 'Pea', family: 'Fabaceae', category: 'legume' },
        varieties: [
            { key: 'pea-shelling', name: 'Shelling', defaultMethod: 'DIRECT_SOW', daysToGermination: 9, daysToTransplant: null, daysToMaturity: 60, harvestWindowDays: 14, inRowSpacingCm: 5, betweenRowSpacingCm: 45, seedsPerGram: 4, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'pea-snap', name: 'Sugar Snap', defaultMethod: 'DIRECT_SOW', daysToGermination: 9, daysToTransplant: null, daysToMaturity: 65, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 45, seedsPerGram: 4, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'pea-snow', name: 'Snow', defaultMethod: 'DIRECT_SOW', daysToGermination: 9, daysToTransplant: null, daysToMaturity: 60, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 45, seedsPerGram: 5, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'squash-summer', name: 'Summer Squash', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'squash-zucchini', name: 'Zucchini', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 50, harvestWindowDays: 35, inRowSpacingCm: 60, betweenRowSpacingCm: 120, seedsPerGram: 7, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'squash-yellow', name: 'Yellow Crookneck', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 52, harvestWindowDays: 35, inRowSpacingCm: 60, betweenRowSpacingCm: 120, seedsPerGram: 7, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'squash-patty', name: 'Pattypan', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 52, harvestWindowDays: 35, inRowSpacingCm: 60, betweenRowSpacingCm: 120, seedsPerGram: 7, germinationRate: 0.9, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'squash-winter', name: 'Winter Squash', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'squash-butternut', name: 'Butternut', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 95, harvestWindowDays: 14, inRowSpacingCm: 60, betweenRowSpacingCm: 150, seedsPerGram: 5, germinationRate: 0.88, seedsPerCell: 1 },
            { key: 'squash-acorn', name: 'Acorn', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 85, harvestWindowDays: 14, inRowSpacingCm: 60, betweenRowSpacingCm: 150, seedsPerGram: 6, germinationRate: 0.88, seedsPerCell: 1 },
            { key: 'squash-spaghetti', name: 'Spaghetti', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 90, harvestWindowDays: 14, inRowSpacingCm: 60, betweenRowSpacingCm: 150, seedsPerGram: 5, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'pumpkin', name: 'Pumpkin', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'pumpkin-sugar', name: 'Sugar Pie', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 100, harvestWindowDays: 14, inRowSpacingCm: 90, betweenRowSpacingCm: 180, seedsPerGram: 4, germinationRate: 0.88, seedsPerCell: 1 },
            { key: 'pumpkin-jack', name: 'Jack-o-Lantern', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 21, daysToMaturity: 110, harvestWindowDays: 14, inRowSpacingCm: 120, betweenRowSpacingCm: 240, seedsPerGram: 4, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'cucumber', name: 'Cucumber', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'cucumber-slicing', name: 'Slicing', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 21, daysToMaturity: 55, harvestWindowDays: 28, inRowSpacingCm: 30, betweenRowSpacingCm: 120, seedsPerGram: 35, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'cucumber-pickling', name: 'Pickling', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 21, daysToMaturity: 52, harvestWindowDays: 28, inRowSpacingCm: 25, betweenRowSpacingCm: 120, seedsPerGram: 35, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'cucumber-greenhouse', name: 'Greenhouse (Seedless)', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 21, daysToMaturity: 60, harvestWindowDays: 49, inRowSpacingCm: 40, betweenRowSpacingCm: 120, seedsPerGram: 30, germinationRate: 0.9, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'melon', name: 'Melon', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'melon-cantaloupe', name: 'Cantaloupe', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 28, daysToMaturity: 80, harvestWindowDays: 21, inRowSpacingCm: 45, betweenRowSpacingCm: 150, seedsPerGram: 30, germinationRate: 0.88, seedsPerCell: 1 },
            { key: 'melon-honeydew', name: 'Honeydew', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 28, daysToMaturity: 90, harvestWindowDays: 21, inRowSpacingCm: 45, betweenRowSpacingCm: 150, seedsPerGram: 30, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'watermelon', name: 'Watermelon', family: 'Cucurbitaceae', category: 'fruiting' },
        varieties: [
            { key: 'watermelon-icebox', name: 'Icebox', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 28, daysToMaturity: 80, harvestWindowDays: 14, inRowSpacingCm: 60, betweenRowSpacingCm: 180, seedsPerGram: 10, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'watermelon-seedless', name: 'Seedless', defaultMethod: 'TRANSPLANT', daysToGermination: 8, daysToTransplant: 28, daysToMaturity: 85, harvestWindowDays: 14, inRowSpacingCm: 90, betweenRowSpacingCm: 200, seedsPerGram: 12, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'pepper', name: 'Pepper', family: 'Solanaceae', category: 'fruiting' },
        varieties: [
            { key: 'pepper-bell', name: 'Bell', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 70, harvestWindowDays: 42, inRowSpacingCm: 45, betweenRowSpacingCm: 75, seedsPerGram: 160, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'pepper-jalapeno', name: 'Jalapeño', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 72, harvestWindowDays: 49, inRowSpacingCm: 40, betweenRowSpacingCm: 75, seedsPerGram: 180, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'pepper-banana', name: 'Banana (Sweet)', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 70, harvestWindowDays: 49, inRowSpacingCm: 40, betweenRowSpacingCm: 75, seedsPerGram: 180, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'eggplant', name: 'Eggplant', family: 'Solanaceae', category: 'fruiting' },
        varieties: [
            { key: 'eggplant-globe', name: 'Globe', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 75, harvestWindowDays: 42, inRowSpacingCm: 50, betweenRowSpacingCm: 75, seedsPerGram: 200, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'eggplant-italian', name: 'Italian (Long)', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 70, harvestWindowDays: 42, inRowSpacingCm: 45, betweenRowSpacingCm: 75, seedsPerGram: 220, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'kale', name: 'Kale', family: 'Brassicaceae', category: 'leafy green' },
        varieties: [
            { key: 'kale-lacinato', name: 'Lacinato', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 60, harvestWindowDays: 56, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'kale-curly', name: 'Curly', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 60, harvestWindowDays: 56, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'kale-red-russian', name: 'Red Russian', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 55, harvestWindowDays: 56, inRowSpacingCm: 40, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'chard', name: 'Swiss Chard', family: 'Amaranthaceae', category: 'leafy green' },
        varieties: [
            { key: 'chard-fordhook', name: 'Fordhook Giant', defaultMethod: 'TRANSPLANT', daysToGermination: 8, daysToTransplant: 28, daysToMaturity: 55, harvestWindowDays: 70, inRowSpacingCm: 25, betweenRowSpacingCm: 45, seedsPerGram: 55, germinationRate: 0.8, seedsPerCell: 2 },
            { key: 'chard-rainbow', name: 'Rainbow (Bright Lights)', defaultMethod: 'TRANSPLANT', daysToGermination: 8, daysToTransplant: 28, daysToMaturity: 55, harvestWindowDays: 70, inRowSpacingCm: 25, betweenRowSpacingCm: 45, seedsPerGram: 55, germinationRate: 0.78, seedsPerCell: 2 },
        ],
    },
    {
        cropType: { key: 'spinach', name: 'Spinach', family: 'Amaranthaceae', category: 'leafy green' },
        varieties: [
            { key: 'spinach-savoy', name: 'Savoy', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 45, harvestWindowDays: 21, inRowSpacingCm: 8, betweenRowSpacingCm: 30, seedsPerGram: 90, germinationRate: 0.8, seedsPerCell: 1 },
            { key: 'spinach-smooth', name: 'Smooth Leaf', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 42, harvestWindowDays: 21, inRowSpacingCm: 8, betweenRowSpacingCm: 30, seedsPerGram: 90, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'arugula', name: 'Arugula', family: 'Brassicaceae', category: 'leafy green' },
        varieties: [
            { key: 'arugula-salad', name: 'Salad (Cultivated)', defaultMethod: 'DIRECT_SOW', daysToGermination: 5, daysToTransplant: null, daysToMaturity: 35, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 15, seedsPerGram: 550, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'arugula-wild', name: 'Wild (Sylvetta)', defaultMethod: 'DIRECT_SOW', daysToGermination: 7, daysToTransplant: null, daysToMaturity: 50, harvestWindowDays: 28, inRowSpacingCm: 5, betweenRowSpacingCm: 15, seedsPerGram: 600, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'broccoli', name: 'Broccoli', family: 'Brassicaceae', category: 'brassica' },
        varieties: [
            { key: 'broccoli-calabrese', name: 'Calabrese', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 65, harvestWindowDays: 14, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'broccoli-sprouting', name: 'Sprouting', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 80, harvestWindowDays: 28, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'cauliflower', name: 'Cauliflower', family: 'Brassicaceae', category: 'brassica' },
        varieties: [
            { key: 'cauliflower-white', name: 'White', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 75, harvestWindowDays: 10, inRowSpacingCm: 50, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'cauliflower-romanesco', name: 'Romanesco', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 90, harvestWindowDays: 10, inRowSpacingCm: 50, betweenRowSpacingCm: 70, seedsPerGram: 300, germinationRate: 0.82, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'cabbage', name: 'Cabbage', family: 'Brassicaceae', category: 'brassica' },
        varieties: [
            { key: 'cabbage-green', name: 'Green', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 75, harvestWindowDays: 21, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'cabbage-red', name: 'Red', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 80, harvestWindowDays: 21, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'cabbage-savoy', name: 'Savoy', defaultMethod: 'TRANSPLANT', daysToGermination: 6, daysToTransplant: 35, daysToMaturity: 85, harvestWindowDays: 21, inRowSpacingCm: 45, betweenRowSpacingCm: 60, seedsPerGram: 300, germinationRate: 0.83, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'sweet-corn', name: 'Sweet Corn', family: 'Poaceae', category: 'grain' },
        varieties: [
            { key: 'sweet-corn-se', name: 'Sugary Enhanced (SE)', defaultMethod: 'DIRECT_SOW', daysToGermination: 7, daysToTransplant: null, daysToMaturity: 78, harvestWindowDays: 10, inRowSpacingCm: 20, betweenRowSpacingCm: 75, seedsPerGram: 5, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'sweet-corn-sh2', name: 'Supersweet (sh2)', defaultMethod: 'DIRECT_SOW', daysToGermination: 8, daysToTransplant: null, daysToMaturity: 80, harvestWindowDays: 10, inRowSpacingCm: 20, betweenRowSpacingCm: 75, seedsPerGram: 5, germinationRate: 0.8, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'radish', name: 'Radish', family: 'Brassicaceae', category: 'root' },
        varieties: [
            { key: 'radish-cherry', name: 'Cherry Belle', defaultMethod: 'DIRECT_SOW', daysToGermination: 5, daysToTransplant: null, daysToMaturity: 25, harvestWindowDays: 10, inRowSpacingCm: 5, betweenRowSpacingCm: 15, seedsPerGram: 100, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'radish-french-breakfast', name: 'French Breakfast', defaultMethod: 'DIRECT_SOW', daysToGermination: 5, daysToTransplant: null, daysToMaturity: 28, harvestWindowDays: 10, inRowSpacingCm: 5, betweenRowSpacingCm: 15, seedsPerGram: 100, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'radish-daikon', name: 'Daikon', defaultMethod: 'DIRECT_SOW', daysToGermination: 6, daysToTransplant: null, daysToMaturity: 60, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 90, germinationRate: 0.88, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'turnip', name: 'Turnip', family: 'Brassicaceae', category: 'root' },
        varieties: [
            { key: 'turnip-purple-top', name: 'Purple Top', defaultMethod: 'DIRECT_SOW', daysToGermination: 6, daysToTransplant: null, daysToMaturity: 50, harvestWindowDays: 21, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 400, germinationRate: 0.85, seedsPerCell: 1 },
            { key: 'turnip-hakurei', name: 'Hakurei (Salad)', defaultMethod: 'DIRECT_SOW', daysToGermination: 5, daysToTransplant: null, daysToMaturity: 40, harvestWindowDays: 14, inRowSpacingCm: 8, betweenRowSpacingCm: 25, seedsPerGram: 450, germinationRate: 0.88, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'parsnip', name: 'Parsnip', family: 'Apiaceae', category: 'root' },
        varieties: [
            { key: 'parsnip-hollow-crown', name: 'Hollow Crown', defaultMethod: 'DIRECT_SOW', daysToGermination: 18, daysToTransplant: null, daysToMaturity: 120, harvestWindowDays: 28, inRowSpacingCm: 8, betweenRowSpacingCm: 30, seedsPerGram: 200, germinationRate: 0.7, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'onion', name: 'Onion', family: 'Amaryllidaceae', category: 'allium' },
        varieties: [
            { key: 'onion-yellow', name: 'Yellow Storage', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 100, harvestWindowDays: 14, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 250, germinationRate: 0.75, seedsPerCell: 1 },
            { key: 'onion-red', name: 'Red', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 105, harvestWindowDays: 14, inRowSpacingCm: 10, betweenRowSpacingCm: 30, seedsPerGram: 250, germinationRate: 0.75, seedsPerCell: 1 },
            { key: 'onion-sweet', name: 'Sweet', defaultMethod: 'TRANSPLANT', daysToGermination: 10, daysToTransplant: 56, daysToMaturity: 95, harvestWindowDays: 14, inRowSpacingCm: 12, betweenRowSpacingCm: 30, seedsPerGram: 250, germinationRate: 0.72, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'leek', name: 'Leek', family: 'Amaryllidaceae', category: 'allium' },
        varieties: [
            { key: 'leek-summer', name: 'Summer', defaultMethod: 'TRANSPLANT', daysToGermination: 12, daysToTransplant: 60, daysToMaturity: 100, harvestWindowDays: 28, inRowSpacingCm: 15, betweenRowSpacingCm: 30, seedsPerGram: 350, germinationRate: 0.75, seedsPerCell: 1 },
            { key: 'leek-overwinter', name: 'Overwintering', defaultMethod: 'TRANSPLANT', daysToGermination: 12, daysToTransplant: 60, daysToMaturity: 150, harvestWindowDays: 56, inRowSpacingCm: 15, betweenRowSpacingCm: 30, seedsPerGram: 350, germinationRate: 0.75, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'garlic', name: 'Garlic', family: 'Amaryllidaceae', category: 'allium' },
        varieties: [
            { key: 'garlic-hardneck', name: 'Hardneck', defaultMethod: 'DIRECT_SOW', daysToGermination: 14, daysToTransplant: null, daysToMaturity: 240, harvestWindowDays: 14, inRowSpacingCm: 15, betweenRowSpacingCm: 30, seedsPerGram: 1, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'garlic-softneck', name: 'Softneck', defaultMethod: 'DIRECT_SOW', daysToGermination: 14, daysToTransplant: null, daysToMaturity: 240, harvestWindowDays: 14, inRowSpacingCm: 15, betweenRowSpacingCm: 30, seedsPerGram: 1, germinationRate: 0.9, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'potato', name: 'Potato', family: 'Solanaceae', category: 'root' },
        varieties: [
            { key: 'potato-russet', name: 'Russet', defaultMethod: 'DIRECT_SOW', daysToGermination: 18, daysToTransplant: null, daysToMaturity: 110, harvestWindowDays: 21, inRowSpacingCm: 30, betweenRowSpacingCm: 75, seedsPerGram: 1, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'potato-yukon', name: 'Yellow (Yukon-type)', defaultMethod: 'DIRECT_SOW', daysToGermination: 18, daysToTransplant: null, daysToMaturity: 90, harvestWindowDays: 21, inRowSpacingCm: 30, betweenRowSpacingCm: 75, seedsPerGram: 1, germinationRate: 0.9, seedsPerCell: 1 },
            { key: 'potato-fingerling', name: 'Fingerling', defaultMethod: 'DIRECT_SOW', daysToGermination: 18, daysToTransplant: null, daysToMaturity: 100, harvestWindowDays: 21, inRowSpacingCm: 25, betweenRowSpacingCm: 75, seedsPerGram: 1, germinationRate: 0.9, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'strawberry', name: 'Strawberry', family: 'Rosaceae', category: 'fruiting' },
        varieties: [
            { key: 'strawberry-junebearing', name: 'June-bearing', defaultMethod: 'TRANSPLANT', daysToGermination: 21, daysToTransplant: 56, daysToMaturity: 110, harvestWindowDays: 21, inRowSpacingCm: 30, betweenRowSpacingCm: 90, seedsPerGram: 250, germinationRate: 0.6, seedsPerCell: 1 },
            { key: 'strawberry-everbearing', name: 'Everbearing', defaultMethod: 'TRANSPLANT', daysToGermination: 21, daysToTransplant: 56, daysToMaturity: 120, harvestWindowDays: 90, inRowSpacingCm: 30, betweenRowSpacingCm: 90, seedsPerGram: 250, germinationRate: 0.6, seedsPerCell: 1 },
        ],
    },
    {
        cropType: { key: 'basil', name: 'Basil', family: 'Lamiaceae', category: 'herb' },
        varieties: [
            { key: 'basil-genovese', name: 'Genovese', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 35, daysToMaturity: 50, harvestWindowDays: 56, inRowSpacingCm: 25, betweenRowSpacingCm: 30, seedsPerGram: 600, germinationRate: 0.85, seedsPerCell: 3 },
            { key: 'basil-thai', name: 'Thai', defaultMethod: 'TRANSPLANT', daysToGermination: 7, daysToTransplant: 35, daysToMaturity: 55, harvestWindowDays: 56, inRowSpacingCm: 25, betweenRowSpacingCm: 30, seedsPerGram: 600, germinationRate: 0.85, seedsPerCell: 3 },
        ],
    },
    {
        cropType: { key: 'cilantro', name: 'Cilantro', family: 'Apiaceae', category: 'herb' },
        varieties: [
            { key: 'cilantro-slow-bolt', name: 'Slow-bolt', defaultMethod: 'DIRECT_SOW', daysToGermination: 10, daysToTransplant: null, daysToMaturity: 45, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 20, seedsPerGram: 90, germinationRate: 0.8, seedsPerCell: 2 },
            { key: 'cilantro-leisure', name: 'Leisure', defaultMethod: 'DIRECT_SOW', daysToGermination: 10, daysToTransplant: null, daysToMaturity: 50, harvestWindowDays: 21, inRowSpacingCm: 5, betweenRowSpacingCm: 20, seedsPerGram: 90, germinationRate: 0.8, seedsPerCell: 2 },
        ],
    },
];

/**
 * Per-crop agronomic defaults for the SOIL suitability + GDD surfaces —
 * generic public-domain norms (same provenance as the succession figures
 * above; NOT from any proprietary catalog).
 *
 *   - `soil` → written to `CropVariety.soilDefaultsJson`; the pure
 *     suitability engine (`src/lib/soil/suitability.ts`) compares a
 *     parcel's modelled soil against these. Textures are USDA classes.
 *   - `gddBaseC` → the crop's GDD base temperature (°C). Warm-season ≈ 10,
 *     cool-season ≈ 4–5.
 *   - `gddPerDay` → typical daily heat units during the crop's growing
 *     window; `gddToMaturity` is derived per-variety as
 *     `round(daysToMaturity × gddPerDay)`, so a longer-maturing variety of
 *     the same crop gets a proportionally larger target. A MODELLED
 *     estimate, never a guaranteed figure.
 *
 * Keyed by `cropType.key`. A crop absent here simply seeds no soil/GDD
 * defaults — its board cells stay an honest "—" / "unknown".
 */
type Drainage = 'well' | 'moderate' | 'poor';
interface CropAgroDefaults {
    gddBaseC: number;
    gddPerDay: number;
    soil: { phMin: number; phMax: number; texturePreference: string[]; drainagePreference: Drainage };
}
const CROP_AGRO_DEFAULTS: Record<string, CropAgroDefaults> = {
    tomato: { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam', 'Silt loam'], drainagePreference: 'well' } },
    lettuce: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Silt loam', 'Sandy loam'], drainagePreference: 'moderate' } },
    carrot: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    beet: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.5, phMax: 7.5, texturePreference: ['Loam', 'Sandy loam', 'Silt loam'], drainagePreference: 'well' } },
    bean: { gddBaseC: 10, gddPerDay: 13, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    pea: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.5, texturePreference: ['Loam', 'Sandy loam', 'Silt loam'], drainagePreference: 'well' } },
    'squash-summer': { gddBaseC: 10, gddPerDay: 15, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    'squash-winter': { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    pumpkin: { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    cucumber: { gddBaseC: 10, gddPerDay: 15, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    melon: { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    watermelon: { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    pepper: { gddBaseC: 10, gddPerDay: 13, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    eggplant: { gddBaseC: 10, gddPerDay: 13, soil: { phMin: 6.0, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    kale: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.5, texturePreference: ['Loam', 'Silt loam', 'Sandy loam'], drainagePreference: 'well' } },
    chard: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.5, texturePreference: ['Loam', 'Silt loam', 'Sandy loam'], drainagePreference: 'well' } },
    spinach: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.5, phMax: 7.5, texturePreference: ['Loam', 'Silt loam'], drainagePreference: 'well' } },
    arugula: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Silt loam', 'Sandy loam'], drainagePreference: 'moderate' } },
    broccoli: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Silt loam'], drainagePreference: 'well' } },
    cauliflower: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Silt loam'], drainagePreference: 'well' } },
    cabbage: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.5, texturePreference: ['Loam', 'Silt loam', 'Clay loam'], drainagePreference: 'well' } },
    'sweet-corn': { gddBaseC: 10, gddPerDay: 14, soil: { phMin: 5.8, phMax: 7.0, texturePreference: ['Loam', 'Sandy loam', 'Silt loam'], drainagePreference: 'well' } },
    radish: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    turnip: { gddBaseC: 4, gddPerDay: 10, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    parsnip: { gddBaseC: 4, gddPerDay: 9, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    onion: { gddBaseC: 5, gddPerDay: 9, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Sandy loam', 'Silt loam'], drainagePreference: 'well' } },
    leek: { gddBaseC: 5, gddPerDay: 9, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Silt loam', 'Sandy loam'], drainagePreference: 'well' } },
    garlic: { gddBaseC: 5, gddPerDay: 9, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    potato: { gddBaseC: 7, gddPerDay: 12, soil: { phMin: 5.0, phMax: 6.5, texturePreference: ['Sandy loam', 'Loamy sand', 'Loam'], drainagePreference: 'well' } },
    strawberry: { gddBaseC: 5, gddPerDay: 10, soil: { phMin: 5.5, phMax: 6.8, texturePreference: ['Sandy loam', 'Loam'], drainagePreference: 'well' } },
    basil: { gddBaseC: 10, gddPerDay: 13, soil: { phMin: 6.0, phMax: 7.0, texturePreference: ['Loam', 'Sandy loam'], drainagePreference: 'moderate' } },
    cilantro: { gddBaseC: 4, gddPerDay: 9, soil: { phMin: 6.2, phMax: 6.8, texturePreference: ['Loam', 'Sandy loam', 'Silt loam'], drainagePreference: 'moderate' } },
};

export interface ImportVarietiesResult {
    tenantId: string;
    cropTypesCreated: number;
    varietiesCreated: number;
    skipped: number;
}

/** Seed the crop catalog into a tenant. Idempotent on the natural keys. */
export async function importCropVarieties(
    prisma: PrismaClient,
    opts: { tenantSlug?: string; tenantId?: string } = {},
): Promise<ImportVarietiesResult> {
    const tenant = opts.tenantId
        ? await prisma.tenant.findUnique({ where: { id: opts.tenantId }, select: { id: true } })
        : opts.tenantSlug
            ? await prisma.tenant.findUnique({ where: { slug: opts.tenantSlug }, select: { id: true } })
            : await prisma.tenant.findFirst({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (!tenant) throw new Error(`No tenant found${opts.tenantSlug ? ` for slug "${opts.tenantSlug}"` : ''}`);

    let cropTypesCreated = 0;
    let varietiesCreated = 0;
    let skipped = 0;

    for (const seed of CROP_VARIETIES) {
        // CropType — upsert on (tenantId, key).
        let cropType = await prisma.cropType.findFirst({
            where: { tenantId: tenant.id, key: seed.cropType.key },
            select: { id: true },
        });
        if (!cropType) {
            cropType = await prisma.cropType.create({
                data: {
                    tenantId: tenant.id,
                    key: seed.cropType.key,
                    name: seed.cropType.name,
                    family: seed.cropType.family,
                    category: seed.cropType.category,
                },
                select: { id: true },
            });
            cropTypesCreated++;
        }

        // CropVariety — upsert on (tenantId, cropTypeId, key), one per variety.
        for (const v of seed.varieties) {
            const existingVariety = await prisma.cropVariety.findFirst({
                where: { tenantId: tenant.id, cropTypeId: cropType.id, key: v.key },
                select: { id: true },
            });
            if (existingVariety) {
                skipped++;
                continue;
            }
            // Per-crop soil + GDD defaults (soil suitability + maturity %).
            // A crop absent from the map seeds no soil/GDD → honest "—".
            const agro = CROP_AGRO_DEFAULTS[seed.cropType.key];
            await prisma.cropVariety.create({
                data: {
                    tenantId: tenant.id,
                    cropTypeId: cropType.id,
                    key: v.key,
                    name: v.name,
                    defaultMethod: v.defaultMethod,
                    daysToGermination: v.daysToGermination,
                    daysToTransplant: v.daysToTransplant,
                    daysToMaturity: v.daysToMaturity,
                    harvestWindowDays: v.harvestWindowDays,
                    inRowSpacingCm: v.inRowSpacingCm,
                    betweenRowSpacingCm: v.betweenRowSpacingCm,
                    seedsPerGram: v.seedsPerGram,
                    germinationRate: v.germinationRate,
                    seedsPerCell: v.seedsPerCell,
                    ...(agro
                        ? {
                              soilDefaultsJson: agro.soil,
                              gddBaseC: agro.gddBaseC,
                              // GDD to maturity scales with the variety's own
                              // days-to-maturity, so a beefsteak tomato gets a
                              // larger target than a cherry of the same crop.
                              gddToMaturity: Math.round(v.daysToMaturity * agro.gddPerDay),
                          }
                        : {}),
                    sourceUrn: 'openfarm:cc0',
                },
            });
            varietiesCreated++;
        }
    }

    return { tenantId: tenant.id, cropTypesCreated, varietiesCreated, skipped };
}

async function main(): Promise<number> {
    const tenantIdx = process.argv.indexOf('--tenant');
    const tenantSlug = tenantIdx >= 0 ? process.argv[tenantIdx + 1] : undefined;
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter });
    try {
        const res = await importCropVarieties(prisma, { tenantSlug });
        console.log(
            `Crop varieties import: tenant ${res.tenantId} — ${res.cropTypesCreated} crop types, ` +
                `${res.varietiesCreated} varieties created, ${res.skipped} already present.`,
        );
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((err) => {
        console.error('Crop varieties import failed:', err);
        process.exit(1);
    });
}
