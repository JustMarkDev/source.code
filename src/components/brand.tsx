/**
 * Brand logos. Where Simple Icons has the mark we draw its official path in the
 * brand colour (dark marks follow the text colour so they stay visible in dark
 * mode). Where it does not, we show the vendor's own icon file from
 * `public/logos/`, taken from the vendor's website.
 */
import { cn } from 'cn'
import {
  siBitbucket,
  siClaude,
  siCloudflare,
  siCodeberg,
  siCoderabbit,
  siCursor,
  siForgejo,
  siGitea,
  siGithub,
  siGitlab,
  siLinear,
  siQodo,
  siSentry,
  siVercel,
} from './brand-icons'
import type * as React from 'react'
import type { BrandIcon } from './brand-icons'

/**
 * A vendor's own file is drawn for a light page. `invert` is for the ones that
 * are a dark mark on a transparent background: on a dark card they would
 * vanish, so the dark theme flips their lightness and keeps their hue.
 * `edge` is for the ones that are a filled square: the square gets a hairline
 * so its shape reads when its colour is close to the card's.
 */
type Brand =
  | { name: string; icon: BrandIcon }
  | { name: string; file: string; invert?: boolean; edge?: boolean }

export const brands = {
  // Hosts. These only ever show on private screens.
  github: { name: 'GitHub', icon: siGithub },
  gitlab: { name: 'GitLab', icon: siGitlab },
  gitea: { name: 'Gitea', icon: siGitea },
  forgejo: { name: 'Forgejo', icon: siForgejo },
  codeberg: { name: 'Codeberg', icon: siCodeberg },
  bitbucket: { name: 'Bitbucket', icon: siBitbucket },
  // Code review
  coderabbit: { name: 'CodeRabbit', icon: siCoderabbit },
  greptile: { name: 'Greptile', file: 'greptile.png', edge: true },
  macroscope: { name: 'Macroscope', file: 'macroscope.svg', edge: true },
  qodo: { name: 'Qodo', icon: siQodo },
  bugbot: { name: 'Cursor Bugbot', icon: siCursor },
  claudereview: { name: 'Claude Code Review', icon: siClaude },
  // Runners
  blacksmith: { name: 'Blacksmith', file: 'blacksmith.svg', edge: true },
  namespace: { name: 'Namespace', file: 'namespace.svg', invert: true },
  depot: { name: 'Depot', file: 'depot.png', invert: true },
  warpbuild: { name: 'WarpBuild', file: 'warpbuild.png', edge: true },
  // Agent environments
  t3code: { name: 'T3 Code', file: 't3code.png', edge: true },
  boat: { name: 'boat.dev', file: 'boat.svg', invert: true },
  e2b: { name: 'E2B', file: 'e2b.png', edge: true },
  daytona: { name: 'Daytona', file: 'daytona.png', edge: true },
  vercel: { name: 'Vercel Sandbox', icon: siVercel },
  cloudflare: { name: 'Cloudflare Sandbox', icon: siCloudflare },
  // Secrets and config
  varlock: { name: 'Varlock', file: 'varlock.png', invert: true },
  // Planning and monitoring
  linear: { name: 'Linear', icon: siLinear },
  sentry: { name: 'Sentry', icon: siSentry },
} as const satisfies Record<string, Brand>

export type BrandId = keyof typeof brands

function channel(c: number) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

type Rgb = [number, number, number]

const rgb = (hex: string) =>
  [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

// The card surface in each theme, as relative luminance.
const LIGHT_CARD = 0.98
const DARK_CARD = 0.012

/**
 * A brand colour that reads on a surface: the colour itself if it already has
 * enough contrast, otherwise the same hue moved toward black (on a light
 * surface) or white (on a dark one) until it does.
 */
export function readableOn(hex: string, surface: number, min: number) {
  let c = rgb(hex)
  const toward = surface > 0.5 ? 0 : 255
  for (let i = 0; i < 30 && contrast(luminance(c), surface) < min; i++)
    c = c.map((v) => Math.round(v + (toward - v) * 0.1)) as Rgb
  return `rgb(${c.join(' ')})`
}

/**
 * A brand logo, in the colours that read on the current theme. Pass a size,
 * such as `size-4`. Vector marks get one colour per theme. A vendor's own file
 * is shown as it is, or lightness-flipped in the dark theme where it needs it.
 */
export function BrandLogo({
  id,
  className,
}: {
  id: BrandId
  className?: string
}) {
  const brand: Brand = brands[id]
  if ('file' in brand) {
    return (
      <img
        src={`/logos/${brand.file}`}
        alt=""
        loading="lazy"
        className={cn(
          'size-5 rounded-[5px] object-contain',
          brand.invert && 'dark:hue-rotate-180 dark:invert',
          brand.edge && 'ring-1 ring-black/10 dark:ring-white/15',
          className,
        )}
      />
    )
  }
  const { icon } = brand
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      className={cn(
        'size-5 fill-current text-(--mark-light) dark:text-(--mark-dark)',
        className,
      )}
      style={
        {
          '--mark-light': readableOn(icon.hex, LIGHT_CARD, 4),
          '--mark-dark': readableOn(icon.hex, DARK_CARD, 4.5),
        } as React.CSSProperties
      }
    >
      <path d={icon.path} />
    </svg>
  )
}

/** The logo on a quiet tile, used wherever a brand introduces a card or row. */
export function BrandTile({
  id,
  className,
}: {
  id: BrandId
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card',
        className,
      )}
    >
      <BrandLogo id={id} />
    </span>
  )
}

export function brandName(id: BrandId) {
  return brands[id].name
}
