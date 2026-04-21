import * as d3 from 'd3'
import { useLayoutEffect, useRef, useState, useCallback } from 'react'
import {
  DAY_LABELS,
  DAY_LABELS_COMPACT,
  MODALITIES,
  MODALITY_COLORS,
  NODE_OPACITY,
  STROKE_COLOR,
  STROKE_HIGHLIGHT_OPACITY,
  STROKE_OPACITY,
  NETWORK_VISUAL_SCALE,
  type ModalityId,
} from '../constants'
import {
  computeDayBaselineY,
  computeDayChartBottom,
  computeDayChartTop,
  computeDayDotY,
  computeTextBlockStartY,
  DAY_DESC_MAX_W_PX,
  DAY_DESC_WRAP_MEASURE_PAD_PX,
  DAY_GAP_BAND_TO_DESC_PX,
  DAY_GAP_NAME_TO_BAND_PX,
  DAY_TITLE_BAND_LEAD_MULT,
  shapeExtentDayIsolated,
} from '../data/dayIsolatedLayout'
import {
  buildNetworkLayout,
  dayZoneSectorPolygonPoints,
  linkPath,
  modalityBaselineMarkerRadius,
  type LayoutLink,
  type LayoutNode,
  type NetworkLayout,
  type ZoneRect,
} from '../data/layout'
import type { DeviationBand } from '../data/types'
import type { HouseholdMember } from '../data/types'

/** Parse `translate(x,y)` for smooth modality position tweens between weekdays. */
function parseSvgTranslate(attr: string | null): { x: number; y: number } | null {
  if (!attr) return null
  const m = /translate\(\s*([^,\s]+)\s*,\s*([^)]+)\)/.exec(attr)
  if (!m) return null
  const x = Number.parseFloat(m[1]!)
  const y = Number.parseFloat(m[2]!)
  if (Number.isNaN(x) || Number.isNaN(y)) return null
  return { x, y }
}

export type ViewLevel = 1 | 2 | 3

interface GroveNetworkProps {
  svgId: string
  zone: ZoneRect
  person: HouseholdMember
  weekIndex: number
  level: ViewLevel
  dimNetwork: boolean
  lineHighlight: boolean
  selectedNodeId: string | null
  showDayLabels: boolean
  /** Use M / T / W / Th / F / S / Su instead of full weekday names. */
  compactDayLabels?: boolean
  /** When set, zoom & emphasize this weekday branch (hub → day → modalities). */
  zoomDayIndex: number | null
  /** Level 1: click a day primary to zoom that branch. */
  onDayBranchClick?: (dayIndex: number) => void
  onZoneClick: () => void
  onModalityClick: (dayIndex: number, modality: ModalityId) => void
  onModalityHover: (
    payload: null | {
      modality: ModalityId
      band: DeviationBand
      x: number
      y: number
    },
  ) => void
}

function interpolatePath(a: string, b: string) {
  return d3.interpolateString(a, b)
}

const L1_RAY_EPS = 1e-12

/** Ray from origin along (rx, ry); positive t hits open segment AB (excluding degenerate). */
function raySegmentIntersectionT(
  rx: number,
  ry: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number | null {
  const sx = bx - ax
  const sy = by - ay
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < L1_RAY_EPS) return null
  const t = (ax * sy - ay * sx) / denom
  const u = (ax * ry - ay * rx) / denom
  if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t
  return null
}

/**
 * Distance from modality center to shape boundary along the direction toward the day primary,
 * so the link ends on the shape edge (not short of it or past it).
 */
function l1ShapeExtent(d: LayoutNode, dayIsolated: boolean): number {
  return dayIsolated ? d.r * 1.46 : d.r
}

function l1DepthToShapeBoundaryAlongHub(
  modNode: LayoutNode,
  nodeById: Map<string, LayoutNode>,
  dayIsolated: boolean,
  dix: number,
  diy: number,
): number {
  const ext = l1ShapeExtent(modNode, dayIsolated)
  const band = modNode.band ?? 'within'
  if (band === 'below') {
    return ext
  }
  if (band === 'within') {
    const s = ext * 2
    const half = s / 2
    return half / Math.max(Math.abs(dix), Math.abs(diy))
  }
  if (band === 'above') {
    const s = ext * 2
    const H = (s * Math.sqrt(3)) / 2
    const apexY = (-2 * H) / 3
    const baseY = H / 3
    const thetaDeg = l1ModalityRootOutwardAngleDeg(modNode, nodeById)
    const θ = (thetaDeg * Math.PI) / 180
    const cos = Math.cos(θ)
    const sin = Math.sin(θ)
    /** World → local before polygon rotate(θ): inverse of SVG rotate matrix. */
    const lx = dix * cos - diy * sin
    const ly = dix * sin + diy * cos
    const verts: [number, number][] = [
      [0, apexY],
      [-s / 2, baseY],
      [s / 2, baseY],
    ]
    let minT = Infinity
    for (let i = 0; i < 3; i++) {
      const [x0, y0] = verts[i]!
      const [x1, y1] = verts[(i + 1) % 3]!
      const t = raySegmentIntersectionT(lx, ly, x0, y0, x1, y1)
      if (t !== null && t < minT) minT = t
    }
    if (Number.isFinite(minT) && minT > 0) return minT
    return (2 * H) / 3
  }
  return 0
}

/** Level 1: primary→modality link ends on the shape boundary facing the hub (circle / square / triangle). */
function l1PrimaryModalityLinkEndpoints(
  lk: LayoutLink,
  nodeById: Map<string, LayoutNode>,
  viewLevel: ViewLevel,
  dayIsolated: boolean,
): { x0: number; y0: number; x1: number; y1: number } {
  const m = /^l-p-(\d+)-(\d+)$/.exec(lk.id)
  if (!m || viewLevel !== 1) {
    return { x0: lk.x0, y0: lk.y0, x1: lk.x1, y1: lk.y1 }
  }
  const day = Number(m[1])
  const mi = Number(m[2])
  const modNode = nodeById.get(`m-${day}-${mi}`)
  if (!modNode || modNode.kind !== 'modality') {
    return { x0: lk.x0, y0: lk.y0, x1: lk.x1, y1: lk.y1 }
  }
  const px = lk.x0
  const py = lk.y0
  const mx = lk.x1
  const my = lk.y1
  const vx = px - mx
  const vy = py - my
  const len = Math.hypot(vx, vy) || 1
  const dix = vx / len
  const diy = vy / len
  const depth = l1DepthToShapeBoundaryAlongHub(modNode, nodeById, dayIsolated, dix, diy)
  if (!(depth > 0) || !Number.isFinite(depth)) {
    return { x0: lk.x0, y0: lk.y0, x1: lk.x1, y1: lk.y1 }
  }
  return {
    x0: px,
    y0: py,
    x1: mx + dix * depth,
    y1: my + diy * depth,
  }
}

function l1PrimaryModalityLinkStrokeWidth(
  _lk: LayoutLink,
  _nodeById: Map<string, LayoutNode>,
  _viewLevel: ViewLevel,
): number {
  return 0.95
}

function l1EquilateralTrianglePoints(side: number): string {
  const H = (side * Math.sqrt(3)) / 2
  const apexY = (-2 * H) / 3
  const baseY = H / 3
  return `0,${apexY} ${-side / 2},${baseY} ${side / 2},${baseY}`
}

/** Degrees: rotate triangle so apex points outward from the network center (root). */
function l1ModalityRootOutwardAngleDeg(d: LayoutNode, nodeById: Map<string, LayoutNode>): number {
  const root = nodeById.get('root')
  if (!root) return 0
  const dx = d.x - root.x
  const dy = d.y - root.y
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90
}

export type DayZoomParams = {
  transform: string
  zx: number
  zy: number
  s: number
  cx: number
  cy: number
}

