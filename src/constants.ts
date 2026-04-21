/** Page background — near-white with a hint of warmth. */
export const BG = '#FAFAF8'
/** Crown-shyness gap when exactly two household members are shown. */
export const GAP_WIDTH_PX = 72
/** Inner padding clamp for nodes/links — slightly tighter to give the graph more room. */
export const ZONE_INSET_PX = 6
/** Legacy reference width from the old left timeline rail; header week control is now a select. */
export const TIMELINE_WIDTH_PX = 200
/** Top chrome: title + subtitle (week range under “Grove”). */
export const HEADER_BAR_PX = 68
/** Level 3: strip under the header for modality + person title and date (above the day-trend graph). */
export const LEVEL3_TITLE_STRIP_PX = 54
/** Modality day trend SVG (`ModalityDayTrend`): viewBox + left inset; midnight grid line is at x = padX. */
export const MODALITY_TREND_VIEWBOX_W = 920
export const MODALITY_TREND_VIEWBOX_H = 500
export const MODALITY_TREND_PAD_X = 26
/** Approx. back ← control width + gap before level-3 title (for aligning title with midnight line). */
export const MODALITY_TREND_HEADER_BACK_CLUSTER_PX = 38
/** Max mock / selectable household size in the demo dataset. */
export const MAX_HOUSEHOLD_MEMBERS = 6

/** Scales network arm lengths, nodes, and related typography vs the base px spec. */
export const NETWORK_VISUAL_SCALE = 1.45

/**
 * Horizontal gap between adjacent people. Two people keep the wide crown-shyness strip;
 * three or more use tighter gaps so everyone still gets usable width.
 */
export function interPersonGapPx(memberCount: number): number {
  if (memberCount <= 1) return 0
  if (memberCount === 2) return GAP_WIDTH_PX
  return Math.max(12, Math.min(36, 78 - memberCount * 8))
}
export const STROKE_COLOR = '#2C2416'
export const STROKE_OPACITY = 0.48
export const STROKE_HIGHLIGHT_OPACITY = 0.68
export const NODE_OPACITY = 0.98

/** Exactly five sensing modalities; IDs match UI labels verbatim. */
export const MODALITIES = [
  'Vocal Prosody',
  'Thermal Imaging',
  'Micro-expressions',
  'Gait and Posture',
  'Physical Movement',
] as const

export type ModalityId = (typeof MODALITIES)[number]

export const MODALITY_COLORS: Record<ModalityId, string> = {
  'Vocal Prosody': '#C4826A',
  'Thermal Imaging': '#D4A96A',
  'Micro-expressions': '#9B8FB5',
  'Gait and Posture': '#6A9FAF',
  'Physical Movement': '#C4B46A',
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** One-letter / two-letter day markers for dense views (Mon–Sun). */
export const DAY_LABELS_COMPACT = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'] as const

export const WEEKS_COUNT = 8
export const TRAINING_WEEKS = 4
