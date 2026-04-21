import type { DeviationBand } from './types'

/** Pixels above the fixed baseline (chart top → baseline). */
export const DAY_CHART_ABOVE_PX = 200
/** Pixels below the fixed baseline (baseline → chart bottom). */
export const DAY_CHART_BELOW_PX = 200
export const DAY_CHART_TOTAL_PX = DAY_CHART_ABOVE_PX + DAY_CHART_BELOW_PX

/** Nominal gap from chart bottom to first text line (modality title). */
export const DAY_TEXT_BELOW_CHART_PX = 60
/** Pulls the axis title / band / insight block upward (smaller gap under the chart). */
export const DAY_TEXT_NUDGE_UP_PX = 60
/** Vertical gap between modality name and ABOVE/BELOW/WITHIN label (day-isolated view). */
export const DAY_GAP_NAME_TO_BAND_PX = 2
/**
 * Extra vertical lead from the modality title baseline to the band label baseline,
 * as a fraction of the band label font size (tighter = band sits closer to the title).
 */
export const DAY_TITLE_BAND_LEAD_MULT = 0.28
export const DAY_GAP_BAND_TO_DESC_PX = 8
/** Max width for wrapped insight copy (day-isolated). */
export const DAY_DESC_MAX_W_PX = 210
/**
 * Horizontal slack in the line-width estimate used while wrapping insight text.
 * Lower = less “padding” in the measure, so lines fill the box more before breaking.
 */
export const DAY_DESC_WRAP_MEASURE_PAD_PX = 2
/** Minimum |y − baseline| for any non-within dot (smallest non-zero deviation). */
export const DAY_MIN_DEV_OFFSET_PX = 30

/** Matches Level 1 day-isolated shape extent in GroveNetwork (l1ShapeExtent). */
export function shapeExtentDayIsolated(r: number): number {
  return r * 1.46
}

/**
 * Vertically centers the fixed-height chart + text stack inside the zone.
 * `textReserve` is conservative space for wrapped description lines.
 */
export function computeDayChartTop(
  zoneY: number,
  zoneH: number,
  textReservePx = 140,
): number {
  const padding = 8
  const textGapBelowChart =
    DAY_TEXT_BELOW_CHART_PX - DAY_TEXT_NUDGE_UP_PX
  const stack =
    DAY_CHART_TOTAL_PX + textGapBelowChart + textReservePx + padding * 2
  const free = zoneH - stack
  return zoneY + Math.max(padding, padding + free / 2)
}

export function computeDayBaselineY(chartTop: number): number {
  return chartTop + DAY_CHART_ABOVE_PX
}

export function computeDayChartBottom(baselineY: number): number {
  return baselineY + DAY_CHART_BELOW_PX
}

export function computeTextBlockStartY(chartBottom: number): number {
  return chartBottom + DAY_TEXT_BELOW_CHART_PX - DAY_TEXT_NUDGE_UP_PX
}

/**
 * Fixed baseline at chart center; dots offset by deviation magnitude.
 * Within: exactly on baseline. Above: y < baselineY. Below: y > baselineY.
 */
export function computeDayDotY(
  band: DeviationBand,
  magnitude01: number,
  baselineY: number,
  chartTop: number,
  chartBottom: number,
  shapeExtent: number,
): number {
  const mag = Math.max(0, Math.min(1, magnitude01))
  if (band === 'within') return baselineY
  const minOff = DAY_MIN_DEV_OFFSET_PX
  if (band === 'above') {
    const maxAbove = Math.max(0, baselineY - chartTop - shapeExtent - minOff)
    return baselineY - (minOff + mag * maxAbove)
  }
  if (band === 'below') {
    const maxBelow = Math.max(0, chartBottom - baselineY - shapeExtent - minOff)
    return baselineY + (minOff + mag * maxBelow)
  }
  return baselineY
}

export function assertDayDotInvariant(
  band: DeviationBand,
  dotY: number,
  baselineY: number,
): void {
  const eps = 1e-4
  if (band === 'within') {
    if (Math.abs(dotY - baselineY) > eps) {
      throw new Error(`within dot must sit on baseline: ${dotY} vs ${baselineY}`)
    }
    return
  }
  if (band === 'above' && dotY >= baselineY - eps) {
    throw new Error(`above dot must be above baseline: y=${dotY} baseline=${baselineY}`)
  }
  if (band === 'below' && dotY <= baselineY + eps) {
    throw new Error(`below dot must be below baseline: y=${dotY} baseline=${baselineY}`)
  }
}
