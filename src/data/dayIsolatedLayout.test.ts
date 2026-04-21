import { describe, expect, it } from 'vitest'
import {
  assertDayDotInvariant,
  computeDayBaselineY,
  computeDayChartBottom,
  computeDayChartTop,
  computeDayDotY,
  computeTextBlockStartY,
  DAY_CHART_ABOVE_PX,
  DAY_CHART_BELOW_PX,
  DAY_MIN_DEV_OFFSET_PX,
  DAY_TEXT_BELOW_CHART_PX,
  DAY_TEXT_NUDGE_UP_PX,
  shapeExtentDayIsolated,
} from './dayIsolatedLayout'

/** Fixed frame for invariant tests (stable across scenarios). */
const chartTop = 100
const baselineY = computeDayBaselineY(chartTop)
const chartBottom = computeDayChartBottom(baselineY)
const se = shapeExtentDayIsolated(8)

describe('computeDayDotY', () => {
  it('places all-above dots strictly above baseline', () => {
    for (const mag of [0, 0.12, 0.5, 1]) {
      const y = computeDayDotY('above', mag, baselineY, chartTop, chartBottom, se)
      expect(y).toBeLessThan(baselineY)
      assertDayDotInvariant('above', y, baselineY)
    }
  })

  it('places all-below dots strictly below baseline', () => {
    for (const mag of [0, 0.12, 0.5, 1]) {
      const y = computeDayDotY('below', mag, baselineY, chartTop, chartBottom, se)
      expect(y).toBeGreaterThan(baselineY)
      assertDayDotInvariant('below', y, baselineY)
    }
  })

  it('places all-within dots on the baseline', () => {
    for (const mag of [0, 0.5, 1]) {
      const y = computeDayDotY('within', mag, baselineY, chartTop, chartBottom, se)
      expect(y).toBe(baselineY)
      assertDayDotInvariant('within', y, baselineY)
    }
  })

  it('mixed: each band respects side invariants', () => {
    const bands = ['above', 'below', 'within', 'above', 'below'] as const
    for (const b of bands) {
      const y = computeDayDotY(b, 0.4, baselineY, chartTop, chartBottom, se)
      assertDayDotInvariant(b, y, baselineY)
    }
  })

  it('minimum offset for smallest non-zero deviation (above/below)', () => {
    const yAbove = computeDayDotY('above', 0, baselineY, chartTop, chartBottom, se)
    const yBelow = computeDayDotY('below', 0, baselineY, chartTop, chartBottom, se)
    expect(baselineY - yAbove).toBeCloseTo(DAY_MIN_DEV_OFFSET_PX, 4)
    expect(yBelow - baselineY).toBeCloseTo(DAY_MIN_DEV_OFFSET_PX, 4)
  })

  it('chart frame: baseline is centered in 400px band', () => {
    expect(baselineY - chartTop).toBe(DAY_CHART_ABOVE_PX)
    expect(chartBottom - baselineY).toBe(DAY_CHART_BELOW_PX)
  })

  it('text block starts below chart bottom (gap minus upward nudge)', () => {
    const t0 = computeTextBlockStartY(chartBottom)
    expect(t0 - chartBottom).toBe(
      DAY_TEXT_BELOW_CHART_PX - DAY_TEXT_NUDGE_UP_PX,
    )
  })

  it('computeDayChartTop is stable for a given zone height', () => {
    const t1 = computeDayChartTop(0, 800)
    const t2 = computeDayChartTop(0, 800)
    expect(t1).toBe(t2)
  })
})
