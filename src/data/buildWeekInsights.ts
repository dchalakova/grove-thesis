import { MODALITIES, type ModalityId } from '../constants'
import type { DeviationBand, HouseholdMember, ModalityReading } from './types'

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** Short clause for “in ___ context” — aligned with app’s day→slot mapping. */
const DAY_SLOT = [
  'early morning',
  'late morning',
  'midday',
  'early afternoon',
  'late afternoon',
  'evening',
  'night',
] as const

/** What someone might be “working on” for each sensing stream (demo copy). */
export const MODALITY_FOCUS: Record<ModalityId, string> = {
  'Vocal Prosody': 'tone and pacing',
  'Thermal Imaging': 'physiological steadiness',
  'Micro-expressions': 'facial micro-signal awareness',
  'Gait and Posture': 'openness in posture and gait',
  'Physical Movement': 'restlessness and pacing in the space',
}

function bandPhrase(band: DeviationBand): string {
  if (band === 'above') return 'above baseline'
  if (band === 'below') return 'below baseline'
  return 'near baseline'
}

function dayContextClause(dayIndex: number): string {
  if (dayIndex <= 2) return 'early-week, higher-load'
  if (dayIndex <= 4) return 'mid-week work rhythms'
  return 'weekend wind-down'
}

export interface InsightSection {
  id: string
  heading: string
  paragraphs: string[]
}

function scoreWeekForModality(
  member: HouseholdMember,
  weekIndex: number,
  modality: ModalityId,
): { sumMag: number; peakDay: number; peakBand: DeviationBand } {
  const week = member.weeks[weekIndex]
  let sumMag = 0
  let peakDay = 0
  let peakMag = -1
  let peakBand: DeviationBand = 'within'
  for (let d = 0; d < 7; d++) {
    const r = week.days[d]!.modalities[modality]
    sumMag += r.deviationMagnitude
    if (r.deviationMagnitude > peakMag) {
      peakMag = r.deviationMagnitude
      peakDay = d
      peakBand = r.band
    }
  }
  return { sumMag, peakDay, peakBand }
}

/**
 * Deterministic “insight” lines for the selected week — mixes goal-oriented copy
 * with simple pattern summaries from deviation bands and magnitudes.
 */
export function buildWeekInsights(
  members: HouseholdMember[],
  weekIndex: number,
): InsightSection[] {
  const sections: InsightSection[] = []

  if (members.length === 0) return sections

  const weekLabel = members[0]!.weeks[weekIndex]?.label ?? ''

  sections.push({
    id: 'overview',
    heading: 'This week',
    paragraphs: [
      weekLabel
        ? members.length >= 2
          ? `Patterns below are drawn from ${weekLabel} — how each of you moves across modalities this week, plus one household-level comparison.`
          : `Patterns below are drawn from ${weekLabel}, across the modalities you track in Grove.`
        : members.length >= 2
          ? 'Patterns below summarize both household members’ modalities and how they relate this week.'
          : 'Patterns below are drawn from the modalities you track in Grove.',
    ],
  })

  for (const member of members) {
    const ranked = MODALITIES.map((mod) => ({
      mod,
      ...scoreWeekForModality(member, weekIndex, mod),
    })).sort((a, b) => b.sumMag - a.sumMag)

    const top = ranked[0]!
    const second = ranked[1]!

    const peakName = DAY_NAMES[top.peakDay]!
    const slot = DAY_SLOT[top.peakDay]!
    const ctx = dayContextClause(top.peakDay)

    const p1 = `You indicated you wanted to work on ${MODALITY_FOCUS[top.mod]} in ${ctx} contexts (${slot} windows matter most for ${peakName}). This week, ${top.mod} registered most strongly on ${peakName} — ${bandPhrase(top.peakBand)}.`

    const sPeak = DAY_NAMES[second.peakDay]!
    const p2 = `Across the week, ${second.mod} shows the next clearest motion: activity clusters toward ${sPeak}, mostly reading ${bandPhrase(second.peakBand)} relative to your personal baseline.`

    const aboveHeavy = ranked.filter((x) => {
      const w = member.weeks[weekIndex]!
      let above = 0
      for (let d = 0; d < 7; d++) {
        if (w.days[d]!.modalities[x.mod].band === 'above') above++
      }
      return above >= 4
    })

    const names = aboveHeavy.map((x) => x.mod)
    const p3 =
      names.length > 0
        ? `${names.join(' and ')} ${names.length > 1 ? 'spend' : 'spends'} several days above baseline — worth watching whether that stays tied to specific weekdays or spreads.`
        : `No single modality stayed pinned above baseline for most of the week; variation day-to-day is the main story.`

    sections.push({
      id: `person-${member.id}`,
      heading: member.displayName,
      paragraphs: [p1, p2, p3],
    })
  }

  if (members.length >= 2) {
    const a = members[0]!
    const b = members[1]!
    let samePeakMod: ModalityId | null = null
    let bestOverlap = -1
    for (const mod of MODALITIES) {
      const pa = scoreWeekForModality(a, weekIndex, mod)
      const pb = scoreWeekForModality(b, weekIndex, mod)
      if (pa.peakDay === pb.peakDay && pa.sumMag + pb.sumMag > bestOverlap) {
        bestOverlap = pa.sumMag + pb.sumMag
        samePeakMod = mod
      }
    }
    if (samePeakMod) {
      const d = scoreWeekForModality(a, weekIndex, samePeakMod).peakDay
      sections.push({
        id: 'household',
        heading: 'Household pattern',
        paragraphs: [
          `Both ${a.displayName.split(' ')[0]} and ${b.displayName.split(' ')[0]} show the strongest ${samePeakMod} signal on ${DAY_NAMES[d]!} — a shared rhythm worth noticing if schedules align that day.`,
        ],
      })
    } else {
      sections.push({
        id: 'household',
        heading: 'Household pattern',
        paragraphs: [
          `This week, peaks land on different days for each person — overlap is more about shared space than synchronized stress on a single weekday.`,
        ],
      })
    }
  }

  return sections
}

