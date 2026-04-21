import {
  MODALITIES,
  MODALITY_COLORS,
  NETWORK_VISUAL_SCALE,
  ZONE_INSET_PX,
  type ModalityId,
} from '../constants'
import type { DayData, ModalityReading, WeekData } from './types'

export interface ZoneRect {
  x: number
  y: number
  w: number
  h: number
}

export type NodeKind = 'root' | 'primary' | 'modality'

export interface LayoutNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  r: number
  color?: string
  dayIndex?: number
  modality?: ModalityId
  band?: import('./types').DeviationBand
  deviationMagnitude?: number
}

export interface LayoutLink {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface NetworkLayout {
  root: { x: number; y: number }
  nodes: LayoutNode[]
  links: LayoutLink[]
}

function clampToZone(
  x: number,
  y: number,
  zone: ZoneRect,
  inset: number,
): { x: number; y: number } {
  const minX = zone.x + inset
  const maxX = zone.x + zone.w - inset
  const minY = zone.y + inset
  const maxY = zone.y + zone.h - inset
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  }
}

function weekActivation(week: WeekData): number {
  let s = 0
  let n = 0
  for (const day of week.days) {
    for (const m of MODALITIES) {
      s += day.modalities[m].deviationMagnitude
      n++
    }
  }
  return n ? s / n : 0.2
}

/** 0 = fully baseline day; 1 = high composite activation across modalities. */
function dayCompositeActivation(day: DayData): number {
  let score = 0
  for (const m of MODALITIES) {
    const r = day.modalities[m]
    score += r.deviationMagnitude
    if (r.band !== 'within') score += 0.22
  }
  return Math.min(1, score / 3.2)
}

const PRIMARY_ARM_MIN_PX = 60
const PRIMARY_ARM_MAX_PX = 180

/** Distance root center → day primary center along the day ray (meaningful encoding). */
function primaryArmLengthPx(day: DayData): number {
  const t = dayCompositeActivation(day)
  return (
    (PRIMARY_ARM_MIN_PX + t * (PRIMARY_ARM_MAX_PX - PRIMARY_ARM_MIN_PX)) *
    NETWORK_VISUAL_SCALE
  )
}

/** Distance day primary → modality center along the fan ray; band + magnitude (meaningful encoding). */
export function secondaryArmLengthPx(reading: ModalityReading): number {
  const t = Math.min(1, Math.max(0, reading.deviationMagnitude))
  const s = NETWORK_VISUAL_SCALE
  if (reading.band === 'within') return 45 * s
  if (reading.band === 'below') return (20 + t * 23) * s
  return (46 + t * 34) * s
}

/** Characteristic radius (half of 6–14px diameter) from deviation magnitude. */
function modalityShapeRadiusPx(magnitude: number): number {
  const t = Math.min(1, Math.max(0, magnitude / 0.35))
  return ((6 + t * 8) / 2) * NETWORK_VISUAL_SCALE
}

/** Organic quadratic Bézier — slightly flatter controls so arcs stay inside narrow wedges. */
export function linkPath(x0: number, y0: number, x1: number, y1: number): string {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const curve = Math.min(18, len * 0.16)
  const px = (-dy / len) * curve
  const py = (dx / len) * curve
  const bend = 0.22
  const c1x = x0 + dx * 0.38 + px * bend
  const c1y = y0 + dy * 0.38 + py * bend
  const c2x = x0 + dx * 0.62 + px * bend
  const c2y = y0 + dy * 0.62 + py * bend
  return `M${x0},${y0} C${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`
}

/** Clamp direction to wedge around `center` (shortest arc, handles ±π wrap). */
function clampAngleToWedge(phi: number, center: number, halfWidth: number): number {
  let d = phi - center
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  const c = Math.max(-halfWidth, Math.min(halfWidth, d))
  return center + c
}

