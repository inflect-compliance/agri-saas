/**
 * Agronomic decision rules — PURE evaluators over weather inputs.
 *
 * Two illustrative, clean-room heuristics (derived from generic
 * agronomy / extension guidance, not any proprietary model):
 *   • spray window — is today's weather suitable for a foliar spray?
 *     (wind drift, rain wash-off, temperature range)
 *   • disease risk — does a run of warm + wet/humid days favour foliar
 *     disease (leaf-wetness × temperature pressure)?
 * No DB, no I/O — the job/usecase feeds these WeatherObservation-derived
 * inputs and turns the outputs into Notifications + Risk-register rows.
 * Thresholds are parameterised + defaulted so a tenant could later tune
 * them without touching this logic.
 */

// ─── Spray window ────────────────────────────────────────────────────

export interface SprayWeather {
    /** Max wind speed (km/h). */
    windMaxKmh?: number | null;
    /** Measured/forecast precipitation for the window (mm). */
    precipMm?: number | null;
    /** Mean temperature (°C). */
    tempMeanC?: number | null;
}

export type SprayWindowStatus = 'GOOD' | 'CAUTION' | 'UNSUITABLE';

export interface SprayWindowThresholds {
    /** Above this wind ⇒ CAUTION (drift). */
    windCautionKmh: number;
    /** Above this wind ⇒ UNSUITABLE. */
    windUnsuitableKmh: number;
    /** Precip at/above this ⇒ UNSUITABLE (wash-off). */
    rainUnsuitableMm: number;
    /** Temperature outside [min,max] ⇒ UNSUITABLE; within the inner margin ⇒ CAUTION. */
    tempMinC: number;
    tempMaxC: number;
}

export const DEFAULT_SPRAY_THRESHOLDS: SprayWindowThresholds = {
    windCautionKmh: 15,
    windUnsuitableKmh: 25,
    rainUnsuitableMm: 2,
    tempMinC: 5,
    tempMaxC: 28,
};

/**
 * Structured, i18n-ready spray-window reason. The English `reasons[]` above
 * stay as-is for server consumers (AI copilot prompt, audit/signal details,
 * notifications); `reasonCodes[]` is the parallel machine form the UI
 * translates at render time so the Bulgarian app shows Bulgarian reasons.
 */
export type SprayReasonCode =
    | 'windUnsuitable'
    | 'windCaution'
    | 'rainUnsuitable'
    | 'tempOutside'
    | 'withinLimits';

export interface SprayReason {
    code: SprayReasonCode;
    params: Record<string, number>;
}

export interface SprayWindowResult {
    status: SprayWindowStatus;
    /** English sentences — for AI/audit/notification consumers. */
    reasons: string[];
    /** Structured codes+params — for i18n at the UI render layer. */
    reasonCodes: SprayReason[];
}

/**
 * Classify a spray window. UNSUITABLE conditions dominate; otherwise any
 * CAUTION condition downgrades a GOOD window. Missing inputs are simply
 * not evaluated (a partial observation never fabricates a warning).
 */