function dayZoomTransform(
  zone: ZoneRect,
  layout: NetworkLayout,
  dayIndex: number,
): DayZoomParams | null {
  /** Hub for the day + its modalities only (no central / initials node). */
  const nodes = layout.nodes.filter(
    (n) =>
      (n.kind === 'primary' && n.dayIndex === dayIndex) ||
      (n.kind === 'modality' && n.dayIndex === dayIndex),
  )
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const pad = (n.r ?? 4) + 32
    minX = Math.min(minX, n.x - pad)
    minY = Math.min(minY, n.y - pad)
    maxX = Math.max(maxX, n.x + pad)
    maxY = Math.max(maxY, n.y + pad)
  }
  const bw = maxX - minX
  const bh = maxY - minY
  if (!(bw > 0) || !(bh > 0)) return null
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let s = Math.min(zone.w / bw, zone.h / bh) * 0.82
  s = Math.max(1.2, Math.min(4.5, s))
  const zx = zone.x + zone.w / 2
  const zy = zone.y + zone.h / 2
  const transform = `translate(${zx},${zy}) scale(${s}) translate(${-cx},${-cy})`
  return { transform, zx, zy, s, cx, cy }
}

/** u=0 → full zoom; u=1 → identity (for smooth zoom-out). */
function zoomTransformAtProgress(
  zx: number,
  zy: number,
  s: number,
  cx: number,
  cy: number,
  u: number,
): string {
  const a = 1 - u
  return `translate(${zx * a},${zy * a}) scale(${s + (1 - s) * u}) translate(${-cx * a},${-cy * a})`
}

function nodeInZoomDay(n: LayoutNode, day: number | null): boolean {
  if (day === null) return true
  if (n.kind === 'root') return true
  if (n.kind === 'primary') return n.dayIndex === day
  if (n.kind === 'modality') return n.dayIndex === day
  return true
}

function bandBaselineLabel(band: DeviationBand): string {
  if (band === 'above') return 'ABOVE'
  if (band === 'below') return 'BELOW'
  return 'WITHIN'
}

function bandSignificanceLines(
  modality: ModalityId,
  band: DeviationBand,
): { line1: string; line2: string } {
  if (band === 'within') {
    return {
      line1: 'Within your typical range for this signal.',
      line2: 'No significant deviation this week.',
    }
  }

  const copy: Record<
    ModalityId,
    Record<'above' | 'below', { line1: string; line2: string }>
  > = {
    'Vocal Prosody': {
      above: {
        line1: 'Elevated pitch and tempo vs your usual pattern.',
        line2: 'Can be associated with activation, excitement, or stress.',
      },
      below: {
        line1: 'Slower, flatter speech vs your usual pattern.',
        line2: 'Can be associated with fatigue, low energy, or quiet state.',
      },
    },
    'Thermal Imaging': {
      above: {
        line1: 'Higher facial blood flow around eyes and nose.',
        line2: 'Can be associated with arousal, exertion, or load.',
      },
      below: {
        line1: 'Cooler facial temperature than your usual pattern.',
        line2: 'Can be associated with calm or low stimulation states.',
      },
    },
    'Micro-expressions': {
      above: {
        line1: 'More frequent jaw, brow, and frown micro-signals.',
        line2: 'Can be associated with concentration or emotional processing.',
      },
      below: {
        line1: 'Quieter facial muscle activity than your baseline.',
        line2: 'Can be associated with relaxation or low activation.',
      },
    },
    'Gait and Posture': {
      above: {
        line1: 'Higher shoulder tension and postural compression.',
        line2: 'Can be associated with stress, fatigue, or concentration.',
      },
      below: {
        line1: 'More open posture and more fluid movement quality.',
        line2: 'Can be associated with comfort or physical relaxation.',
      },
    },
    'Physical Movement': {
      above: {
        line1: 'Faster movement and more environment interactions.',
        line2: 'Can be associated with urgency, high energy, or busyness.',
      },
      below: {
        line1: 'Slower, less frequent movement through the space.',
        line2: 'Can be associated with rest, low energy, or quiet day.',
      },
    },
  }

  return copy[modality][band]
}

/** Place captions just left of the dot, vertically aligned with its center. */
function modCaptionAnchorLeft(d: LayoutNode): { x: number; y: number } {
  const gap = 5
  return { x: d.x - d.r - gap, y: d.y }
}

/** Bottom-left ? with hover key — render once in App above other columns so the popup is not covered. */
export function EncodingHelpHint({ zone, level }: { zone: ZoneRect; level: ViewLevel }) {
  const [open, setOpen] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLeave = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }, [])

  const onEnter = useCallback(() => {
    clearLeave()
    setOpen(true)
  }, [clearLeave])

  const onLeave = useCallback(() => {
    clearLeave()
    leaveTimer.current = setTimeout(() => setOpen(false), 100)
  }, [clearLeave])

  if (level > 2) return null

  const pad = 12
  const iconR = 13
  const cx = zone.x + pad + iconR
  const cy = zone.y + zone.h - pad - iconR
  const popupW = Math.min(280, Math.max(200, zone.w - pad * 2))
  const popupH = 228
  const overlap = 4
  const popupY = Math.max(zone.y + 8, cy - iconR - popupH + overlap)
  const popupX = zone.x + pad

  return (
    <g
      className="encoding-help-hint"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ pointerEvents: 'all' }}
    >
      {open ? (
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(28, 24, 18, 0.14)"
          pointerEvents="none"
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={iconR}
        fill="rgba(250, 250, 248, 0.97)"
        stroke="#d4cdc2"
        strokeWidth={0.9}
        style={{ cursor: 'help' }}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#6e655a"
        style={{
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'help',
          pointerEvents: 'none',
        }}
      >
        ?
      </text>
      {open ? (
        <foreignObject x={popupX} y={popupY} width={popupW} height={popupH}>
          <div
            style={{
              boxSizing: 'border-box',
              height: '100%',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #e2dbd0',
              background: 'rgba(250, 250, 248, 0.98)',
              boxShadow: '0 8px 28px rgba(44, 36, 22, 0.12)',
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: 9.5,
              lineHeight: 1.32,
              color: '#4a4338',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 5,
                color: '#2C2416',
                fontSize: 10,
              }}
            >
              Reading the network
            </div>
            <p style={{ margin: '0 0 6px' }}>
              From the center to each weekday: a longer arm means that day was more
              activated overall across modalities (combined deviation from baseline).
            </p>
            <div
              style={{
                fontWeight: 600,
                marginBottom: 4,
                color: '#3d3628',
                fontSize: 9.5,
              }}
            >
              Weekday → modality
            </div>
            <div
              role="list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                margin: 0,
              }}
            >
              <div role="listitem" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ flexShrink: 0, width: 12, height: 12, marginTop: 1 }} aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <circle cx="6" cy="6" r="4.2" fill="#8C8070" />
                  </svg>
                </span>
                <span>
                  <strong>Below baseline</strong> — short arm. Quieter signal than usual.
                </span>
              </div>
              <div role="listitem" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ flexShrink: 0, width: 12, height: 12, marginTop: 1 }} aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <rect
                      x="1.2"
                      y="1.2"
                      width="9.6"
                      height="9.6"
                      rx="1"
                      ry="1"
                      fill="#8C8070"
                    />
                  </svg>
                </span>
                <span>
                  <strong>At baseline</strong> — medium arm. Within the usual range.
                </span>
              </div>
              <div role="listitem" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ flexShrink: 0, width: 12, height: 12, marginTop: 1 }} aria-hidden>
                  <svg width="12" height="12" viewBox="-6 -6 12 12">
                    <polygon points="0,-4.2 -4.2,3.6 4.2,3.6" fill="#8C8070" />
                  </svg>
                </span>
                <span>
                  <strong>Above baseline</strong> — long arm, triangle pointing outward. More
                  activated than usual.
                </span>
              </div>
            </div>
          </div>
        </foreignObject>
      ) : null}
    </g>
  )
}