/** Keep point in angular wedge from root; preserves radius from root. */
function clampPointToWedge(
  x: number,
  y: number,
  root: { x: number; y: number },
  centerAngle: number,
  halfWidth: number,
): { x: number; y: number } {
  const dx = x - root.x
  const dy = y - root.y
  const r = Math.hypot(dx, dy)
  if (r < 1e-6) return { x: root.x, y: root.y }
  const phi = Math.atan2(dy, dx)
  const a = clampAngleToWedge(phi, centerAngle, halfWidth)
  return {
    x: root.x + Math.cos(a) * r,
    y: root.y + Math.sin(a) * r,
  }
}

/** Radius for deviation magnitude 0 — dotted baseline marker matches this “on baseline” size. */
export function modalityBaselineMarkerRadius(): number {
  return modalityShapeRadiusPx(0)
}

/**
 * Unit direction from day primary toward a modality — same blend as the original layout
 * (along the day spoke + strong perpendicular fan), so arms spread wide instead of packing in-angle only.
 * Arm length is applied separately via secondaryArmLengthPx.
 */
function secondaryFanUnitDirection(
  theta: number,
  mi: number,
  minDim: number,
  spread: number,
): { x: number; y: number } {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const pxn = -s
  const pyn = c
  /** Same lateral index as original layout (`(mi - 3) / 3`). */
  const u = (mi - 3) / 3
  const along =
    minDim * (0.034 + 0.046 * spread) + (mi - 3) * minDim * 0.02
  const perpMag = minDim * (0.11 + 0.06 * spread) * u * 0.92
  const rx = along * c + pxn * perpMag
  const ry = along * s + pyn * perpMag
  const h = Math.hypot(rx, ry) || 1
  return { x: rx / h, y: ry / h }
}

/**
 * Place root→primary and primary→modality positions from semantic arm lengths (px).
 * Call after building nodes/links and again after overlap resolution so distances stay meaningful.
 */
function placeSemanticArms(
  layout: NetworkLayout,
  week: WeekData,
  thetas: readonly number[],
  zone: ZoneRect,
  inset: number,
  sectorHalf: number,
): void {
  const m = new Map(layout.nodes.map((n) => [n.id, n]))
  const rootNode = m.get('root')
  if (!rootNode) return

  const minDim = Math.min(zone.w, zone.h)
  const act = weekActivation(week)
  const spread = 0.35 + 0.65 * Math.min(1, act * 2.2)

  for (let d = 0; d < 7; d++) {
    const day = week.days[d]
    const theta = thetas[d]!
    const armLen = primaryArmLengthPx(day)
    const c = Math.cos(theta)
    const s = Math.sin(theta)

    let px = rootNode.x + c * armLen
    let py = rootNode.y + s * armLen
    ;({ x: px, y: py } = clampToZone(px, py, zone, inset))
    ;({ x: px, y: py } = clampPointToWedge(px, py, rootNode, theta, sectorHalf))
    ;({ x: px, y: py } = clampToZone(px, py, zone, inset))

    const primary = m.get(`p-${d}`)
    if (!primary) continue
    primary.x = px
    primary.y = py

    for (let mi = 0; mi < MODALITIES.length; mi++) {
      const modality = MODALITIES[mi]!
      const reading = day.modalities[modality]
      const secLen = secondaryArmLengthPx(reading)
      const dir = secondaryFanUnitDirection(theta, mi, minDim, spread)

      const leaf = m.get(`m-${d}-${mi}`)
      if (!leaf) continue
      let sx = px + dir.x * secLen
      let sy = py + dir.y * secLen
      ;({ x: sx, y: sy } = clampPointToWedge(sx, sy, rootNode, theta, sectorHalf))
      ;({ x: sx, y: sy } = clampToZone(sx, sy, zone, inset))
      leaf.x = sx
      leaf.y = sy
    }
  }
  syncLinksToNodes(layout)
}

/** Primary stays on its day ray (from root); min t avoids sitting on the root dot. */
function projectPrimaryNode(
  n: LayoutNode,
  root: LayoutNode,
  theta: number,
  zone: ZoneRect,
  inset: number,
  sectorHalf: number,
): void {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  let t = (n.x - root.x) * c + (n.y - root.y) * s
  const tMin = root.r + n.r + 6
  if (t < tMin) t = tMin
  n.x = root.x + c * t
  n.y = root.y + s * t
  let p = clampToZone(n.x, n.y, zone, inset)
  n.x = p.x
  n.y = p.y
  p = clampPointToWedge(n.x, n.y, root, theta, sectorHalf)
  n.x = p.x
  n.y = p.y
  p = clampToZone(n.x, n.y, zone, inset)
  n.x = p.x
  n.y = p.y
}