export function evaluateSprayWindow(
    w: SprayWeather,
    thresholds: SprayWindowThresholds = DEFAULT_SPRAY_THRESHOLDS,
): SprayWindowResult {
    const reasons: string[] = [];
    const reasonCodes: SprayReason[] = [];
    let status: SprayWindowStatus = 'GOOD';

    const downgrade = (to: SprayWindowStatus) => {
        if (to === 'UNSUITABLE') status = 'UNSUITABLE';
        else if (to === 'CAUTION' && status === 'GOOD') status = 'CAUTION';
    };

    if (w.windMaxKmh != null) {
        if (w.windMaxKmh >= thresholds.windUnsuitableKmh) {
            downgrade('UNSUITABLE');
            reasons.push(`Wind ${w.windMaxKmh} km/h exceeds the ${thresholds.windUnsuitableKmh} km/h drift limit`);
            reasonCodes.push({ code: 'windUnsuitable', params: { wind: w.windMaxKmh, limit: thresholds.windUnsuitableKmh } });
        } else if (w.windMaxKmh >= thresholds.windCautionKmh) {
            downgrade('CAUTION');
            reasons.push(`Wind ${w.windMaxKmh} km/h — drift caution above ${thresholds.windCautionKmh} km/h`);
            reasonCodes.push({ code: 'windCaution', params: { wind: w.windMaxKmh, limit: thresholds.windCautionKmh } });
        }
    }
    if (w.precipMm != null && w.precipMm >= thresholds.rainUnsuitableMm) {
        downgrade('UNSUITABLE');
        reasons.push(`Rain ${w.precipMm} mm risks wash-off (limit ${thresholds.rainUnsuitableMm} mm)`);
        reasonCodes.push({ code: 'rainUnsuitable', params: { rain: w.precipMm, limit: thresholds.rainUnsuitableMm } });
    }
    if (w.tempMeanC != null) {
        if (w.tempMeanC < thresholds.tempMinC || w.tempMeanC > thresholds.tempMaxC) {
            downgrade('UNSUITABLE');
            reasons.push(`Temperature ${w.tempMeanC}°C outside the ${thresholds.tempMinC}–${thresholds.tempMaxC}°C window`);
            reasonCodes.push({ code: 'tempOutside', params: { temp: w.tempMeanC, min: thresholds.tempMinC, max: thresholds.tempMaxC } });
        }
    }

    if (status === 'GOOD') {
        reasons.push('Conditions within spray limits');
        reasonCodes.push({ code: 'withinLimits', params: {} });
    }
    return { status, reasons, reasonCodes };
}

// ─── Disease risk ────────────────────────────────────────────────────

export interface DiseaseDay {
    date: string;
    precipMm?: number | null;
    humidityMean?: number | null;
    tempMeanC?: number | null;
}

export type DiseaseRiskLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface DiseaseRiskThresholds {
    /** A day is "conducive" if leaf-wetness proxy AND temperature band hold. */
    wetPrecipMm: number;
    wetHumidityPct: number;
    tempMinC: number;
    tempMaxC: number;
    /** Consecutive conducive days → risk level. */
    moderateRun: number;
    highRun: number;
}

export const DEFAULT_DISEASE_THRESHOLDS: DiseaseRiskThresholds = {
    wetPrecipMm: 0.2,
    wetHumidityPct: 90,
    tempMinC: 10,
    tempMaxC: 30,
    moderateRun: 2,
    highRun: 3,
};

export interface DiseaseRiskResult {
    level: DiseaseRiskLevel;
    conduciveDays: number;
    /** Longest run of consecutive conducive days. */
    maxConsecutive: number;
    reasons: string[];
}

/** A day favours foliar disease when leaf wetness (rain OR high RH) meets a warm band. */
function isConducive(d: DiseaseDay, t: DiseaseRiskThresholds): boolean {
    const wet = (d.precipMm != null && d.precipMm >= t.wetPrecipMm) ||
        (d.humidityMean != null && d.humidityMean >= t.wetHumidityPct);
    const warm = d.tempMeanC != null && d.tempMeanC >= t.tempMinC && d.tempMeanC <= t.tempMaxC;
    return wet && warm;
}

/**
 * Disease pressure from a chronological run of days. Risk escalates with
 * the LONGEST consecutive conducive streak (sustained leaf wetness drives
 * infection), not the raw count.
 */
export function evaluateDiseaseRisk(
    days: DiseaseDay[],
    thresholds: DiseaseRiskThresholds = DEFAULT_DISEASE_THRESHOLDS,
): DiseaseRiskResult {
    let conduciveDays = 0;
    let run = 0;
    let maxConsecutive = 0;
    for (const d of days) {
        if (isConducive(d, thresholds)) {
            conduciveDays++;
            run++;
            if (run > maxConsecutive) maxConsecutive = run;
        } else {
            run = 0;
        }
    }
    let level: DiseaseRiskLevel = 'LOW';
    if (maxConsecutive >= thresholds.highRun) level = 'HIGH';
    else if (maxConsecutive >= thresholds.moderateRun) level = 'MODERATE';

    const reasons: string[] = [];
    if (level === 'LOW') reasons.push('No sustained warm-wet period');
    else reasons.push(`${maxConsecutive} consecutive warm-wet days favour foliar disease`);
    return { level, conduciveDays, maxConsecutive, reasons };
}
