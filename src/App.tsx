import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EncodingHelpHint,
  GroveNetwork,
  type ViewLevel,
} from './components/GroveNetwork'
import { InsightsPanel } from './components/InsightsPanel'
import { ModalityDayTrend } from './components/ModalityDayTrend'
import { SparkleIcon } from './components/SparkleIcon'
import {
  BG,
  HEADER_BAR_PX,
  LEVEL3_TITLE_STRIP_PX,
  MAX_HOUSEHOLD_MEMBERS,
  MODALITIES,
  MODALITY_COLORS,
  interPersonGapPx,
} from './constants'
import {
  buildDayInsights,
  buildModalityTrendInsights,
  buildWeekInsights,
} from './data/buildWeekInsights'
import { formatDayInWeekLabel } from './data/calendarLabel'
import { generateMockDataset } from './data/generateMockData'
import type { ZoneRect } from './data/layout'
import type { DeviationBand } from './data/types'
import type { ModalityId } from './constants'
import './App.css'

const DAY_NAMES_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

function bandLabel(band: DeviationBand): string {
  if (band === 'above') return 'above your baseline'
  if (band === 'below') return 'below your baseline'
  return 'within your baseline'
}

interface AppProps {
  /** How many people to show (1 = full width; more = narrower columns). Capped by demo data. */
  householdMemberCount?: number
}

type ProfileSection = {
  title: string
  items: Array<{ label: string; detail: string }>
}

