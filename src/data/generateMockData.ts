import {
  MODALITIES,
  TRAINING_WEEKS,
  WEEKS_COUNT,
  type ModalityId,
} from '../constants'
import { mulberry32 } from './prng'
import type { DayData, HouseholdMember, MockDataset, WeekData } from './types'

const MS_DAY = 86_400_000

function startOfMonday(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay()
  const diff = (day + 6) % 7
  x.setDate(x.getDate() - diff)
  x.setHours(12, 0, 0, 0)
  return x
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const y = start.getFullYear()
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString(
    'en-US',
    opts,
  )}, ${y}`
}

function weekMondayOffsets(): { start: Date; end: Date; label: string }[] {
  const anchor = startOfMonday(new Date('2026-04-13T12:00:00'))
  const out: { start: Date; end: Date; label: string }[] = []
  for (let i = WEEKS_COUNT - 1; i >= 0; i--) {
    const start = new Date(anchor.getTime() - i * 7 * MS_DAY)
    const end = new Date(start.getTime() + 6 * MS_DAY)
    out.push({ start, end, label: formatRange(start, end) })
  }
  return out
}

const WEEK_RANGES = weekMondayOffsets()

function bandFor(
  value: number,
  baseline: number,
  magnitude: number,
): import('./types').DeviationBand {
  if (magnitude <= 0.08) return 'within'
  return value > baseline ? 'above' : 'below'
}

function buildMember(
  seed: number,
  id: string,
  displayName: string,
  initials: string,
): HouseholdMember {
  const rand = mulberry32(seed)
  const weeks: WeekData[] = []

  const rawCube: number[][][] = []
  for (let w = 0; w < WEEKS_COUNT; w++) {
    const weekDays: number[][] = []
    for (let d = 0; d < 7; d++) {
      const dayModalities: number[] = []
      for (let m = 0; m < MODALITIES.length; m++) {
        dayModalities.push(rand())
      }
      weekDays.push(dayModalities)
    }
    rawCube.push(weekDays)
  }

  const baseline = {} as Record<ModalityId, number>
  for (const modalityId of MODALITIES) {
    baseline[modalityId] = 0
  }

  for (let mi = 0; mi < MODALITIES.length; mi++) {
    let sum = 0
    let n = 0
    for (let w = 0; w < TRAINING_WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        sum += rawCube[w][d][mi]
        n++
      }
    }
    baseline[MODALITIES[mi]] = n ? sum / n : 0.5
  }

  for (let w = 0; w < WEEKS_COUNT; w++) {
    const days: DayData[] = []
    for (let d = 0; d < 7; d++) {
      const modalities = {} as DayData['modalities']
      for (let mi = 0; mi < MODALITIES.length; mi++) {
        const key = MODALITIES[mi]
        const value = rawCube[w][d][mi]
        const magnitude = Math.abs(value - baseline[key])
        modalities[key] = {
          value,
          deviationMagnitude: magnitude,
          band: bandFor(value, baseline[key], magnitude),
        }
      }
      days.push({ dayIndex: d, modalities })
    }
    weeks.push({
      weekIndex: w,
      label: WEEK_RANGES[w].label,
      weekStartISO: WEEK_RANGES[w].start.toISOString(),
      days,
    })
  }

  return { id, displayName, initials, seed, baseline, weeks }
}

export function generateMockDataset(): MockDataset {
  return {
    members: [
      buildMember(0x9e3779b1, 'm1', 'Alex Chen', 'AC'),
      buildMember(0x6a09e667, 'm2', 'Jordan Lee', 'JL'),
      buildMember(0xbb67ae85, 'm3', 'Sam Rivera', 'SR'),
      buildMember(0xc3ef372d, 'm4', 'Morgan Wu', 'MW'),
      buildMember(0xa54ff53a, 'm5', 'Riley Patel', 'RP'),
      buildMember(0x510e527f, 'm6', 'Casey Kim', 'CK'),
    ],
  }
}
