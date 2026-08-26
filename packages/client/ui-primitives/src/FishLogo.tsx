// Orygin product mark: a compact orbital "O" built for small UI surfaces.
// The name is retained for API compatibility with existing host slots; the
// rendered artwork is fully original and no longer contains the source mark.

import type { IconProps } from './icons/props.ts'

/** Render the Orygin mark. */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="12"
        cy="12"
        rx="8.1"
        ry="5.35"
        transform="rotate(-28 12 12)"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="8.1"
        ry="5.35"
        transform="rotate(28 12 12)"
        stroke="currentColor"
        strokeWidth="2.2"
        opacity="0.62"
      />
      <circle cx="12" cy="12" r="2.15" fill="currentColor" />
    </svg>
  )
}
