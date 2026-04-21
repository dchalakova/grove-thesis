import { useEffect } from 'react'
import { BG } from '../constants'
import type { InsightSection } from '../data/buildWeekInsights'
import { SparkleIcon } from './SparkleIcon'

interface InsightsPanelProps {
  open: boolean
  onClose: () => void
  sections: InsightSection[]
}

export function InsightsPanel({ open, onClose, sections }: InsightsPanelProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        role="presentation"
        aria-hidden={!open}
        onClick={open ? onClose : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 44,
          background: open ? 'rgba(44, 36, 22, 0.12)' : 'transparent',
          pointerEvents: open ? 'auto' : 'none',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.28s ease',
        }}
      />
      <aside
        id="grove-insights-panel"
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 100vw)',
          maxWidth: '100%',
          zIndex: 45,
          background: BG,
          boxShadow: open
            ? '-8px 0 40px rgba(44, 36, 22, 0.12)'
            : 'none',
          borderLeft: '1px solid #e8e2d8',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: open ? 'auto' : 'none',
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
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 18,
              fontWeight: 600,
              color: '#2C2416',
            }}
          >
            <SparkleIcon size={22} />
            Insights
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close insights"
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
            flex: 1,
            overflowY: 'auto',
            padding: '14px 18px 28px',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 13,
            lineHeight: 1.55,
            color: '#5c5348',
          }}
        >
          {sections.map((sec) => (
            <section key={sec.id} style={{ marginBottom: 22 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: '#8C8070',
                  margin: '0 0 8px',
                }}
              >
                {sec.heading}
              </h2>
              {sec.paragraphs.map((p, i) => (
                <p key={i} style={{ margin: i === 0 ? 0 : '12px 0 0' }}>
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}
