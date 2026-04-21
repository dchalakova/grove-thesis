import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BG,
  MODALITY_COLORS,
  MODALITY_TREND_PAD_X,
  MODALITY_TREND_VIEWBOX_H,
  MODALITY_TREND_VIEWBOX_W,
  STROKE_COLOR,
  type ModalityId,
} from '../constants'
import { mulberry32 } from '../data/prng'
import type { DeviationBand } from '../data/types'

interface ModalityDayTrendProps {
  open: boolean
  modality: ModalityId
  band: DeviationBand
  seed: number
  onDismiss: () => void
  /** Distance from viewport top to overlay top (matches App header chrome + gap). */
  overlayTopPx?: number
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

const DAY_MINUTES = 24 * 60

/** No samples 11pm–8am (sleep). Data covers 8am … 10pm inclusive (hourly). */
const AWAKE_FIRST_HOUR = 8
const AWAKE_LAST_HOUR = 22

function minutesToTimeLabel(mins: number): string {
  const capped = Math.min(Math.max(0, mins), DAY_MINUTES)
  const hh24 = Math.floor(capped / 60) % 24
  const mm = capped % 60
  const suffix = hh24 >= 12 ? 'PM' : 'AM'
  const hour12 = ((hh24 + 11) % 12) + 1
  return `${hour12}:${String(mm).padStart(2, '0')} ${suffix}`
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!
    const p1 = points[i]!
    const cp1x = p0.x + (p1.x - p0.x) * 0.35
    const cp2x = p0.x + (p1.x - p0.x) * 0.65
    d += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
}

export function ModalityDayTrend({
  open,
  modality,
  band,
  seed,
  onDismiss,
  overlayTopPx = 78,
}: ModalityDayTrendProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  /** Per-reading notes keyed by point index (awake hours only). */
  const [notesByIdx, setNotesByIdx] = useState<Record<number, string>>({})
  const [noteEditingIdx, setNoteEditingIdx] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const values = useMemo(() => {
    const rand = mulberry32(seed >>> 0)
    const count = AWAKE_LAST_HOUR - AWAKE_FIRST_HOUR + 1
    const target = band === 'above' ? 0.7 : band === 'below' ? 0.3 : 0.5
    const out: number[] = []
    let v = 0.5 + (rand() - 0.5) * 0.08
    for (let i = 0; i < count; i++) {
      const drift = (target - v) * 0.17
      const noise = (rand() - 0.5) * 0.24
      v = clamp01(v + drift + noise)
      out.push(v)
    }
    return out
  }, [seed, band])

  if (!open) return null

  const w = MODALITY_TREND_VIEWBOX_W
  const h = MODALITY_TREND_VIEWBOX_H
  const padX = MODALITY_TREND_PAD_X
  const padTop = 34
  const padBottom = 58
  const drawW = w - padX * 2
  const drawH = h - padTop - padBottom
  const baselineY = padTop + drawH * 0.5

  const pts = values.map((v, i) => {
    const mins = (AWAKE_FIRST_HOUR + i) * 60
    const x = padX + (mins / DAY_MINUTES) * drawW
    const y = padTop + (1 - v) * drawH
    const timeLabel = minutesToTimeLabel(mins)
    const reading = Math.round(v * 100)
    const delta = reading - 50
    return { x, y, timeLabel, reading, delta }
  })
  const curve = smoothPath(pts)

  /** Active reading card is painted last so it stacks above other points and the curve. */
  const focusIdx = noteEditingIdx ?? hoverIdx
  const orderedPointIndices = useMemo(() => {
    const n = pts.length
    const all = Array.from({ length: n }, (_, j) => j)
    if (focusIdx === null) return all
    return [...all.filter((j) => j !== focusIdx), focusIdx]
  }, [pts.length, focusIdx])

  const cardOpen = hoverIdx !== null || noteEditingIdx !== null

  const openNoteEditor = (i: number) => {
    setNoteEditingIdx(i)
    setNoteDraft(notesByIdx[i] ?? '')
  }

  const saveNote = () => {
    if (noteEditingIdx === null) return
    const idx = noteEditingIdx
    const t = noteDraft.trim()
    setNotesByIdx((prev) => {
      const next = { ...prev }
      if (t) next[idx] = t
      else delete next[idx]
      return next
    })
    setNoteEditingIdx(null)
    setNoteDraft('')
  }

  const cancelNoteEdit = () => {
    setNoteEditingIdx(null)
    setNoteDraft('')
  }

  const overlayRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const root = document.documentElement
    const el = overlayRef.current
    if (!el) return

    const sync = () => {
      const r = el.getBoundingClientRect()
      const scale = Math.min(r.width / w, r.height / h)
      /** xMidYMid meet: graph is centered horizontally; midnight line at viewBox x = padX. */
      const offsetX = (r.width - w * scale) / 2
      const midnightPx = offsetX + padX * scale
      root.style.setProperty('--grove-trend-midnight-x', `${midnightPx}px`)
    }

    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--grove-trend-midnight-x')
    }
  }, [h, padX, w])

  useEffect(() => {
    if (noteEditingIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNoteEditingIdx(null)
        setNoteDraft('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [noteEditingIdx])

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: overlayTopPx,
        bottom: 0,
        zIndex: cardOpen ? 100 : 23,
        background: BG,
        isolation: 'isolate',
      }}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', inset: 0 }}
      >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {Array.from({ length: 25 }, (_, i) => i).map((hour) => {
          const mins = hour * 60
          const x = padX + (mins / DAY_MINUTES) * drawW
          return (
            <line
              key={`hour-${hour}`}
              x1={x}
              x2={x}
              y1={padTop}
              y2={h - padBottom + 12}
              stroke={STROKE_COLOR}
              strokeOpacity={0.18}
              strokeWidth={1}
            />
          )
        })}

        <line
          x1={padX}
          x2={w - padX}
          y1={baselineY}
          y2={baselineY}
          stroke={STROKE_COLOR}
          strokeOpacity={0.28}
          strokeWidth={1}
        />
        <text
          x={padX - 8}
          y={baselineY + 3}
          textAnchor="end"
          fill="#8C8070"
          style={{
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 9,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}
        >
          baseline
        </text>

        <path
          d={curve}
          fill="none"
          stroke="#6e655a"
          strokeOpacity={0.9}
          strokeWidth={2.35}
          strokeLinecap="round"
        />

        {orderedPointIndices.map((i) => {
          const p = pts[i]!
          const active = hoverIdx === i || noteEditingIdx === i
          const r = active ? 7.2 : 5.6
          const hasNote = Boolean(notesByIdx[i]?.trim())
          const showCard = hoverIdx === i || noteEditingIdx === i
          const ang = Math.PI / 4
          const markX = p.x + r * Math.cos(ang)
          const markY = p.y - r * Math.sin(ang)
          const editing = noteEditingIdx === i
          const cardW = 124
          const cardHalf = cardW / 2
          const foH = editing ? 152 : hasNote ? 88 : 78
          const cardTop = p.y - foH - 8
          /** Tall invisible hit target so moving from the dot to the popup doesn’t drop hover. */
          const hitBottom = p.y + r + 8
          const hitHeight = hitBottom - cardTop
          return (
            <g
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => {
                if (noteEditingIdx !== i) setHoverIdx(null)
              }}
            >
              {showCard && (
                <rect
                  x={p.x - cardHalf - 4}
                  y={cardTop}
                  width={cardW + 8}
                  height={hitHeight}
                  fill="transparent"
                  pointerEvents="all"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill="#F5ECE9"
                stroke={MODALITY_COLORS[modality]}
                strokeOpacity={0.65}
                strokeWidth={1.2}
                style={{ cursor: 'default' }}
                onMouseMove={() => setHoverIdx(i)}
              />
              {showCard && (
                  <foreignObject
                    x={p.x - cardHalf}
                    y={cardTop}
                    width={cardW}
                    height={foH}
                    pointerEvents="all"
                    style={{ overflow: 'visible' }}
                  >
                  <div
                    style={{
                      boxSizing: 'border-box',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 5,
                      padding: '8px 2px 8px 8px',
                      minWidth: editing ? 118 : undefined,
                      background: '#fffdf9',
                      border: '1px solid #e2dbd0',
                      borderRadius: 5,
                      fontFamily:
                        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      color: '#5f564c',
                      boxShadow: '0 3px 14px rgba(44, 36, 22, 0.1)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={() => setHoverIdx(i)}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 500,
                        color: '#8C8070',
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.timeLabel}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        lineHeight: 1.1,
                        fontWeight: 700,
                        color: MODALITY_COLORS[modality],
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.reading}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#8C8070',
                          marginLeft: 5,
                        }}
                      >
                        ({p.delta >= 0 ? '+' : ''}
                        {p.delta})
                      </span>
                    </div>
                    {hasNote && !editing && (
                      <div
                        style={{
                          fontSize: 9,
                          color: '#8C8070',
                          lineHeight: 1.35,
                          maxHeight: 32,
                          maxWidth: cardW - 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {notesByIdx[i]}
                      </div>
                    )}
                    {editing ? (
                      <>
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Note for this reading…"
                          rows={3}
                          style={{
                            width: cardW - 12,
                            boxSizing: 'border-box',
                            resize: 'vertical',
                            minHeight: 56,
                            padding: '5px 5px',
                            border: '1px solid #e2dbd0',
                            borderRadius: 4,
                            fontFamily: 'inherit',
                            fontSize: 10,
                            color: '#2C2416',
                            background: '#fff',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={cancelNoteEdit}
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              border: '1px solid #e2dbd0',
                              borderRadius: 4,
                              background: '#fff',
                              cursor: 'pointer',
                              color: '#6e655a',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveNote}
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              border: 'none',
                              borderRadius: 4,
                              background: MODALITY_COLORS[modality],
                              cursor: 'pointer',
                              color: '#fffdf9',
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openNoteEditor(i)}
                        style={{
                          alignSelf: 'flex-start',
                          padding: '2px 0',
                          fontSize: 10,
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          color: MODALITY_COLORS[modality],
                          fontWeight: 600,
                          textDecoration: 'underline',
                          textUnderlineOffset: 2,
                        }}
                      >
                        {hasNote ? 'Edit note' : 'Add note'}
                      </button>
                    )}
                  </div>
                  </foreignObject>
              )}
              {hasNote && (
                <circle
                  cx={markX}
                  cy={markY}
                  r={2.1}
                  fill={MODALITY_COLORS[modality]}
                  stroke="#F5ECE9"
                  strokeWidth={0.85}
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </g>
          )
        })}

        {Array.from({ length: 7 }, (_, t) => {
          const mins = Math.round((t / 6) * DAY_MINUTES)
          const x = padX + (mins / DAY_MINUTES) * drawW
          return (
            <text
              key={`tick-${mins}`}
              x={x}
              y={h - padBottom + 28}
              textAnchor="middle"
              fill="#8C8070"
              style={{
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontSize: 11,
              }}
            >
              {minutesToTimeLabel(mins).replace(':00 ', '')}
            </text>
          )
        })}

      </svg>
      </div>
    </div>
  )
}
