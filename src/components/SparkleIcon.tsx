export function SparkleIcon({
  size = 18,
  className,
  title,
}: {
  size?: number
  className?: string
  /** Optional accessible name; omit for decorative icons (parent should label control). */
  title?: string
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}insights-sparkle.png`}
      alt={title ?? ''}
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : true}
      style={{ display: 'inline-block', objectFit: 'contain' }}
    />
  )
}