/**
 * Insights when the user is zoomed into a single day (level 2 + day zoom):
 * that day’s modalities for the focused person, plus same-day household context when applicable.
 */
export function buildDayInsights(
  members: HouseholdMember[],
  weekIndex: number,
  dayIndex: number,
  focusPersonId: string,
): InsightSection[] {
  const sections: InsightSection[] = []
  if (members.length === 0) return sections

  const weekLabel = members[0]!.weeks[weekIndex]?.label ?? ''
  const dayName = DAY_NAMES[dayIndex]!
  const focus = members.find((m) => m.id === focusPersonId)
  if (!focus) return buildWeekInsights(members, weekIndex)

  const slot = DAY_SLOT[dayIndex]!
  const ctx = dayContextClause(dayIndex)

  sections.push({
    id: 'day-overview',
    heading: dayName,
    paragraphs: [
      weekLabel
        ? `These insights are about ${dayName} in ${weekLabel} — ${slot}, ${ctx} — and how each modality shows up for ${focus.displayName} on this one day.`
        : `These insights focus on ${dayName} for ${focus.displayName}, modality by modality.`,
    ],
  })

  const ranked = MODALITIES.map((mod) => ({
    mod,
    r: focus.weeks[weekIndex].days[dayIndex]!.modalities[mod],
  })).sort((a, b) => b.r.deviationMagnitude - a.r.deviationMagnitude)

  const top = ranked[0]!
  const soft = ranked[ranked.length - 1]!
  const p1 = `On ${dayName}, ${top.mod} carries the strongest signal vs. baseline — ${bandPhrase(top.r.band)}. You’re working on ${MODALITY_FOCUS[top.mod]} in Grove.`
  const p2 = `Across modalities the same day, ${soft.mod} is relatively quiet (${bandPhrase(soft.r.band)}), which can help you see what dominated the day’s “shape.”`

  sections.push({
    id: `day-${focus.id}`,
    heading: focus.displayName,
    paragraphs: [p1, p2],
  })

  if (members.length >= 2) {
    const other = members.find((m) => m.id !== focusPersonId)
    if (other) {
      const rankedO = MODALITIES.map((mod) => ({
        mod,
        r: other.weeks[weekIndex].days[dayIndex]!.modalities[mod],
      })).sort((a, b) => b.r.deviationMagnitude - a.r.deviationMagnitude)
      const oTop = rankedO[0]!
      sections.push({
        id: 'household-day',
        heading: 'Same day, household',
        paragraphs: [
          `${other.displayName}’s strongest signal on ${dayName} is ${oTop.mod} (${bandPhrase(oTop.r.band)}). Same calendar day, possibly different story — useful when you compare routines or stressors.`,
        ],
      })
    }
  }

  return sections
}

/**
 * Insights when viewing a single modality’s day trend (level 3): that stream, that day, that person.
 */
export function buildModalityTrendInsights(
  member: HouseholdMember,
  weekIndex: number,
  dayIndex: number,
  modality: ModalityId,
  reading: ModalityReading,
): InsightSection[] {
  const weekLabel = member.weeks[weekIndex]?.label ?? ''
  const dayName = DAY_NAMES[dayIndex]!
  const focus = MODALITY_FOCUS[modality]
  const strong = reading.deviationMagnitude >= 0.35

  return [
    {
      id: 'trend-modality',
      heading: modality,
      paragraphs: [
        weekLabel
          ? `This view is only ${modality} on ${dayName} (${weekLabel}) for ${member.displayName}. The curve runs through waking hours (no samples overnight).`
          : `This view is ${modality} on ${dayName} for ${member.displayName}.`,
        `You chose to work on ${focus} in Grove. For this day, the stream sits ${bandPhrase(reading.band)} relative to baseline${strong ? ', with enough separation from the midline to matter in the day summary.' : ' — moves stay in a modest band around your personal center.'}`,
      ],
    },
    {
      id: 'trend-graph',
      heading: 'Reading the trend',
      paragraphs: [
        `Hourly points show how this modality shifts from morning toward evening. The smooth line connects those samples; dots with a note carry a small marker. Use it to spot when the day diverges most from baseline, then compare to other modalities back on the day view.`,
      ],
    },
  ]
}
