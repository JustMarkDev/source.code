/**
 * Brand logos. Where Simple Icons has the mark we draw its official path in the
 * brand colour (dark marks follow the text colour so they stay visible in dark
 * mode). Where it does not, we show the vendor's own icon file from
 * `public/logos/`, taken from the vendor's website.
 */
import { cn } from 'cn'
import {
  si1password,
  siBitbucket,
  siBitwarden,
  siClaude,
  siCloudflare,
  siCodeberg,
  siCoderabbit,
  siCursor,
  siFlydotio,
  siForgejo,
  siGitea,
  siGithub,
  siGitlab,
  siLinear,
  siModal,
  siPulumi,
  siQodo,
  siSentry,
  siVault,
  siVercel,
} from './brand-icons'
import type { BrandIcon } from './brand-icons'

type Brand = { name: string; icon: BrandIcon } | { name: string; file: string }

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
  greptile: { name: 'Greptile', file: 'greptile.png' },
  macroscope: { name: 'Macroscope', file: 'macroscope.svg' },
  qodo: { name: 'Qodo', icon: siQodo },
  bugbot: { name: 'Cursor Bugbot', icon: siCursor },
  claudereview: { name: 'Claude Code Review', icon: siClaude },
  sourcery: { name: 'Sourcery', file: 'sourcery.svg' },
  ellipsis: { name: 'Ellipsis', file: 'ellipsis.svg' },
  // Runners
  blacksmith: { name: 'Blacksmith', file: 'blacksmith.svg' },
  namespace: { name: 'Namespace', file: 'namespace.svg' },
  depot: { name: 'Depot', file: 'depot.png' },
  warpbuild: { name: 'WarpBuild', file: 'warpbuild.png' },
  runson: { name: 'RunsOn', file: 'runson.png' },
  ubicloud: { name: 'Ubicloud', file: 'ubicloud.png' },
  // Agent environments
  t3code: { name: 'T3 Code', file: 't3code.png' },
  boat: { name: 'boat.dev', file: 'boat.svg' },
  e2b: { name: 'E2B', file: 'e2b.png' },
  daytona: { name: 'Daytona', file: 'daytona.png' },
  modal: { name: 'Modal', icon: siModal },
  vercel: { name: 'Vercel Sandbox', icon: siVercel },
  cloudflare: { name: 'Cloudflare Sandbox', icon: siCloudflare },
  fly: { name: 'Fly Sprites', icon: siFlydotio },
  // Secrets and config
  varlock: { name: 'Varlock', file: 'varlock.png' },
  onepassword: { name: '1Password', icon: si1password },
  infisical: { name: 'Infisical', file: 'infisical.ico' },
  doppler: { name: 'Doppler', file: 'doppler.svg' },
  vault: { name: 'HashiCorp Vault', icon: siVault },
  bitwarden: { name: 'Bitwarden Secrets', icon: siBitwarden },
  pulumi: { name: 'Pulumi ESC', icon: siPulumi },
  // Planning and monitoring
  linear: { name: 'Linear', icon: siLinear },
  sentry: { name: 'Sentry', icon: siSentry },
} as const satisfies Record<string, Brand>

export type BrandId = keyof typeof brands

function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

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
        className={cn('size-5 rounded-[5px] object-contain', className)}
      />
    )
  }
  const { icon } = brand
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      className={cn('size-5', className)}
      fill={luminance(icon.hex) < 0.3 ? 'currentColor' : `#${icon.hex}`}
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