function constrainModalityNode(
  n: LayoutNode,
  root: LayoutNode,
  theta: number,
  sectorHalf: number,
  zone: ZoneRect,
  inset: number,
): void {
  let p = clampPointToWedge(n.x, n.y, root, theta, sectorHalf)
  p = clampToZone(p.x, p.y, zone, inset)
  n.x = p.x
  n.y = p.y
}

function separatePair(a: LayoutNode, b: LayoutNode, gap: number): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const need = a.r + b.r + gap
  if (d >= need) return
  if (d < 1e-7) {
    b.x += 0.4
    b.y += 0.15
    return
  }
  const push = (need - d) * 0.52
  const ux = dx / d
  const uy = dy / d
  const ar = a.id === 'root'
  const br = b.id === 'root'
  if (ar && br) return
  if (ar) {
    b.x += ux * push * 2
    b.y += uy * push * 2
  } else if (br) {
    a.x -= ux * push * 2
    a.y -= uy * push * 2
  } else {
    a.x -= ux * push
    a.y -= uy * push
    b.x += ux * push
    b.y += uy * push
  }
}

/**
 * Push circles apart, then re-snap primaries to their rays and modalities to wedges.
 * Reduces dot overlap; line endpoints move with the nodes they connect.
 */
function resolveOverlaps(
  layout: NetworkLayout,
  thetas: readonly number[],
  sectorHalf: number,
  zone: ZoneRect,
  inset: number,
): void {
  const nodes = layout.nodes
  const rootNode = nodes.find((n) => n.id === 'root')
  if (!rootNode) return

  const GAP = 5
  const ITERS = 80

  for (let iter = 0; iter < ITERS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        separatePair(nodes[i], nodes[j], GAP)
      }
    }
    for (const n of nodes) {
      if (n.id === 'root') continue
      if (n.kind === 'primary') {
        const d = n.dayIndex ?? 0
        projectPrimaryNode(n, rootNode, thetas[d]!, zone, inset, sectorHalf)
      } else if (n.kind === 'modality') {
        const d = n.dayIndex ?? 0
        constrainModalityNode(n, rootNode, thetas[d]!, sectorHalf, zone, inset)
      }
    }
  }

  layout.root = { x: rootNode.x, y: rootNode.y }
}

