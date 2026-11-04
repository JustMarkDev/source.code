/**
 * Heroicons has no version-control glyphs, so these four are drawn to match it:
 * 24px grid, 1.5 stroke, round caps, `currentColor`. Everything else in the app
 * comes straight from @heroicons/react.
 */
import type { SVGProps } from 'react'

function Glyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-slot="icon"
      {...props}
    />
  )
}

export function GitBranchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="8.5" r="2" />
      <path d="M6 7.5v9M18 10.5c0 3-3 3.5-6 3.5s-6 .5-6 3" />
    </Glyph>
  )
}

export function GitCommitIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M2.5 12h6M15.5 12h6" />
    </Glyph>
  )
}

export function GitForkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="18" cy="5.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
      <path d="M6 7.5v1.5c0 1.5 1 2.5 2.5 2.5h7c1.5 0 2.5-1 2.5-2.5V7.5M12 11.5v5" />
    </Glyph>
  )
}

export function GitMergeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7.5v9M8 5.5c5 0 8 2 8 6.5" />
    </Glyph>
  )
}
