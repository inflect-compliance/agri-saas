/**
 * Class labels for the on-device ONNX classifier.
 *
 * This is the PlantVillage / CropNet class list — the canonical 38-class
 * crop-disease taxonomy the open MobileNetV2-PlantVillage and CropNet
 * (Apache-2.0) models are trained on. The model emits one logit per
 * class IN THIS ORDER; the onnx provider argmaxes + softmaxes the logit
 * vector and maps the winning index back to a human label here.
 *
 * Bundling the label list (text, not a binary) is fine — it is small,
 * authorship-neutral metadata. The MODEL WEIGHTS are NOT vendored; the
 * model file is loaded from a configurable `VISION_MODEL_PATH` (see
 * `onnx-provider.ts` + THIRD_PARTY_NOTICES.md).
 *
 * Labels are normalised to a human-readable form: underscores → spaces,
 * `___` (PlantVillage's crop/condition separator) → ` — `. A trailing
 * `healthy` class maps to the sentinel `'healthy'` recommendation path.
 *
 * If a deployment points `VISION_MODEL_PATH` at a model with a DIFFERENT
 * class count, set `VISION_LABELS_PATH` to a newline-delimited labels
 * file (loaded at runtime, overrides this list) — see `onnx-provider.ts`.
 */

/** The 38-class PlantVillage taxonomy, in model output-index order. */
export const PLANTVILLAGE_LABELS: readonly string[] = [
    'Apple — Apple scab',
    'Apple — Black rot',
    'Apple — Cedar apple rust',
    'Apple — healthy',
    'Blueberry — healthy',
    'Cherry — Powdery mildew',
    'Cherry — healthy',
    'Corn — Cercospora leaf spot (Gray leaf spot)',
    'Corn — Common rust',
    'Corn — Northern Leaf Blight',
    'Corn — healthy',
    'Grape — Black rot',
    'Grape — Esca (Black Measles)',
    'Grape — Leaf blight (Isariopsis Leaf Spot)',
    'Grape — healthy',
    'Orange — Huanglongbing (Citrus greening)',
    'Peach — Bacterial spot',
    'Peach — healthy',
    'Pepper bell — Bacterial spot',
    'Pepper bell — healthy',
    'Potato — Early blight',
    'Potato — Late blight',
    'Potato — healthy',
    'Raspberry — healthy',
    'Soybean — healthy',
    'Squash — Powdery mildew',
    'Strawberry — Leaf scorch',
    'Strawberry — healthy',
    'Tomato — Bacterial spot',
    'Tomato — Early blight',
    'Tomato — Late blight',
    'Tomato — Leaf Mold',
    'Tomato — Septoria leaf spot',
    'Tomato — Spider mites (Two-spotted spider mite)',
    'Tomato — Target Spot',
    'Tomato — Yellow Leaf Curl Virus',
    'Tomato — Mosaic virus',
    'Tomato — healthy',
] as const;

/** True when a label denotes a healthy plant (no pest/disease). */
export function isHealthyLabel(label: string): boolean {
    return /(^|—\s*)healthy$/i.test(label.trim());
}