export function buildNetworkLayout(
  week: WeekData,
  zone: ZoneRect,
  layoutSeed: number,
): NetworkLayout {
  void layoutSeed
  const inset = ZONE_INSET_PX
  const minDim = Math.min(zone.w, zone.h)

  const cx = zone.x + zone.w / 2
  const cy = zone.y + zone.h / 2

  const root = clampToZone(cx, cy, zone, inset)

  const act = weekActivation(week)
  const spread = 0.35 + 0.65 * Math.min(1, act * 2.2)

  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []

  /** Core badge: large enough for two initials; drives hub clearance for day arms. */
  const coreR =
    Math.max(18, Math.min(32, minDim * 0.058)) * NETWORK_VISUAL_SCALE

  nodes.push({
    id: 'root',
    kind: 'root',
    x: root.x,
    y: root.y,
    r: coreR,
  })

  /** Each day occupies ~1/7 of the circle; margin so adjacent arms’ geometry does not cross. */
  const sectorHalf = Math.PI / 7 - 0.055

  const thetas = Array.from(
    { length: 7 },
    (_, d) => -Math.PI / 2 + (2 * Math.PI * d) / 7,
  )

  for (let d = 0; d < 7; d++) {
    const day = week.days[d]
    const theta = thetas[d]!

    const reach = primaryArmLengthPx(day)

    let px = root.x + Math.cos(theta) * reach
    let py = root.y + Math.sin(theta) * reach
    ;({ x: px, y: py } = clampToZone(px, py, zone, inset))
    ;({ x: px, y: py } = clampPointToWedge(px, py, root, theta, sectorHalf))
    ;({ x: px, y: py } = clampToZone(px, py, zone, inset))

    const primaryId = `p-${d}`
    nodes.push({
      id: primaryId,
      kind: 'primary',
      x: px,
      y: py,
      r: (5.4 + spread * 1.35) * NETWORK_VISUAL_SCALE,
      dayIndex: d,
    })

    links.push({
      id: `l-root-${d}`,
      x0: root.x,
      y0: root.y,
      x1: px,
      y1: py,
    })

    for (let mi = 0; mi < MODALITIES.length; mi++) {
      const modality = MODALITIES[mi]
      const reading = day.modalities[modality]
      const secLen = secondaryArmLengthPx(reading)
      const dir = secondaryFanUnitDirection(theta, mi, minDim, spread)

      let sx = px + dir.x * secLen
      let sy = py + dir.y * secLen
      ;({ x: sx, y: sy } = clampPointToWedge(sx, sy, root, theta, sectorHalf))
      ;({ x: sx, y: sy } = clampToZone(sx, sy, zone, inset))

      const nid = `m-${d}-${mi}`
      nodes.push({
        id: nid,
        kind: 'modality',
        x: sx,
        y: sy,
        r: modalityShapeRadiusPx(reading.deviationMagnitude),
        color: MODALITY_COLORS[modality],
        dayIndex: d,
        modality,
        band: reading.band,
        deviationMagnitude: reading.deviationMagnitude,
      })

      links.push({
        id: `l-${primaryId}-${mi}`,
        x0: px,
        y0: py,
        x1: sx,
        y1: sy,
      })
    }
  }

  const laidOut: NetworkLayout = { root, nodes, links }
  resolveOverlaps(laidOut, thetas, sectorHalf, zone, inset)
  placeSemanticArms(laidOut, week, thetas, zone, inset, sectorHalf)
  return centerClusterInZone(laidOut, zone)
}

function syncLinksToNodes(layout: NetworkLayout): void {
  const m = new Map(layout.nodes.map((n) => [n.id, n]))
  const root = m.get('root')
  if (!root) return
  for (const lk of layout.links) {
    if (lk.id.startsWith('l-root-')) {
      const d = Number(lk.id.slice('l-root-'.length))
      const p = m.get(`p-${d}`)
      if (!p) continue
      lk.x0 = root.x
      lk.y0 = root.y
      lk.x1 = p.x
      lk.y1 = p.y
      continue
    }
    const mod = /^l-p-(\d+)-(\d+)$/.exec(lk.id)
    if (mod) {
      const d = Number(mod[1])
      const primary = m.get(`p-${d}`)
      const leaf = m.get(`m-${d}-${mod[2]}`)
      if (!primary || !leaf) continue
      lk.x0 = primary.x
      lk.y0 = primary.y
      lk.x1 = leaf.x
      lk.y1 = leaf.y
    }
  }
}

/** Translate the network so its bounding box is centered in the zone, then clamp and resync links. */
function centerClusterInZone(layout: NetworkLayout, zone: ZoneRect): NetworkLayout {
  const inset = ZONE_INSET_PX
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of layout.nodes) {
    const pad = n.r + 2
    minX = Math.min(minX, n.x - pad)
    minY = Math.min(minY, n.y - pad)
    maxX = Math.max(maxX, n.x + pad)
    maxY = Math.max(maxY, n.y + pad)
  }
  if (!Number.isFinite(minX)) return layout

  const bx = (minX + maxX) / 2
  const by = (minY + maxY) / 2
  const tcx = zone.x + zone.w / 2
  const tcy = zone.y + zone.h / 2
  const ox = tcx - bx
  const oy = tcy - by

  for (const n of layout.nodes) {
    const c = clampToZone(n.x + ox, n.y + oy, zone, inset)
    n.x = c.x
    n.y = c.y
  }

  syncLinksToNodes(layout)

  const rootNode = layout.nodes.find((n) => n.id === 'root')
  if (rootNode) {
    layout.root = { x: rootNode.x, y: rootNode.y }
  }

  return layout
}