const PROFILE_SECTIONS: ProfileSection[] = [
  {
    title: 'Household',
    items: [
      {
        label: 'Household members',
        detail: 'add, name, or remove people from the household',
      },
      {
        label: 'Training period status',
        detail:
          'how far along the baseline learning period is, estimated completion date',
      },
      { label: 'Object status', detail: 'on/off button' },
    ],
  },
  {
    title: 'Your Grove',
    items: [
      {
        label: 'Export your data',
        detail: 'download your emotional archive as a file you own',
      },
      {
        label: 'Delete your data',
        detail: 'permanently erase specific weeks or the full archive',
      },
      {
        label: 'Reset baseline',
        detail:
          'restart the training period if your life circumstances have changed significantly',
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      {
        label: 'Weekly patterns',
        detail: 'what the system has noticed recurring across weeks',
      },
      {
        label: 'Your tags',
        detail:
          'a view of all the annotations you have added over time, searchable',
      },
      {
        label: 'Modality breakdown',
        detail:
          'a simple summary of which sensing channels have been most and least active over time',
      },
      {
        label: 'Baseline drift',
        detail:
          'a view of how your baseline itself has shifted over months, showing long term change without labeling it',
      },
    ],
  },
  {
    title: 'Object',
    items: [
      {
        label: 'Connection status',
        detail: 'whether the object is connected to the local network',
      },
      { label: 'Sensing status', detail: 'active, off' },
      {
        label: 'Storage',
        detail: 'how much local storage has been used and how much remains',
      },
      {
        label: 'Data encryption',
        detail: 'confirmation that data is encrypted at rest',
      },
      {
        label: 'Firmware',
        detail: 'current version of on-device software',
      },
    ],
  },
  {
    title: 'Privacy',
    items: [
      {
        label: 'What is being sensed',
        detail:
          'a plain language explanation of the five modalities and what each one reads',
      },
      {
        label: 'How data is stored',
        detail:
          'explanation of local storage and edge computing in accessible language',
      },
      {
        label: 'Who can see your data',
        detail:
          'clarification that data never leaves the home network and is accessible only on this device',
      },
      {
        label: 'Household data sharing',
        detail: 'settings for which household members can see which views',
      },
      {
        label: 'Consent settings',
        detail:
          'individual toggles per household member for each sensing modality, so someone can opt out of thermal sensing but remain in vocal prosody for example',
      },
    ],
  },
  {
    title: 'Preferences',
    items: [
      {
        label: 'Notification settings',
        detail:
          'whether the app sends any alerts at all, and if so what kind',
      },
      { label: 'Visualization style', detail: 'any display preferences for the grove view' },
      { label: 'Language', detail: 'choose app language' },
      { label: 'Appearance', detail: 'light or dark mode' },
    ],
  },
]

export default function App({ householdMemberCount = 2 }: AppProps) {
  const dataset = useMemo(() => generateMockDataset(), [])
  const memberCount = Math.min(
    dataset.members.length,
    MAX_HOUSEHOLD_MEMBERS,
    Math.max(1, Math.round(householdMemberCount)),
  )
  const members = useMemo(
    () => dataset.members.slice(0, memberCount),
    [dataset.members, memberCount],
  )

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 1100, h: 720 })

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    setSize({ w: r.width, h: r.height })
    return () => ro.disconnect()
  }, [])

  const [weekIndex, setWeekIndex] = useState(7)
  const [level, setLevel] = useState<ViewLevel>(1)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [hoveredPersonId, setHoveredPersonId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<null | {
    modality: ModalityId
    band: DeviationBand
    x: number
    y: number
  }>(null)

  const [dayZoom, setDayZoom] = useState<null | {
    personId: string
    dayIndex: number
  }>(null)

  const [moment, setMoment] = useState<null | {
    personId: string
    dayIndex: number
    modality: ModalityId
  }>(null)

  const [insightsOpen, setInsightsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [objectEnabled, setObjectEnabled] = useState(true)

  const weeksForSelect = useMemo(
    () => [...(members[0]?.weeks ?? [])].reverse(),
    [members],
  )

  const stageRef = useRef<SVGSVGElement | null>(null)

  /** Top chrome: logo row; level 3 adds a Back row under the logo. */
  const headerChromeH = HEADER_BAR_PX
  /** Keep bottom chrome (Insights, week select) aligned with the base header strip when level 3 extends height. */
  const headerChromeBottomOffset =
    headerChromeH - HEADER_BAR_PX + 12
  /** Second row on level 2 (day zoom): person + weekday navigation + date. */
  const LEVEL2_SUBHEADER_PX = 76

  const plotTopY = useMemo(
    () =>
      headerChromeH + (level === 2 && dayZoom ? LEVEL2_SUBHEADER_PX : 0),
    [level, dayZoom, headerChromeH],
  )
  const contentLeft = 0
  const contentW = size.w
  const plotH = Math.max(0, size.h - plotTopY)

  const n = members.length
  const interGap = interPersonGapPx(n)
  const colW =
    n > 0 ? Math.max(0, (contentW - Math.max(0, n - 1) * interGap) / n) : 0

  const zonesL1: ZoneRect[] = useMemo(() => {
    if (n <= 0) return []
    if (n === 1) {
      return [{ x: contentLeft, y: plotTopY, w: contentW, h: plotH }]
    }
    return Array.from({ length: n }, (_, i) => ({
      x: contentLeft + i * (colW + interGap),
      y: plotTopY,
      w: colW,
      h: plotH,
    }))
  }, [n, contentLeft, contentW, colW, interGap, plotTopY, plotH])

  /** Full plot rect (timeline excluded) — used when a day is zoomed so one graph is centered. */
  const zoneFull: ZoneRect = useMemo(
    () => ({ x: contentLeft, y: plotTopY, w: contentW, h: plotH }),
    [contentLeft, contentW, plotTopY, plotH],
  )

  /** Opaque strips between adjacent people (crown shyness for two; thinner for 3+). */
  const gapRects: { x: number; y: number; w: number; h: number }[] = useMemo(() => {
    if (n <= 1) return []
    const rects: { x: number; y: number; w: number; h: number }[] = []
    for (let i = 0; i < n - 1; i++) {
      rects.push({
        x: contentLeft + (i + 1) * colW + i * interGap,
        y: plotTopY,
        w: interGap,
        h: plotH,
      })
    }
    return rects
  }, [n, contentLeft, colW, interGap, plotTopY, plotH])

  const selectedPerson = members.find((m) => m.id === selectedPersonId) ?? null

  /** Logo + title: one tap returns to level 1 from deeper views. */
  const handleGroveHome = () => {
    if (level <= 1) return
    setMoment(null)
    setDayZoom(null)
    setSelectedPersonId(null)
    setLevel(1)
    setTooltip(null)
  }

  const handleLevel3Back = () => {
    setMoment(null)
    setLevel(2)
    setTooltip(null)
  }

  /** Level 2: cycle Mon–Sun within the same week (wraps at week boundaries). */
  const handleLevel2DayNavigate = (delta: -1 | 1) => {
    if (level !== 2 || !dayZoom) return
    const next = ((dayZoom.dayIndex + delta) % 7 + 7) % 7
    setDayZoom({ personId: dayZoom.personId, dayIndex: next })
    setTooltip(null)
  }

  const weekLabel = members[0]?.weeks[weekIndex]?.label ?? ''

  const dayZoomPerson =
    dayZoom != null ? members.find((m) => m.id === dayZoom.personId) ?? null : null
  const level2HeaderDayLabel =
    level === 2 && dayZoom && dayZoomPerson
      ? dayZoomPerson.weeks[weekIndex]?.weekStartISO != null
        ? formatDayInWeekLabel(
            dayZoomPerson.weeks[weekIndex].weekStartISO,
            dayZoom.dayIndex,
          )
        : ''
      : null

  const momentPerson =
    moment != null
      ? members.find((m) => m.id === moment.personId) ?? null
      : null

  const momentReading =
    moment && momentPerson
      ? momentPerson.weeks[weekIndex].days[moment.dayIndex].modalities[
          moment.modality
        ]
      : null

  const level3HeaderDateLabel = useMemo(() => {
    if (level !== 3 || !moment || !momentPerson) return ''
    const iso = momentPerson.weeks[weekIndex]?.weekStartISO
    if (iso != null) return formatDayInWeekLabel(iso, moment.dayIndex)
    return DAY_NAMES_FULL[moment.dayIndex]
  }, [level, moment, momentPerson, weekIndex])

  const insightSections = useMemo(() => {
    if (level === 3 && moment && momentPerson && momentReading) {
      return buildModalityTrendInsights(
        momentPerson,
        weekIndex,
        moment.dayIndex,
        moment.modality,
        momentReading,
      )
    }
    if (level === 2 && dayZoom) {
      return buildDayInsights(
        members,
        weekIndex,
        dayZoom.dayIndex,
        dayZoom.personId,
      )
    }
    return buildWeekInsights(members, weekIndex)
  }, [
    level,
    moment,
    momentPerson,
    momentReading,
    members,
    weekIndex,
    dayZoom,
  ])

  useEffect(() => {
    if (!profileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profileOpen])

  return (
    <div
      ref={rootRef}
      className="grove-app"
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        background: BG,
        overflow: 'hidden',
        color: '#2C2416',
      }}
    >
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: headerChromeH,
          zIndex: 25,
          /** Must allow hits so the Grove brand control (and other chrome) receive clicks. */
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 14,
            top: 0,
            height: headerChromeH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            paddingTop: 8,
            paddingBottom: 0,
            zIndex: 30,
            boxSizing: 'border-box',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (level > 1) handleGroveHome()
            }}
            aria-label={
              level <= 1 ? 'Grove' : 'Back to week overview'
            }
            aria-disabled={level <= 1}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: level <= 1 ? 'default' : 'pointer',
              borderRadius: 8,
              pointerEvents: 'auto',
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}grove-logo.png`}
              alt=""
              width={40}
              height={40}
              style={{ display: 'block', objectFit: 'contain' }}
            />
            <span
              style={{
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontWeight: 700,
                fontSize: 22,
                color: '#2C2416',
                letterSpacing: '-0.02em',
              }}
            >
              Grove
            </span>
          </button>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: headerChromeH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 18,
            paddingBottom: 8,
            boxSizing: 'border-box',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {level === 1 || level === 3 || (level === 2 && dayZoom) ? null : (
            <>
              <div
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#2C2416',
                  lineHeight: 1.12,
                }}
              >
                Grove
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 14,
                  fontWeight: 400,
                  color: '#8C8070',
                  fontFamily:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  letterSpacing: '0.02em',
                  maxWidth: 'min(92vw, 560px)',
                  paddingLeft: 12,
                  paddingRight: 12,
                  lineHeight: 1.4,
                }}
              >
                {weekLabel}
              </div>
            </>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 14,
            bottom: headerChromeBottomOffset,
            zIndex: 26,
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: 'min(56vw, 420px)',
            minWidth: 0,
          }}
        >
          {level !== 3 && !dayZoom && level >= 2 && selectedPerson && (
            <div
              style={{
                flexShrink: 1,
                fontSize: 12,
                color: '#6e655a',
                fontFamily: 'Georgia, "Times New Roman", serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedPerson.displayName}
            </div>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            right: 14,
            top: 12,
            zIndex: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            pointerEvents: 'auto',
            maxWidth: 'min(calc(100vw - 28px), 520px)',
            minWidth: 0,
          }}
        >
          {level !== 3 && !dayZoom && (
            <select
              className="grove-week-select"
              aria-label="Week"
              value={weekIndex}
              onChange={(e) => setWeekIndex(Number(e.target.value))}
              style={{
                flex: '1 1 auto',
                minWidth: 140,
                maxWidth: 280,
              }}
            >
              {weeksForSelect.map((w) => (
                <option key={w.weekIndex} value={w.weekIndex}>
                  {w.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            aria-expanded={insightsOpen}
            aria-controls="grove-insights-panel"
            onClick={() => setInsightsOpen((o) => !o)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid #e2dbd0',
              background: 'rgba(250, 250, 248, 0.96)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: '#4a4338',
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              boxShadow: '0 2px 12px rgba(44, 36, 22, 0.06)',
            }}
          >
            <SparkleIcon size={17} />
            Insights
          </button>
          <button
            type="button"
            aria-expanded={profileOpen}
            aria-controls="grove-profile-panel"
            onClick={() => setProfileOpen((o) => !o)}
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 999,
              border: '1px solid #e2dbd0',
              background: 'rgba(250, 250, 248, 0.96)',
              cursor: 'pointer',
              color: '#5e564b',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 12px rgba(44, 36, 22, 0.06)',
            }}
            title="Profile and settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="5.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M2.6 13c.8-2.1 2.8-3.4 5.4-3.4s4.6 1.3 5.4 3.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {level === 3 && moment && momentPerson && momentReading && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: headerChromeH,
            height: LEVEL3_TITLE_STRIP_PX,
            paddingRight: 14,
            paddingLeft: 14,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 12,
            zIndex: 27,
            pointerEvents: 'auto',
            background: BG,
          }}
        >
          <button
            type="button"
            onClick={handleLevel3Back}
            aria-label="Back to day view"
            style={{
              flexShrink: 0,
              padding: '5px 11px',
              borderRadius: 8,
              border: '1px solid #e2dbd0',
              background: 'rgba(250, 250, 248, 0.96)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              color: '#4a4338',
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              boxShadow: '0 1px 6px rgba(44, 36, 22, 0.06)',
            }}
          >
            ← Back
          </button>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'center',
              paddingLeft: 44,
            }}
          >
            <div
              style={{
                fontSize: 16,
                lineHeight: 1.2,
                textAlign: 'left',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontWeight: 700,
                  color: MODALITY_COLORS[moment.modality],
                }}
              >
                {moment.modality}
              </span>
              <span
                style={{
                  fontFamily:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontWeight: 500,
                  color: '#4a4338',
                }}
              >
                {' - '}
                {momentPerson.displayName}
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                fontWeight: 400,
                color: '#8C8070',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                letterSpacing: '0.02em',
                textAlign: 'left',
                maxWidth: '100%',
                lineHeight: 1.35,
              }}
            >
              {level3HeaderDateLabel}
            </div>
          </div>
        </div>
      )}

      {level === 2 && dayZoom && dayZoomPerson ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: headerChromeH,
            height: LEVEL2_SUBHEADER_PX,
            zIndex: 25,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            pointerEvents: 'auto',
            background: BG,
            paddingLeft: 16,
            paddingRight: 16,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 22,
              fontWeight: 700,
              color: '#2C2416',
              lineHeight: 1.15,
              textAlign: 'center',
            }}
          >
            {dayZoomPerson.displayName}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              minHeight: 28,
            }}
          >
            <button
              type="button"
              onClick={() => handleLevel2DayNavigate(-1)}
              aria-label="Previous day in this week (wraps Sunday to Monday)"
              style={{
                flexShrink: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 24,
                lineHeight: 1,
                padding: '4px 8px',
                color: '#6e655a',
              }}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: 14,
                fontWeight: 400,
                color: '#8C8070',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                letterSpacing: '0.02em',
                textAlign: 'center',
                minWidth: 200,
              }}
            >
              {level2HeaderDayLabel ?? ''}
            </span>
            <button
              type="button"
              onClick={() => handleLevel2DayNavigate(1)}
              aria-label="Next day in this week (wraps Monday to Sunday)"
              style={{
                flexShrink: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 24,
                lineHeight: 1,
                padding: '4px 8px',
                color: '#6e655a',
              }}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      <svg
        ref={stageRef}
        width={size.w}
        height={size.h}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'block',
        }}
      >
        <defs>
          {members.map((m) => (
            <filter
              key={`glow-${m.id}`}
              id={`glow-${m.id}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b" />
              <feOffset in="b" dx="0" dy="3" result="o" />
              <feFlood floodColor="#c9c1b4" floodOpacity="0.35" />
              <feComposite in2="o" operator="in" result="s" />
              <feMerge>
                <feMergeNode in="s" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          {members.map((m, i) => {
            const z =
              dayZoom?.personId === m.id ? zoneFull : zonesL1[i]!
            return (
              <clipPath key={m.id} id={`clip-net-${m.id}`}>
                <rect x={z.x} y={z.y} width={z.w} height={z.h} />
              </clipPath>
            )
          })}
        </defs>

        {members.map((m, i) => {
          const zCol = zonesL1[i]
          if (!zCol) return null
          const zoomedHere = dayZoom?.personId === m.id
          const zone = zoomedHere && dayZoom ? zoneFull : zCol
          const netLevel: ViewLevel =
            zoomedHere && level >= 2 ? level : 1
          const hiddenOthers = dayZoom && !zoomedHere
          return (
            <g
              key={m.id}
              style={{
                visibility: hiddenOthers ? 'hidden' : 'visible',
                pointerEvents: hiddenOthers ? 'none' : 'auto',
              }}
              onMouseEnter={() => setHoveredPersonId(m.id)}
              onMouseLeave={() => setHoveredPersonId(null)}
            >
              <GroveNetwork
                svgId={`net-${m.id}`}
                zone={zone}
                person={m}
                weekIndex={weekIndex}
                level={netLevel}
                dimNetwork={level === 3 && zoomedHere}
                lineHighlight={hoveredPersonId === m.id && !dayZoom}
                selectedNodeId={
                  moment && moment.personId === m.id
                    ? `m-${moment.dayIndex}-${MODALITIES.indexOf(moment.modality)}`
                    : null
                }
                showDayLabels
                compactDayLabels={!zoomedHere}
                zoomDayIndex={
                  zoomedHere && dayZoom ? dayZoom.dayIndex : null
                }
                onDayBranchClick={(dayIndex) => {
                  setDayZoom({ personId: m.id, dayIndex })
                  setSelectedPersonId(m.id)
                  setLevel(2)
                  setTooltip(null)
                }}
                onZoneClick={() => {}}
                onModalityClick={(dayIndex, modality) => {
                  setMoment({
                    personId: m.id,
                    dayIndex,
                    modality,
                  })
                  setLevel(3)
                  setTooltip(null)
                }}
                onModalityHover={(p) => {
                  if (!p) setTooltip(null)
                  else if (netLevel === 1 || netLevel === 2) setTooltip(p)
                }}
              />
            </g>
          )
        })}

        {!dayZoom &&
          gapRects.map((gr, idx) => (
            <rect
              key={`gap-${idx}`}
              x={gr.x}
              y={gr.y}
              width={gr.w}
              height={gr.h}
              fill={BG}
              style={{ pointerEvents: 'auto' }}
            />
          ))}

        {members[0] &&
          level <= 2 &&
          (!dayZoom || dayZoom.personId === members[0].id) && (
            <EncodingHelpHint
              zone={
                dayZoom?.personId === members[0].id ? zoneFull : zonesL1[0]!
              }
              level={level}
            />
          )}
      </svg>

      {tooltip && (level === 1 || (level === 2 && dayZoom)) && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            zIndex: 40,
            background: 'rgba(250, 250, 248, 0.96)',
            border: '1px solid #e2dbd0',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: '#6e655a',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            pointerEvents: 'none',
            boxShadow: '0 4px 18px rgba(44, 36, 22, 0.12)',
          }}
        >
          <div
            style={{
              fontFamily: 'Georgia, serif',
              marginBottom: 2,
              color: MODALITY_COLORS[tooltip.modality],
            }}
          >
            {tooltip.modality}
          </div>
          <div>{bandLabel(tooltip.band)}</div>
        </div>
      )}

      <InsightsPanel
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        sections={insightSections}
      />

      <div
        role="presentation"
        aria-hidden={!profileOpen}
        onClick={profileOpen ? () => setProfileOpen(false) : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 46,
          background: profileOpen ? 'rgba(44, 36, 22, 0.12)' : 'transparent',
          pointerEvents: profileOpen ? 'auto' : 'none',
          opacity: profileOpen ? 1 : 0,
          transition: 'opacity 0.28s ease',
        }}
      />
      <aside
        id="grove-profile-panel"
        aria-hidden={!profileOpen}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(460px, 100vw)',
          maxWidth: '100%',
          zIndex: 47,
          background: BG,
          boxShadow: profileOpen
            ? '-8px 0 40px rgba(44, 36, 22, 0.12)'
            : 'none',
          borderLeft: '1px solid #e8e2d8',
          transform: profileOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: profileOpen ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 18px 14px',
            borderBottom: '1px solid #ebe6df',
          }}
        >
          <div
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 18,
              fontWeight: 600,
              color: '#2C2416',
            }}
          >
            Profile & Settings
          </div>
          <button
            type="button"
            onClick={() => setProfileOpen(false)}
            aria-label="Close profile and settings"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              color: '#8C8070',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            overflowY: 'auto',
            padding: '14px 18px 22px',
            display: 'grid',
            gap: 14,
          }}
        >
          {PROFILE_SECTIONS.map((section) => (
            <section
              key={section.title}
              style={{
                border: '1px solid #ede8e0',
                borderRadius: 10,
                background: '#fdfcf9',
                padding: '12px 12px 10px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: 16,
                  color: '#2c2416',
                  textDecoration: 'underline',
                  textDecorationColor: '#8c8070',
                  textUnderlineOffset: 3,
                  cursor: 'pointer',
                }}
              >
                {section.title}
              </h3>
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {section.items.map((item) => (
                  <div key={`${section.title}-${item.label}`} style={{ lineHeight: 1.35 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#4a4338',
                        textDecoration: 'underline',
                        textDecorationColor: '#9b8f82',
                        textUnderlineOffset: 2,
                        cursor: 'pointer',
                        fontFamily:
                          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      }}
                    >
                      {item.label}
                    </div>
                    {item.label === 'Object status' && (
                      <button
                        type="button"
                        onClick={() => setObjectEnabled((v) => !v)}
                        aria-pressed={objectEnabled}
                        style={{
                          marginTop: 6,
                          minWidth: 86,
                          minHeight: 34,
                          padding: '7px 16px',
                          borderRadius: 999,
                          border: objectEnabled ? '1px solid #2f8a49' : '1px solid #a23c3c',
                          background: objectEnabled ? '#39a85a' : '#c44c4c',
                          color: '#ffffff',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily:
                            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                          boxShadow: objectEnabled
                            ? '0 2px 8px rgba(57, 168, 90, 0.32)'
                            : '0 2px 8px rgba(196, 76, 76, 0.32)',
                        }}
                      >
                        {objectEnabled ? 'On' : 'Off'}
                      </button>
                    )}
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12,
                        color: '#7d7266',
                        fontFamily:
                          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      }}
                    >
                      {item.label === 'Object status'
                        ? `Object is currently ${objectEnabled ? 'on' : 'off'}.`
                        : item.detail}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {level === 3 && moment && momentPerson && momentReading && (
        <ModalityDayTrend
          open
          modality={moment.modality}
          band={momentReading.band}
          seed={
            momentPerson.seed ^
            (weekIndex + 1) * 2654435761 ^
            (moment.dayIndex + 17) * 1597334677 ^
            (MODALITIES.indexOf(moment.modality) + 1) * 374761393
          }
          overlayTopPx={headerChromeH + LEVEL3_TITLE_STRIP_PX}
          onDismiss={() => {
            setMoment(null)
            setLevel(2)
            setTooltip(null)
          }}
        />
      )}
    </div>
  )
}
