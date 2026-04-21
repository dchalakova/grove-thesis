const MS_DAY = 86_400_000

/**
 * Calendar label for a specific weekday within a week (Monday-based `dayIndex` 0–6).
 */
export function formatDayInWeekLabel(weekStartISO: string, dayIndex: number): string {
  const monday = new Date(weekStartISO)
  const d = new Date(monday.getTime() + dayIndex * MS_DAY)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
