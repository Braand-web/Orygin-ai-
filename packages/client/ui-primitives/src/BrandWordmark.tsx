import type { IconProps } from './icons/props.ts'

/** Display options for the Orygin wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading Orygin mark; defaults to true. */
  includeMark?: boolean | undefined
}

/** Render the Orygin name with its optional orbital mark. */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  const textX = includeMark ? 31 : 26

  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      role="img"
      aria-label="Orygin"
    >
      {includeMark ? (
        <g transform="translate(1 1) scale(.9167)">
          <ellipse cx="12" cy="12" rx="8.1" ry="5.35" transform="rotate(-28 12 12)" stroke="currentColor" strokeWidth="2.2" />
          <ellipse cx="12" cy="12" rx="8.1" ry="5.35" transform="rotate(28 12 12)" stroke="currentColor" strokeWidth="2.2" opacity=".62" />
          <circle cx="12" cy="12" r="2.15" fill="currentColor" />
        </g>
      ) : null}
      <text
        x={textX}
        y="17.5"
        fill="currentColor"
        fontFamily="Inter, Segoe UI, Arial, sans-serif"
        fontSize="17"
        fontWeight="700"
        letterSpacing="0.2"
      >
        Orygin
      </text>
    </svg>
  )
}