/** Matches `buildNetworkLayout` day angular width (margin between adjacent arms). */
export const L1_DAY_SECTOR_HALF_RAD = Math.PI / 7 - 0.055

/** Hub layout: Monday starts at top (−π/2), 7 days around the circle. */
export function l1DayCenterAngle(dayIndex: number): number {
  return -Math.PI / 2 + (2 * Math.PI * dayIndex) / 7
}

function cross2(
  o: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Monotone chain convex hull (small n). */
function convexHull2(points: [number, number][]): [number, number][] {
  const uniq = points.filter(
    (p, i) => points.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i,
  )
  if (uniq.length < 3) return uniq
  const sorted = [...uniq].sort((a, b) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1],
  )
  const lower: [number, number][] = []
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross2(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
    ) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (
      upper.length >= 2 &&
      cross2(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
    ) {
      upper.pop()
    }
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function rayRectExit(
  ox: number,
  oy: number,
  ux: number,
  uy: number,
  z: ZoneRect,
): { x: number; y: number } {
  const xMin = z.x
  const xMax = z.x + z.w
  const yMin = z.y
  const yMax = z.y + z.h
  const ulen = Math.hypot(ux, uy) || 1
  const dx = ux / ulen
  const dy = uy / ulen
  let bestT = Infinity

  if (Math.abs(dx) > 1e-14) {
    for (const vx of [xMin, xMax]) {
      const t = (vx - ox) / dx
      if (t > 1e-9) {
        const yy = oy + t * dy
        if (yy >= yMin - 1e-6 && yy <= yMax + 1e-6 && t < bestT) bestT = t
      }
    }
  }
  if (Math.abs(dy) > 1e-14) {
    for (const vy of [yMin, yMax]) {
      const t = (vy - oy) / dy
      if (t > 1e-9) {
        const xx = ox + t * dx
        if (xx >= xMin - 1e-6 && xx <= xMax + 1e-6 && t < bestT) bestT = t
      }
    }
  }

  if (!Number.isFinite(bestT)) return { x: ox, y: oy }
  return { x: ox + dx * bestT, y: oy + dy * bestT }
}

function isAngleInDayWedge(
  phi: number,
  thetaCenter: number,
  halfWidth: number,
): boolean {
  let d = phi - thetaCenter
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return Math.abs(d) <= halfWidth + 1e-6
}

/**
 * Convex polygon approximating one weekday’s angular slice ∩ plot zone (level-1 hub).
 * Used for large invisible hit targets behind links.
 */
export function dayZoneSectorPolygonPoints(
  root: { x: number; y: number; r: number },
  dayIndex: number,
  zone: ZoneRect,
): { x: number; y: number }[] {
  const sectorHalf = L1_DAY_SECTOR_HALF_RAD
  const theta = l1DayCenterAngle(dayIndex)
  const a0 = theta - sectorHalf
  const a1 = theta + sectorHalf
  const innerR = root.r + 6
  const rx = root.x
  const ry = root.y

  const ix0 = rx + Math.cos(a0) * innerR
  const iy0 = ry + Math.sin(a0) * innerR
  const ix1 = rx + Math.cos(a1) * innerR
  const iy1 = ry + Math.sin(a1) * innerR

  const ex0 = rayRectExit(rx, ry, Math.cos(a0), Math.sin(a0), zone)
  const ex1 = rayRectExit(rx, ry, Math.cos(a1), Math.sin(a1), zone)

  const pts: [number, number][] = [
    [ix0, iy0],
    [ix1, iy1],
    [ex0.x, ex0.y],
    [ex1.x, ex1.y],
  ]

  const corners: [number, number][] = [
    [zone.x, zone.y],
    [zone.x + zone.w, zone.y],
    [zone.x + zone.w, zone.y + zone.h],
    [zone.x, zone.y + zone.h],
  ]
  for (const [cx, cy] of corners) {
    const phi = Math.atan2(cy - ry, cx - rx)
    if (isAngleInDayWedge(phi, theta, sectorHalf)) {
      pts.push([cx, cy])
    }
  }

  const hull = convexHull2(pts)
  return hull.map(([x, y]) => ({ x, y }))
}
