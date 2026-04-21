import type { ModalityId } from '../constants'

export type DeviationBand = 'above' | 'below' | 'within'

export interface ModalityReading {
  value: number
  deviationMagnitude: number
  band: DeviationBand
}

export interface DayData {
  /** 0 = Monday … 6 = Sunday */
  dayIndex: number
  modalities: Record<ModalityId, ModalityReading>
}

export interface WeekData {
  weekIndex: number
  /** e.g. "Apr 13 – Apr 19, 2026" */
  label: string
  /** Monday of this week (ISO); `days[dayIndex].dayIndex` 0 = Monday … 6 = Sunday. */
  weekStartISO: string
  days: DayData[]
}

export interface HouseholdMember {
  id: string
  displayName: string
  initials: string
  seed: number
  baseline: Record<ModalityId, number>
  weeks: WeekData[]
}

export interface MockDataset {
  members: HouseholdMember[]
}