export function GroveNetwork({
  svgId,
  zone,
  person,
  weekIndex,
  level,
  dimNetwork,
  lineHighlight,
  selectedNodeId,
  showDayLabels,
  compactDayLabels = false,
  zoomDayIndex,
  onDayBranchClick,
  onZoneClick,
  onModalityClick,
  onModalityHover,
}: GroveNetworkProps) {
  /** Graph geometry (may carry day-zoom transform); axis labels live in gAxisRef so they stay readable. */
  const gZoomRef = useRef<SVGGElement | null>(null)
  const gAxisRef = useRef<SVGGElement | null>(null)
  const lastLayoutByWeek = useRef<Record<string, NetworkLayout>>({})
  const lastZoomParamsRef = useRef<DayZoomParams | null>(null)
  const lastZoomDayRef = useRef<number | null>(null)
  const exitZoomInFlightRef = useRef(false)
  const [zoomAnimTick, setZoomAnimTick] = useState(0)

  const week = person.weeks[weekIndex]

  useLayoutEffect(() => {
    if (!gZoomRef.current || !gAxisRef.current) return
    const gZoom = d3.select(gZoomRef.current)
    const gAxis = d3.select(gAxisRef.current)

    /** During zoom-out tween, keep branch fades until transform finishes. */
    const zDay =
      zoomDayIndex !== null
        ? zoomDayIndex
        : lastZoomParamsRef.current != null
          ? lastZoomDayRef.current
          : null

    const dayIsolated = zDay !== null

    /** Previous rendered layout for this person (any week) — enables smooth week-to-week motion. */
    const lastFrameKey = `${person.id}-lastFrame`
    const prevLayout = lastLayoutByWeek.current[lastFrameKey]
    const next = buildNetworkLayout(week, zone, person.seed)
    const nodeById = new Map(next.nodes.map((n) => [n.id, n]))
    const prevById = new Map(prevLayout?.nodes.map((n) => [n.id, n]) ?? [])
    const prevLinkById = new Map(prevLayout?.links.map((l) => [l.id, l]) ?? [])

    const strokeBase = lineHighlight ? STROKE_HIGHLIGHT_OPACITY : STROKE_OPACITY

    const vs = NETWORK_VISUAL_SCALE
    const plotMin = Math.min(zone.w, zone.h)
    const dayLabPx = Math.max(9, Math.min(20, plotMin * 0.03 * vs))
    const initialsPx = Math.max(11, Math.min(24, plotMin * 0.038 * vs))
    const baselineR = modalityBaselineMarkerRadius()
    gZoom.attr('opacity', 1)

    gZoom.select('rect.hit').remove()
    gZoom.selectAll('g.day-sector-hit').remove()
    if (!showDayLabels) {
      gZoom.selectAll('text.daylabel').remove()
    }

    gZoom.insert('rect', ':first-child')
      .attr('class', 'hit')
      .attr('x', zone.x)
      .attr('y', zone.y)
      .attr('width', zone.w)
      .attr('height', zone.h)
      .attr('fill', 'transparent')
      .style('cursor', 'default')
      .on('click', (e) => {
        if (level === 1) {
          e.stopPropagation()
          onZoneClick()
        }
      })

    const nodeLookup = new Map(next.nodes.map((n) => [n.id, n]))

    /**
     * Place weekday text beside the primary, on the perpendicular to the hub→day arm,
     * on the side away from the modality cluster (avoids root–primary and primary–modality links).
     */
    function dayLabelAnchor(
      primary: LayoutNode,
      root: LayoutNode,
      modalities: LayoutNode[],
      dayIndex: number,
    ): { x: number; y: number } {
      const vx = primary.x - root.x
      const vy = primary.y - root.y
      const vlen = Math.hypot(vx, vy) || 1
      const nx = -vy / vlen
      const ny = vx / vlen

      let cx = primary.x
      let cy = primary.y
      if (modalities.length > 0) {
        let sx = 0
        let sy = 0
        for (const m of modalities) {
          sx += m.x
          sy += m.y
        }
        cx = sx / modalities.length
        cy = sy / modalities.length
      }

      const wx = cx - primary.x
      const wy = cy - primary.y
      let side = Math.sign(nx * wx + ny * wy)
      if (side === 0) side = dayIndex % 2 === 0 ? 1 : -1

      const outward = -side
      const dist =
        primary.r + Math.max(8, dayLabPx * 0.58) + plotMin * 0.02

      return {
        x: primary.x + nx * outward * dist,
        y: primary.y + ny * outward * dist,
      }
    }

    const opacityForLink = (lk: LayoutLink) => {
      if (!dimNetwork || !selectedNodeId) return 1
      const n = nodeLookup.get(selectedNodeId)
      if (!n || n.kind !== 'modality') return 0.25
      const d = n.dayIndex!
      const mi = MODALITIES.indexOf(n.modality!)
      const hit =
        lk.id === `l-root-${d}` || lk.id === `l-p-${d}-${mi}`
      return hit ? 1 : 0.12
    }

    const opacityForNode = (n: LayoutNode) => {
      if (!dimNetwork || !selectedNodeId) return 1
      const sn = nodeLookup.get(selectedNodeId)
      if (!sn || sn.kind !== 'modality') return 0.25
      const d = sn.dayIndex!
      if (n.kind === 'root') return 0.35
      if (n.kind === 'primary' && n.dayIndex === d) return 1
      if (n.kind === 'modality' && n.id === selectedNodeId) return 1
      if (n.kind === 'modality' && n.dayIndex === d) return 0.4
      return 0.18
    }

    const zoomBranchMul = (n: LayoutNode) => {
      if (zDay === null) return 1
      if (n.kind === 'root') return 1
      if (n.kind === 'primary' && n.dayIndex === zDay) return 1
      if (n.kind === 'modality' && n.dayIndex === zDay) return 1
      return 0.12
    }
    const zoomLinkMul = (lk: LayoutLink) => {
      if (zDay === null) return 1
      if (lk.id === `l-root-${zDay}` || new RegExp(`^l-p-${zDay}-`).test(lk.id))
        return 1
      return 0.1
    }
    const zoomLabelMul = (dayIndex: number) =>
      zDay === null || dayIndex === zDay ? 1 : 0.14

    if (dayIsolated) {
      gZoom.selectAll('text.daylabel').remove()
      gZoom.selectAll('circle.root, text.initials').remove()
    }
    const dayModalities = dayIsolated && zDay !== null
      ? next.nodes
          .filter((n) => n.kind === 'modality' && n.dayIndex === zDay)
          .sort(
            (a, b) =>
              MODALITIES.indexOf(a.modality!) - MODALITIES.indexOf(b.modality!),
          )
      : []
    const axisY = zone.y + zone.h - Math.max(106 * vs, plotMin * 0.29 * vs)
    let baselineY = zone.y + zone.h * 0.5
    let axisTitleY = axisY + 14
    let axisBandY = axisTitleY + 20
    let axisNote1Y = axisBandY + 18
    /** Day chart frame: fixed 200px above + 200px below baseline; baseline at 50% of this 400px band. */
    let dayChartTop = zone.y
    let dayChartBottom = zone.y + zone.h
    let axisTitlePx = Math.max(14, Math.min(26, plotMin * 0.036 * vs))
    let axisBandPx = Math.max(12, Math.min(20, plotMin * 0.029 * vs))
    let axisNotePx = Math.max(11, Math.min(18, plotMin * 0.024 * vs))
    if (dayIsolated) {
      const m = 0.88
      const insightSmaller = 0.82
      axisTitlePx *= m
      axisBandPx *= m
      axisNotePx *= m * insightSmaller
    }
    if (dayIsolated) {
      dayChartTop = computeDayChartTop(zone.y, zone.h)
      baselineY = computeDayBaselineY(dayChartTop)
      dayChartBottom = computeDayChartBottom(baselineY)
      const textBlockStartY = computeTextBlockStartY(dayChartBottom)
      axisTitleY = textBlockStartY + axisTitlePx
      axisBandY =
        axisTitleY +
        axisTitlePx +
        DAY_GAP_NAME_TO_BAND_PX +
        axisBandPx * DAY_TITLE_BAND_LEAD_MULT
      axisNote1Y =
        axisBandY + axisBandPx + DAY_GAP_BAND_TO_DESC_PX + axisNotePx
    }
    const estimateAxisWidth = (text: string, px: number) =>
      Math.max(12, text.length * px * 0.56 + 6)
    const dayModPos = new Map<string, { x: number; y: number }>()
    if (dayIsolated && dayModalities.length > 0) {
      const xPad = Math.max(30, zone.w * 0.08)
      const xStep = dayModalities.length > 1
        ? (zone.w - xPad * 2) / (dayModalities.length - 1)
        : 0
      for (let i = 0; i < dayModalities.length; i++) {
        const n = dayModalities[i]!
        const mag = Math.max(0, Math.min(1, n.deviationMagnitude ?? 0))
        const band = n.band ?? 'within'
        const ext = shapeExtentDayIsolated(n.r)
        const y = computeDayDotY(
          band,
          mag,
          baselineY,
          dayChartTop,
          dayChartBottom,
          ext,
        )
        const x = zone.x + xPad + xStep * i
        dayModPos.set(n.id, { x, y })
      }
    }
    const axisLabelX = new Map<string, number>()
    let maxHalfLabelWidth = 0
    for (const d of dayModalities) {
      const tag = bandBaselineLabel(d.band ?? 'within')
      const notes = bandSignificanceLines(d.modality!, d.band ?? 'within')
      const maxW = Math.max(
        estimateAxisWidth(d.modality ?? '', axisTitlePx),
        estimateAxisWidth(tag, axisBandPx),
        dayIsolated
          ? DAY_DESC_MAX_W_PX
          : Math.max(
              estimateAxisWidth(notes.line1, axisNotePx),
              estimateAxisWidth(notes.line2, axisNotePx),
            ),
      )
      maxHalfLabelWidth = Math.max(maxHalfLabelWidth, maxW / 2)
    }
    const colCount = dayModalities.length
    if (colCount > 0) {
      const leftBound = zone.x + maxHalfLabelWidth + 8
      const rightBound = zone.x + zone.w - maxHalfLabelWidth - 8
      const span = Math.max(0, rightBound - leftBound)
      const step = colCount > 1 ? span / (colCount - 1) : 0
      for (let i = 0; i < colCount; i++) {
        const d = dayModalities[i]!
        const x = colCount > 1 ? leftBound + step * i : zone.x + zone.w / 2
        axisLabelX.set(d.id, x)
      }
    }
    for (const d of dayModalities) {
      const p = dayModPos.get(d.id)
      if (!p) continue
      dayModPos.set(d.id, { x: axisLabelX.get(d.id) ?? p.x, y: p.y })
    }
    const baselineX1 = dayIsolated
      ? zone.x + 12
      : colCount > 0
        ? Math.min(...dayModalities.map((d) => axisLabelX.get(d.id) ?? d.x)) - 18
        : zone.x + 20
    const baselineX2 = dayIsolated
      ? zone.x + zone.w - 12
      : colCount > 0
        ? Math.max(...dayModalities.map((d) => axisLabelX.get(d.id) ?? d.x)) + 18
        : zone.x + zone.w - 20
    const linksData = dayIsolated
      ? []
      : next.links

    const linkOp = (lk: LayoutLink) =>
      dayIsolated
        ? strokeBase * opacityForLink(lk)
        : strokeBase * opacityForLink(lk) * zoomLinkMul(lk)

    const nodeOp = (n: LayoutNode) =>
      dayIsolated
        ? opacityForNode(n)
        : opacityForNode(n) * zoomBranchMul(n)

    const modOp = (n: LayoutNode) =>
      dayIsolated
        ? opacityForNode(n) * NODE_OPACITY
        : opacityForNode(n) * NODE_OPACITY * zoomBranchMul(n)

    /** Day-isolated: key modalities by modality id so D3 updates the same nodes across weekday changes (smooth motion). */
    const modalityStableKey = (d: LayoutNode) =>
      dayIsolated && d.kind === 'modality' && d.modality != null
        ? `mod-${d.modality}`
        : d.id

    const linkJoin = gZoom
      .selectAll<SVGPathElement, LayoutLink>('path.link')
      .data(linksData, (d) => d.id)

    const linkEnter = linkJoin
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', STROKE_COLOR)
      .attr('stroke-width', (d) =>
        l1PrimaryModalityLinkStrokeWidth(
          prevLinkById.get(d.id) ?? d,
          prevLinkById.get(d.id) ? prevById : nodeById,
          level,
        ),
      )
      .attr('opacity', (d) => linkOp(d))

    linkEnter.each(function (d) {
      const pl = prevLinkById.get(d.id)
      const endPts = l1PrimaryModalityLinkEndpoints(d, nodeById, level, dayIsolated)
      const startPts = pl
        ? l1PrimaryModalityLinkEndpoints(pl, prevById, level, dayIsolated)
        : endPts
      const start = linkPath(startPts.x0, startPts.y0, startPts.x1, startPts.y1)
      d3.select(this).attr('d', start)
    })

    const linkMerged = linkEnter.merge(linkJoin)

    linkMerged.style('pointer-events', () =>
      level === 1 && onDayBranchClick && !dayIsolated ? 'none' : 'auto',
    )

    linkMerged.each(function (d) {
      const endPts = l1PrimaryModalityLinkEndpoints(d, nodeById, level, dayIsolated)
      const end = linkPath(endPts.x0, endPts.y0, endPts.x1, endPts.y1)
      const el = d3.select(this)
      const start = el.attr('d') ?? end
      el
        .transition()
        .duration(650)
        .ease(d3.easeCubicInOut)
        .attrTween('d', () => interpolatePath(start, end))
        .attr('opacity', linkOp(d))
        .attr('stroke-width', l1PrimaryModalityLinkStrokeWidth(d, nodeById, level))
    })

    linkJoin.exit().remove()

    if (level === 1 && onDayBranchClick && !dayIsolated) {
      const rootNode = nodeLookup.get('root')
      if (rootNode && gZoom.select('path.link').node()) {
        const gHit = gZoom
          .insert('g', 'path.link')
          .attr('class', 'day-sector-hit')
          .style('pointer-events', 'auto')
        for (let di = 0; di < 7; di++) {
          const pts = dayZoneSectorPolygonPoints(rootNode, di, zone)
          gHit
            .append('polygon')
            .attr('data-day', di)
            .attr('points', pts.map((p) => `${p.x},${p.y}`).join(' '))
            .attr('fill', 'rgba(0,0,0,0)')
            .style('cursor', 'pointer')
            .on('click', (e) => {
              e.stopPropagation()
              onDayBranchClick(di)
            })
        }
      }
    }

    const modBaselineJoin = gZoom
      .selectAll<SVGCircleElement, LayoutNode>('circle.mod-baseline')
      .data(
        next.nodes.filter(
          (n) => n.kind === 'modality' && nodeInZoomDay(n, zDay),
        ),
        modalityStableKey,
      )

    const modBaselineEnter = modBaselineJoin
      .enter()
      .append('circle')
      .attr('class', 'mod-baseline')
      .attr('r', baselineR)
      .attr('fill', 'none')
      .attr('pointer-events', 'none')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2.5 3.5')
      .attr('stroke-linecap', 'round')
      .each(function (d) {
        const p = prevById.get(d.id)
        const el = d3.select(this)
        el
          .attr('cx', p?.x ?? d.x)
          .attr('cy', p?.y ?? d.y)
          .attr('stroke', d.color!)
      })
      /** Day-isolated: hidden; must be 0 before transition or new nodes flash visible for one frame. */
      .style('opacity', (d) =>
        dayIsolated
          ? 0
          : opacityForNode(d) * NODE_OPACITY * 0.88 * zoomBranchMul(d),
      )

    modBaselineEnter
      .merge(modBaselineJoin)
      .attr('stroke', (d) => d.color!)
      .style('opacity', (d) =>
        dayIsolated
          ? 0
          : opacityForNode(d) * NODE_OPACITY * 0.88 * zoomBranchMul(d),
      )
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .style('opacity', (d) =>
        dayIsolated
          ? 0
          : opacityForNode(d) * NODE_OPACITY * 0.88 * zoomBranchMul(d),
      )

    modBaselineJoin.exit().remove()

    const rootJoin = gZoom
      .selectAll<SVGCircleElement, LayoutNode>('circle.root')
      .data(
        dayIsolated ? [] : next.nodes.filter((n) => n.kind === 'root'),
        (d) => d.id,
      )

    const rootEnter = rootJoin
      .enter()
      .append('circle')
      .attr('class', 'root')
      .attr('fill', '#EDE8E0')
      .attr('stroke', STROKE_COLOR)
      .attr('stroke-width', 0.9)
      .attr('stroke-opacity', 0.45)
      .each(function (d) {
        const p = prevById.get(d.id)
        const el = d3.select(this)
        el.attr('cx', p?.x ?? d.x).attr('cy', p?.y ?? d.y).attr('r', p?.r ?? d.r)
      })

    rootEnter
      .merge(rootJoin)
      .attr('fill', '#EDE8E0')
      .attr('stroke', STROKE_COLOR)
      .attr('stroke-width', 0.9)
      .attr('stroke-opacity', 0.45)
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r)
      .style('opacity', (d) => nodeOp(d))

    const primJoin = gZoom
      .selectAll<SVGCircleElement, LayoutNode>('circle.primary')
      .data(
        next.nodes.filter(
          (n) => n.kind === 'primary' && nodeInZoomDay(n, zDay),
        ),
        (d) => d.id,
      )

    const primEnter = primJoin
      .enter()
      .append('circle')
      .attr('class', 'primary')
      .attr('fill', '#3d3428')
      .each(function (d) {
        const p = prevById.get(d.id)
        const el = d3.select(this)
        el.attr('cx', p?.x ?? d.x).attr('cy', p?.y ?? d.y).attr('r', p?.r ?? d.r)
      })
      /** Day-isolated: primaries are hidden; avoid one-frame flash on weekday change. */
      .style('opacity', (d) => (dayIsolated ? 0 : nodeOp(d)))

    const primMerged = primEnter.merge(primJoin)

    primMerged
      .style('opacity', (d) => (dayIsolated ? 0 : nodeOp(d)))
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r)
      .style('opacity', (d) => (dayIsolated ? 0 : nodeOp(d)))

    primMerged
      .on('click', (ev, d) => {
        ev.stopPropagation()
        if (level === 1 && onDayBranchClick) onDayBranchClick(d.dayIndex ?? 0)
      })
      .style('cursor', level === 1 && onDayBranchClick ? 'pointer' : 'default')

    /**
     * Level 2: make every modality glyph visibly larger (all days), even for very small deviations.
     * Using both scale and minimum additive bump avoids some points looking unchanged.
     */
    const l1Extent = (d: LayoutNode) => {
      const base = l1ShapeExtent(d, dayIsolated)
      if (level !== 2) return base
      return Math.max(base * 1.2, base + 1.1)
    }
    const l1SquareSide = (d: LayoutNode) => l1Extent(d) * 2
    const l1TriangleSide = (d: LayoutNode) => l1Extent(d) * 2
    const l1CircleR = (d: LayoutNode) => l1Extent(d)

    const applyModShape = (
      wrap: d3.Selection<SVGGElement, LayoutNode, null, undefined>,
      d: LayoutNode,
    ) => {
      const fill = d.color!
      if (level === 3) {
        wrap.selectAll('rect.mod').remove()
        wrap.selectAll('polygon.mod').remove()
        let cir = wrap.select<SVGCircleElement>('circle.mod')
        if (cir.empty()) {
          cir = wrap.append('circle').attr('class', 'mod')
        }
        cir.attr('cx', 0).attr('cy', 0).attr('r', l1CircleR(d)).attr('fill', fill).attr('stroke', 'none')
        return
      }
      if (d.band === 'within') {
        wrap.selectAll('circle.mod').remove()
        wrap.selectAll('polygon.mod').remove()
        let rect = wrap.select<SVGRectElement>('rect.mod')
        if (rect.empty()) {
          rect = wrap.append('rect').attr('class', 'mod')
        }
        const s = l1SquareSide(d)
        rect
          .attr('x', -s / 2)
          .attr('y', -s / 2)
          .attr('width', s)
          .attr('height', s)
          .attr('rx', 1.2)
          .attr('ry', 1.2)
          .attr('fill', fill)
          .attr('stroke', 'none')
        return
      }
      if (d.band === 'above') {
        wrap.selectAll('rect.mod').remove()
        wrap.selectAll('circle.mod').remove()
        let poly = wrap.select<SVGPolygonElement>('polygon.mod')
        if (poly.empty()) {
          poly = wrap.append('polygon').attr('class', 'mod')
        }
        const side = l1TriangleSide(d)
        const ang = level === 1 ? l1ModalityRootOutwardAngleDeg(d, nodeById) : 0
        poly
          .attr('points', l1EquilateralTrianglePoints(side))
          .attr('fill', fill)
          .attr('stroke', 'none')
          .attr('transform', `rotate(${ang})`)
        return
      }
      wrap.selectAll('rect.mod').remove()
      wrap.selectAll('polygon.mod').remove()
      let cir = wrap.select<SVGCircleElement>('circle.mod')
      if (cir.empty()) {
        cir = wrap.append('circle').attr('class', 'mod')
      }
      cir.attr('cx', 0).attr('cy', 0).attr('r', l1CircleR(d)).attr('fill', fill).attr('stroke', 'none')
    }

    const modJoin = gZoom
      .selectAll<SVGGElement, LayoutNode>('g.mod-wrap')
      .data(
        next.nodes.filter(
          (n) => n.kind === 'modality' && nodeInZoomDay(n, zDay),
        ),
        modalityStableKey,
      )

    const modEnter = modJoin.enter().append('g').attr('class', 'mod-wrap').each(function (d) {
      const p = prevById.get(d.id)
      const px = dayModPos.get(d.id)?.x ?? p?.x ?? d.x
      const py = dayModPos.get(d.id)?.y ?? p?.y ?? d.y
      d3.select(this).attr('transform', `translate(${px},${py})`)
    })
    modEnter.style('opacity', (d) => modOp(d))

    const modMerged = modEnter.merge(modJoin)

    modMerged.each(function (d) {
      applyModShape(d3.select<SVGGElement, LayoutNode>(this), d)
    })

    const setModBaselineDotHover = (nodeId: string, hovered: boolean) => {
      const r = baselineR * (hovered ? 1.14 : 1)
      gZoom.selectAll<SVGCircleElement, LayoutNode>('circle.mod-baseline')
        .filter((bd) => bd.id === nodeId)
        .interrupt()
        .attr('r', r)
    }

    modMerged
      .on('mouseenter', function (ev, d) {
        const wrap = d3.select<SVGGElement, LayoutNode>(this)
        if (level === 1 && onDayBranchClick) {
          wrap.interrupt()
          if (d.band === 'within') {
            const s = l1SquareSide(d) * 1.08
            wrap
              .select('rect.mod')
              .attr('x', -s / 2)
              .attr('y', -s / 2)
              .attr('width', s)
              .attr('height', s)
              .attr('stroke', STROKE_COLOR)
              .attr('stroke-width', 1.25)
              .attr('stroke-opacity', STROKE_OPACITY)
          } else if (d.band === 'above') {
            const side = l1TriangleSide(d) * 1.08
            wrap
              .select('polygon.mod')
              .attr('points', l1EquilateralTrianglePoints(side))
              .attr('stroke', STROKE_COLOR)
              .attr('stroke-width', 1.25)
              .attr('stroke-opacity', STROKE_OPACITY)
          } else {
            wrap
              .select('circle.mod')
              .attr('r', l1CircleR(d) * 1.14)
              .attr('stroke', STROKE_COLOR)
              .attr('stroke-width', 1.25)
              .attr('stroke-opacity', STROKE_OPACITY)
          }
          setModBaselineDotHover(d.id, true)
          onModalityHover({
            modality: d.modality!,
            band: d.band!,
            x: ev.clientX,
            y: ev.clientY,
          })
        }
        if (level === 2) {
          setModBaselineDotHover(d.id, true)
          onModalityHover({
            modality: d.modality!,
            band: d.band!,
            x: ev.clientX,
            y: ev.clientY,
          })
        }
      })
      .on('mousemove', (ev, d) => {
        if (level === 1 && onDayBranchClick) {
          onModalityHover({
            modality: d.modality!,
            band: d.band!,
            x: ev.clientX,
            y: ev.clientY,
          })
        }
        if (level === 2) {
          onModalityHover({
            modality: d.modality!,
            band: d.band!,
            x: ev.clientX,
            y: ev.clientY,
          })
        }
      })
      .on('mouseleave', function (_ev, d) {
        const wrap = d3.select<SVGGElement, LayoutNode>(this)
        if (level === 1 && onDayBranchClick) {
          applyModShape(wrap, d)
          setModBaselineDotHover(d.id, false)
          onModalityHover(null)
        }
        if (level === 2) {
          setModBaselineDotHover(d.id, false)
          onModalityHover(null)
        }
      })
      .on('click', (ev, d) => {
        ev.stopPropagation()
        if (level === 1 && onDayBranchClick) {
          onDayBranchClick(d.dayIndex ?? 0)
          return
        }
        if (level === 2) onModalityClick(d.dayIndex!, d.modality!)
      })
      .style(
        'cursor',
        (level === 1 && onDayBranchClick) || level === 2 ? 'pointer' : 'default',
      )
      .classed('pulse', (d) => level === 3 && d.id === selectedNodeId)

    modMerged
      .interrupt()
      .style('opacity', (d) => modOp(d))
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attrTween('transform', function (d) {
        const x1 = dayModPos.get(d.id)?.x ?? d.x
        const y1 = dayModPos.get(d.id)?.y ?? d.y
        const cur = parseSvgTranslate(d3.select(this).attr('transform'))
        const x0 = cur?.x ?? x1
        const y0 = cur?.y ?? y1
        const ix = d3.interpolateNumber(x0, x1)
        const iy = d3.interpolateNumber(y0, y1)
        return (t: number) => `translate(${ix(t)},${iy(t)})`
      })
      .style('opacity', (d) => modOp(d))

    modMerged.each(function (d) {
      const wrap = d3.select<SVGGElement, LayoutNode>(this)
      const t = d3.transition().duration(650).ease(d3.easeCubicInOut)
      if ((level === 1 || level === 2) && d.band === 'within') {
        const rect = wrap.select('rect.mod')
        if (!rect.empty()) {
          const s = l1SquareSide(d)
          rect
            .transition(t)
            .attr('x', -s / 2)
            .attr('y', -s / 2)
            .attr('width', s)
            .attr('height', s)
        }
      } else if ((level === 1 || level === 2) && d.band === 'above') {
        const poly = wrap.select('polygon.mod')
        if (!poly.empty()) {
          const side = l1TriangleSide(d)
          const ang = level === 1 ? l1ModalityRootOutwardAngleDeg(d, nodeById) : 0
          poly
            .transition(t)
            .attr('points', l1EquilateralTrianglePoints(side))
            .attr('transform', `rotate(${ang})`)
        }
      } else {
        const cir = wrap.select('circle.mod')
        if (!cir.empty()) {
          cir.transition(t).attr('r', l1CircleR(d))
        }
      }
    })

    modJoin.exit().remove()
    primJoin.exit().remove()

    const modCaptionData: LayoutNode[] = []

    const baseTitlePx = Math.max(7, Math.min(12, plotMin * 0.0135 * vs))
    const baseBandPx = Math.max(6.5, Math.min(11, plotMin * 0.012 * vs))
    const estimateWidth = (text: string, px: number) =>
      Math.max(28, text.length * px * 0.56 + 6)

    type CaptionPlaced = {
      id: string
      x: number
      y: number
      anchor: 'start' | 'end'
      x0: number
      x1: number
      y0: number
      y1: number
    }
    const captionPlacement = new Map<string, { x: number; y: number }>()
    const captionAnchor = new Map<string, 'start' | 'end'>()

    let capTitlePx = baseTitlePx
    let capBandPx = baseBandPx
    const scales = [1, 0.92, 0.86, 0.8, 0.74]
    const angleDegs = [180, 160, 200, 140, 220, 120, 240, 100, 260, 80, 280, 60, 300, 30, 330, 0]

    for (const s of scales) {
      const titlePx = baseTitlePx * s
      const bandPx = baseBandPx * s
      const placed: CaptionPlaced[] = []
      captionPlacement.clear()
      captionAnchor.clear()

      const labels = [...modCaptionData].sort((a, b) => a.y - b.y)

      for (const d of labels) {
        const title = d.modality ?? ''
        const band = bandBaselineLabel(d.band ?? 'within')
        const w = Math.max(estimateWidth(title, titlePx), estimateWidth(band, bandPx))
        const hTop = titlePx + 4
        const hBottom = bandPx + 4
        const orbitR = d.r + 8
        let best: CaptionPlaced | null = null
        let bestScore = Number.POSITIVE_INFINITY

        for (const deg of angleDegs) {
          const rad = (deg * Math.PI) / 180
          const x = d.x + Math.cos(rad) * orbitR
          const y = d.y + Math.sin(rad) * orbitR
          const anchor: 'start' | 'end' = Math.cos(rad) >= 0 ? 'start' : 'end'
          const x0 = anchor === 'start' ? x : x - w
          const x1 = anchor === 'start' ? x + w : x
          const y0 = y - hTop
          const y1 = y + hBottom
          const out =
            x0 < zone.x + 2 ||
            x1 > zone.x + zone.w - 2 ||
            y0 < zone.y + 2 ||
            y1 > zone.y + zone.h - 2

          let overlapArea = 0
          for (const p of placed) {
            const ix = Math.max(0, Math.min(x1, p.x1) - Math.max(x0, p.x0))
            const iy = Math.max(0, Math.min(y1, p.y1) - Math.max(y0, p.y0))
            overlapArea += ix * iy
          }

          if (!out && overlapArea === 0) {
            best = { id: d.id, x, y, anchor, x0, x1, y0, y1 }
            break
          }

          const score = overlapArea + (out ? 1_000_000 : 0) + Math.abs(deg - 180) * 0.2
          if (score < bestScore) {
            bestScore = score
            best = { id: d.id, x, y, anchor, x0, x1, y0, y1 }
          }
        }

        if (best) {
          placed.push(best)
          captionPlacement.set(best.id, { x: best.x, y: best.y })
          captionAnchor.set(best.id, best.anchor)
        }
      }

      capTitlePx = titlePx
      capBandPx = bandPx

      let hasOverlap = false
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!
          const b = placed[j]!
          if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) {
            hasOverlap = true
            break
          }
        }
        if (hasOverlap) break
      }
      if (!hasOverlap) break
    }

    const modCaptionJoin = gZoom
      .selectAll<SVGGElement, LayoutNode>('g.mod-caption')
      .data(modCaptionData, (d) => d.id)

    const modCaptionEnter = modCaptionJoin
      .enter()
      .append('g')
      .attr('class', 'mod-caption')
      .style('pointer-events', 'none')
      .attr('transform', (d) => {
        const start = captionPlacement.get(d.id)
        if (start) return `translate(${start.x},${start.y})`
        const a = modCaptionAnchorLeft(d)
        return `translate(${a.x},${a.y})`
      })
      .style('opacity', (d) => modOp(d))

    modCaptionEnter
      .append('text')
      .attr('class', 'mod-caption-title')
      .attr('text-anchor', (d) => captionAnchor.get(d.id) ?? 'end')
      .attr('x', 0)
      .attr('y', -3)

    modCaptionEnter
      .append('text')
      .attr('class', 'mod-caption-band')
      .attr('text-anchor', (d) => captionAnchor.get(d.id) ?? 'end')
      .attr('x', 0)
      .attr('y', 5)

    const modCaptionMerged = modCaptionEnter.merge(modCaptionJoin)

    modCaptionMerged
      .select('text.mod-caption-title')
      .attr('text-anchor', (d) => captionAnchor.get(d.id) ?? 'end')
      .style('font-family', 'Georgia, "Times New Roman", serif')
      .style('font-weight', 600)
      .style('font-size', `${capTitlePx}px`)
      .attr('fill', (d) => MODALITY_COLORS[d.modality!])
      .text((d) => d.modality ?? '')

    modCaptionMerged
      .select('text.mod-caption-band')
      .attr('text-anchor', (d) => captionAnchor.get(d.id) ?? 'end')
      .style('font-family', 'system-ui, -apple-system, sans-serif')
      .style('font-weight', 500)
      .style('font-size', `${capBandPx}px`)
      .attr('fill', '#6e655a')
      .text((d) => bandBaselineLabel(d.band ?? 'within'))

    modCaptionMerged
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('transform', (d) => {
        const planned = captionPlacement.get(d.id)
        const a = planned ?? modCaptionAnchorLeft(d)
        return `translate(${a.x},${a.y})`
      })
      .style('opacity', (d) => modOp(d))

    modCaptionJoin.exit().remove()

    const modAxisData: LayoutNode[] = dayModalities

    const wrapTextToWidth = (
      text: string,
      maxWidthPx: number,
      fontPx: number,
      measurePadPx = 6,
    ): string[] => {
      const measureLine = (t: string) =>
        Math.max(12, t.length * fontPx * 0.56 + measurePadPx)
      const words = text.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) return []
      const lines: string[] = []
      let line = words[0]!
      for (let i = 1; i < words.length; i++) {
        const next = `${line} ${words[i]}`
        if (measureLine(next) <= maxWidthPx) {
          line = next
        } else {
          lines.push(line)
          line = words[i]!
        }
      }
      lines.push(line)
      return lines
    }

    const noteLinesById = new Map<string, string[]>()
    const axisPositions = modAxisData
      .map((d) => ({ d, x: axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x }))
      .sort((a, b) => a.x - b.x)
    for (let i = 0; i < axisPositions.length; i++) {
      const item = axisPositions[i]!
      const leftGap = i > 0 ? item.x - axisPositions[i - 1]!.x : Number.POSITIVE_INFINITY
      const rightGap =
        i < axisPositions.length - 1
          ? axisPositions[i + 1]!.x - item.x
          : Number.POSITIVE_INFINITY
      const localGap = Math.min(leftGap, rightGap)
      const noteWidth = dayIsolated
        ? DAY_DESC_MAX_W_PX
        : Number.isFinite(localGap)
          ? Math.max(84, Math.min(170, localGap * 0.88))
          : 170
      const sig = bandSignificanceLines(item.d.modality!, item.d.band ?? 'within')
      noteLinesById.set(
        item.d.id,
        wrapTextToWidth(
          `${sig.line1} ${sig.line2}`,
          noteWidth,
          axisNotePx,
          dayIsolated ? DAY_DESC_WRAP_MEASURE_PAD_PX : 6,
        ),
      )
    }

    const modGuideData = dayIsolated
      ? modAxisData.filter((d) => d.band !== 'within')
      : modAxisData

    const modGuideJoin = gZoom
      .selectAll<SVGLineElement, LayoutNode>('line.mod-axis-guide')
      .data(modGuideData, modalityStableKey)

    const modGuideEnter = modGuideJoin
      .enter()
      .append('line')
      .attr('class', 'mod-axis-guide')
      .attr('stroke', STROKE_COLOR)
      .attr('stroke-width', 0.8)
      .attr('stroke-dasharray', '2.2 3.4')
      .attr('stroke-opacity', 0.28)
      .attr('x1', (d) => dayModPos.get(d.id)?.x ?? d.x)
      .attr('x2', (d) => dayModPos.get(d.id)?.x ?? d.x)
      .attr('y1', (d) =>
        dayIsolated ? (dayModPos.get(d.id)?.y ?? d.y) : axisY,
      )
      .attr('y2', () => (dayIsolated ? baselineY : axisY))

    modGuideEnter
      .merge(modGuideJoin)
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x1', (d) => dayModPos.get(d.id)?.x ?? d.x)
      .attr('x2', (d) => dayModPos.get(d.id)?.x ?? d.x)
      .attr('y1', (d) =>
        dayIsolated ? (dayModPos.get(d.id)?.y ?? d.y) : axisY,
      )
      .attr('y2', (d) =>
        dayIsolated
          ? baselineY
          : (dayModPos.get(d.id)?.y ?? d.y) + d.r + 1,
      )
      .style('opacity', (d) => (dayIsolated ? modOp(d) : 0))

    modGuideJoin.exit().remove()

    const axisBaselineJoin = gZoom
      .selectAll<SVGLineElement, number>('line.mod-axis-baseline')
      .data(dayIsolated ? [0] : [])

    const axisBaselineEnter = axisBaselineJoin
      .enter()
      .append('line')
      .attr('class', 'mod-axis-baseline')
      .attr('stroke', STROKE_COLOR)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.3)
      .attr('x1', baselineX1)
      .attr('x2', baselineX2)
      .attr('y1', baselineY)
      .attr('y2', baselineY)

    axisBaselineEnter
      .merge(axisBaselineJoin)
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x1', baselineX1)
      .attr('x2', baselineX2)
      .attr('y1', baselineY)
      .attr('y2', baselineY)

    axisBaselineJoin.exit().remove()

    const modAxisLabelJoin = gAxis
      .selectAll<SVGTextElement, LayoutNode>('text.mod-axis-label')
      .data(modAxisData, modalityStableKey)

    const modAxisLabelEnter = modAxisLabelJoin
      .enter()
      .append('text')
      .attr('class', 'mod-axis-label')
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisTitleY)

    modAxisLabelEnter
      .merge(modAxisLabelJoin)
      .style('font-family', 'Georgia, "Times New Roman", serif')
      .style('font-size', `${axisTitlePx}px`)
      .attr('fill', (d) => MODALITY_COLORS[d.modality!])
      .text((d) => d.modality ?? '')
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisTitleY)
      .style('opacity', (d) => (dayIsolated ? modOp(d) : 0))

    modAxisLabelJoin.exit().remove()

    const modAxisBandJoin = gAxis
      .selectAll<SVGTextElement, LayoutNode>('text.mod-axis-band')
      .data(modAxisData, modalityStableKey)

    const modAxisBandEnter = modAxisBandJoin
      .enter()
      .append('text')
      .attr('class', 'mod-axis-band')
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisBandY)

    modAxisBandEnter
      .merge(modAxisBandJoin)
      .style('font-family', 'system-ui, -apple-system, sans-serif')
      .style('font-size', `${axisBandPx}px`)
      .style('font-weight', 700)
      .style('letter-spacing', '0.04em')
      .attr('fill', '#7b7166')
      .text((d) => bandBaselineLabel(d.band ?? 'within'))
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisBandY)
      .style('opacity', (d) => (dayIsolated ? modOp(d) : 0))

    modAxisBandJoin.exit().remove()

    const modAxisNoteJoin = gAxis
      .selectAll<SVGTextElement, LayoutNode>('text.mod-axis-note')
      .data(modAxisData, modalityStableKey)

    const modAxisNoteEnter = modAxisNoteJoin
      .enter()
      .append('text')
      .attr('class', 'mod-axis-note')
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisNote1Y)

    modAxisNoteEnter
      .merge(modAxisNoteJoin)
      .style('font-family', 'system-ui, -apple-system, sans-serif')
      .style('font-size', `${axisNotePx}px`)
      .attr('fill', '#8c8070')
      .each(function (d) {
        const x = axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x
        const lines = noteLinesById.get(d.id) ?? []
        const t = d3.select(this)
        const tspans = t.selectAll<SVGTSpanElement, string>('tspan').data(lines)
        tspans
          .enter()
          .append('tspan')
          .merge(tspans)
          .attr('x', x)
          .attr('dy', (_line, i) => (i === 0 ? 0 : axisNotePx + 4))
          .text((line) => line)
        tspans.exit().remove()
      })
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x', (d) => axisLabelX.get(d.id) ?? dayModPos.get(d.id)?.x ?? d.x)
      .attr('y', axisNote1Y)
      .style('opacity', (d) => (dayIsolated ? modOp(d) : 0))

    modAxisNoteJoin.exit().remove()

    const rootLabel = next.nodes.filter((n) => n.kind === 'root')
    const initialsJoin = gZoom
      .selectAll<SVGTextElement, LayoutNode>('text.initials')
      .data(dayIsolated ? [] : rootLabel, (d) => d.id)

    const initialsEnter = initialsJoin
      .enter()
      .append('text')
      .attr('class', 'initials')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#2C2416')
      .style('font-family', 'Georgia, "Times New Roman", serif')
      .style('font-weight', 500)
      .style('pointer-events', 'none')
      .each(function (d) {
        const p = prevById.get(d.id)
        const el = d3.select(this)
        el.attr('x', p?.x ?? d.x).attr('y', p?.y ?? d.y)
      })

    initialsEnter
      .merge(initialsJoin)
      .attr('fill', '#2C2416')
      .style('font-size', `${initialsPx}px`)
      .text(person.initials)
      .transition()
      .duration(650)
      .ease(d3.easeCubicInOut)
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .style('opacity', (d) => nodeOp(d))

    initialsJoin.exit().remove()

    if (showDayLabels && !dayIsolated) {
      const dayNames = compactDayLabels ? DAY_LABELS_COMPACT : DAY_LABELS
      const rootNode = nodeLookup.get('root')
      const primaries = next.nodes.filter(
        (n) =>
          n.kind === 'primary' && nodeInZoomDay(n, zDay),
      )
      const labelJoin = gZoom
        .selectAll<SVGTextElement, LayoutNode>('text.daylabel')
        .data(primaries, (d) => d.id)

      const modalitiesForDay = (layout: NetworkLayout | undefined, day: number) =>
        layout?.nodes.filter((n) => n.kind === 'modality' && n.dayIndex === day) ?? []

      const labelEnter = labelJoin
        .enter()
        .append('text')
        .attr('class', 'daylabel')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .style('pointer-events', 'none')
        .style('opacity', 1)
        .each(function (d) {
          const el = d3.select(this)
          const day = d.dayIndex ?? 0
          const pr = prevById.get('root')
          const pp = prevById.get(d.id)
          if (pr && pp && prevLayout) {
            const pos = dayLabelAnchor(
              pp,
              pr,
              modalitiesForDay(prevLayout, day),
              day,
            )
            el.attr('x', pos.x).attr('y', pos.y)
          } else if (rootNode) {
            const pos = dayLabelAnchor(
              d,
              rootNode,
              modalitiesForDay(next, day),
              day,
            )
            el.attr('x', pos.x).attr('y', pos.y)
          } else {
            el.attr('x', d.x).attr('y', d.y)
          }
        })

      labelEnter
        .merge(labelJoin)
        .attr('fill', '#8C8070')
        .style('font-family', 'Georgia, "Times New Roman", serif')
        .style('font-style', compactDayLabels ? 'normal' : 'italic')
        .style('font-weight', compactDayLabels ? 500 : 400)
        .style('font-size', `${dayLabPx}px`)
        .text((d) => dayNames[d.dayIndex ?? 0])
        .transition()
        .duration(650)
        .ease(d3.easeCubicInOut)
        .attr('x', (d) => {
          if (!rootNode) return d.x
          return dayLabelAnchor(
            d,
            rootNode,
            modalitiesForDay(next, d.dayIndex ?? 0),
            d.dayIndex ?? 0,
          ).x
        })
        .attr('y', (d) => {
          if (!rootNode) return d.y
          return dayLabelAnchor(
            d,
            rootNode,
            modalitiesForDay(next, d.dayIndex ?? 0),
            d.dayIndex ?? 0,
          ).y
        })
        .style('font-size', `${dayLabPx}px`)
        .style(
          'opacity',
          (d) =>
            dayIsolated ? 1 : zoomLabelMul(d.dayIndex ?? 0),
        )

      labelJoin.exit().remove()
    }

    const gNode = d3.select(gZoomRef.current)

    if (dayIsolated) {
      gNode.interrupt()
      lastZoomParamsRef.current = null
      lastZoomDayRef.current = null
      exitZoomInFlightRef.current = false
      gNode.attr('transform', null)
    } else if (zoomDayIndex !== null) {
      gNode.interrupt()
      exitZoomInFlightRef.current = false
      const payload = dayZoomTransform(zone, next, zoomDayIndex)
      if (payload) {
        lastZoomParamsRef.current = payload
        lastZoomDayRef.current = zoomDayIndex
        gNode
          .transition()
          .duration(650)
          .ease(d3.easeCubicInOut)
          .attr('transform', payload.transform)
      }
    } else if (lastZoomParamsRef.current && !exitZoomInFlightRef.current) {
      const { zx, zy, s, cx, cy } = lastZoomParamsRef.current
      exitZoomInFlightRef.current = true
      gNode
        .transition()
        .duration(650)
        .ease(d3.easeCubicInOut)
        .attrTween('transform', () => (t: number) =>
          zoomTransformAtProgress(zx, zy, s, cx, cy, t),
        )
        .on('end', () => {
          lastZoomParamsRef.current = null
          lastZoomDayRef.current = null
          exitZoomInFlightRef.current = false
          gNode.attr('transform', null)
          setZoomAnimTick((x) => x + 1)
        })
    } else if (!lastZoomParamsRef.current && !exitZoomInFlightRef.current) {
      gNode.attr('transform', null)
    }

    lastLayoutByWeek.current[lastFrameKey] = next
  }, [
    week,
    zone,
    person,
    weekIndex,
    level,
    lineHighlight,
    dimNetwork,
    selectedNodeId,
    showDayLabels,
    compactDayLabels,
    svgId,
    zoomDayIndex,
    onDayBranchClick,
    onZoneClick,
    onModalityClick,
    onModalityHover,
    zoomAnimTick,
  ])

  return (
    <g>
      <g clipPath={`url(#clip-${svgId})`} filter={`url(#glow-${person.id})`}>
        <g ref={gZoomRef} id={svgId} />
        <g ref={gAxisRef} />
      </g>
    </g>
  )
}
