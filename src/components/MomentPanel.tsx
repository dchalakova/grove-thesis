import { useCallback, useRef } from 'react'
import type { ModalityId } from '../constants'
import { BG, MODALITY_COLORS } from '../constants'
import { modalityObservationText } from '../data/modalityObservations'
import type { DeviationBand } from '../data/types'

const TAGS = ['sports', 'good news', 'hard day', 'tired'] as const

function bandCopy(band: DeviationBand): string {
  if (band === 'above') return 'above your baseline'
  if (band === 'below') return 'below your baseline'
  return 'within your baseline'
}

interface MomentPanelProps {
  open: boolean
  modality: ModalityId
  dayLabel: string
  timeOfDay: string
  band: DeviationBand
  onDismiss: () => void
}

export function MomentPanel({
  open,
  modality,
  dayLabel,
  timeOfDay,
  band,
  onDismiss,
}: MomentPanelProps) {
  const dragRef = useRef<{ y0: number; my0: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).dataset.handle !== '1') return
      dragRef.current = { y0: e.clientY, my0: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = dragRef.current
      if (!s) return
      const dy = e.clientY - s.y0
      if (dy > 70) onDismiss()
    },
    [onDismiss],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  if (!open) return null

  const color = MODALITY_COLORS[modality]

  return (
    <div
      className="moment-panel"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '45%',
        background: BG,
        boxShadow: '0 -8px 32px rgba(44, 36, 22, 0.08)',
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        padding: '18px 22px 22px',
        boxSizing: 'border-box',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        animation: 'slideUp 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >
      <div
        data-handle="1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute',
          top: 6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 42,
          height: 5,
          borderRadius: 999,
          background: '#d8d0c4',
          cursor: 'grab',
        }}
      />
      <div
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 14,
          color,
          marginTop: 8,
        }}
      >
        {modality}
      </div>
      <div
        style={{
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 12,
          color: '#6e655a',
        }}
      >
        {dayLabel} · {timeOfDay}
      </div>
      <div
        style={{
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 11,
          color,
          opacity: 0.65,
        }}
      >
        {bandCopy(band)}
      </div>
      <div
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 12,
          fontStyle: 'italic',
          color: '#6e655a',
          lineHeight: 1.45,
        }}
      >
        <p style={{ margin: 0 }}>{modalityObservationText(modality, band)}</p>
      </div>
      <div
        style={{
          height: 1,
          background: '#e2dbd0',
          margin: '4px 0',
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: '#a8a090',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        what was this?
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {TAGS.map((t) => (
          <button
            key={t}
            type="button"
            style={{
              border: 'none',
              borderRadius: 999,
              padding: '6px 12px',
              background: '#EDE8E0',
              color: '#2C2416',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '6px 12px',
            background: '#EDE8E0',
            color: '#2C2416',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>
      <input
        type="text"
        placeholder="add a note"
        style={{
          marginTop: 4,
          width: '100%',
          maxWidth: 420,
          border: '1px solid #e2dbd0',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 11,
          background: '#fffcf7',
          color: '#2C2416',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          outline: 'none',
        }}
      />
    </div>
  )
}
