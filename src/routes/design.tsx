import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowDownTrayIcon,
  ArrowRightIcon,
  BellIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  KeyIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  StarIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import type { BrandId } from '~/components/brand'
import type { BadgeTone } from '~/components/ui/badge'
import {
  GitBranchIcon,
  GitCommitIcon,
  GitForkIcon,
  GitMergeIcon,
} from '~/components/icons'
import { BrandLogo, brandName, brands } from '~/components/brand'
import {
  GroupedBars,
  ShapeRadar,
  ShareDonut,
  TrendChart,
} from '~/components/charts'
import { Sparkline } from '~/components/dither-kit'
import { Kbd, LangDot, Tile } from '~/components/forge/bits'
import { DeveloperRow, RepoCard, RepoRow } from '~/components/forge/repo-card'
import { CopyField } from '~/components/forge/repo-shell'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Callout } from '~/components/ui/callout'
import { Modal } from '~/components/ui/dialog'
import { Field, Input, Select, Textarea } from '~/components/ui/input'
import { Dropdown, MenuItem, MenuSeparator } from '~/components/ui/menu'
import { Switch, SwitchRow } from '~/components/ui/switch'
import { Segmented, StateTabs } from '~/components/ui/tabs'
import { Tip } from '~/components/ui/tooltip'
import { developers, repos } from '~/mock/data'

export const Route = createFileRoute('/design')({
  head: () => ({ meta: [{ title: 'Design system · source.code' }] }),
  component: Design,
})

const sections = [
  ['principles', 'Principles'],
  ['colour', 'Colour'],
  ['type', 'Type and shape'],
  ['brand', 'Brand logos'],
  ['icons', 'Icons'],
  ['buttons', 'Buttons'],
  ['badges', 'Badges'],
  ['forms', 'Forms'],
  ['navigation', 'Navigation'],
  ['overlays', 'Overlays'],
  ['charts', 'Charts'],
  ['patterns', 'Patterns'],
] as const

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-5">
      <div className="space-y-1 border-b pb-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {note && (
          <p className="max-w-[65ch] text-sm text-muted-foreground">{note}</p>
        )}
      </div>
      {children}
    </section>
  )
}

/** A specimen with a caption and where it lives in the code. */
function Specimen({
  label,
  source,
  children,
  className,
}: {
  label: string
  source?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        {source && (
          <code className="font-mono text-muted-foreground">{source}</code>
        )}
      </div>
      <div
        className={
          className ??
          'flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5'
        }
      >
        {children}
      </div>
    </div>
  )
}

const swatches: Array<[string, string, string]> = [
  ['background', 'bg-background', 'The page'],
  ['card', 'bg-card', 'Panels and rows'],
  ['muted', 'bg-muted', 'Quiet fills, hover'],
  ['primary', 'bg-primary', 'Ink: default buttons'],
  ['brand', 'bg-brand', 'The one primary action'],
  ['border', 'bg-border', 'Hairlines'],
]
const tones: Array<[BadgeTone, string]> = [
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['danger', 'bg-danger'],
  ['info', 'bg-info'],
  ['merged', 'bg-merged'],
]

const sampleSeries = Array.from({ length: 12 }, (_, i) => ({
  label: `W${i + 1}`,
  value: 20 + ((i * 17) % 23) + i * 2,
}))

function Design() {
  const [on, setOn] = React.useState(true)
  const [tab, setTab] = React.useState<'a' | 'b' | 'c'>('a')
  const [mode, setMode] = React.useState<'list' | 'grid'>('list')
  const [open, setOpen] = React.useState(false)
  const logoIds = Object.keys(brands) as Array<BrandId>

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav
        aria-label="On this page"
        className="hidden space-y-0.5 text-sm lg:sticky lg:top-20 lg:block lg:self-start"
      >
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="block rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="min-w-0 space-y-16">
        <header className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">
              Design system
            </h1>
          </div>
          <p className="max-w-[65ch] text-muted-foreground">
            Everything the product is built from, in one place. Components are
            shadcn/ui underneath, on Base UI, restyled with our own tokens and
            variants. Icons are Heroicons. Charts are Dither Kit. Brand logos
            are the vendors&apos; own.
          </p>
        </header>

        <Section
          id="principles"
          title="Principles"
          note="Five rules that decide most design questions."
        >
          <ol className="grid gap-4 sm:grid-cols-2">
            {[
              [
                'One next step',
                'Each screen has one primary action, drawn in brand lime. Everything else is quiet.',
              ],
              [
                'Structure is felt, not seen',
                'Whitespace and weight separate things before lines and boxes do. Borders are hairlines.',
              ],
              [
                'Earn attention',
                'Icons, colour and badges appear only when they carry meaning. Most rows are plain text.',
              ],
              [
                'Say it in words',
                'Plain labels in sentence case. No decoration in headings, no jargon in buttons.',
              ],
              [
                'Same everywhere',
                'A thing you can connect, a thing you can toggle, a thing that failed: each looks the same on every page.',
              ],
            ].map(([t, d], i) => (
              <li key={t} className="space-y-1 rounded-xl border bg-card p-4">
                <div className="font-mono text-xs text-muted-foreground">
                  0{i + 1}
                </div>
                <div className="text-sm font-medium">{t}</div>
                <p className="text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="colour"
          title="Colour"
          note="Semantic tokens that flip with the theme, so components never need dark: variants. Brand lime is for the primary action, the current item and charts."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {swatches.map(([name, cls, note]) => (
              <div key={name} className="space-y-2">
                <div className={`h-14 rounded-xl border ${cls}`} />
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">{note}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {tones.map(([name, cls]) => (
              <span key={name} className="flex items-center gap-2 text-sm">
                <span className={`size-3 rounded-full ${cls}`} />
                {name}
              </span>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="Type and shape"
          note="Geist for text, Geist Mono for code, names and ids. Panels round to 12px, controls to 8px, badges to 6px."
        >
          <div className="space-y-4 rounded-xl border bg-card p-5">
            <div className="text-2xl font-semibold tracking-tight">
              Page title, 24 semibold
            </div>
            <div className="text-lg font-semibold tracking-tight">
              Section title, 18 semibold
            </div>
            <div className="text-sm font-medium">Block heading, 14 medium</div>
            <p className="text-sm">
              Body text, 14. The default for almost everything.
            </p>
            <p className="text-sm text-muted-foreground">
              Secondary text, 14, muted. Explains the thing above it.
            </p>
            <p className="font-mono text-xs">dana/gitfs · ch_7f3a · v1.4.0</p>
          </div>
        </Section>

        <Section
          id="brand"
          title="Brand logos"
          note="Simple Icons where the vendor is listed there, the vendor's own icon file otherwise. Hosts show only on private screens."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {logoIds.map((id) => (
              <li
                key={id}
                className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm"
              >
                <BrandLogo id={id} />
                <span className="truncate">{brandName(id)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="icons"
          title="Icons"
          note="Heroicons, 24 outline, sized with size-4 in text and size-5 on tiles. Heroicons has no version-control glyphs, so four are drawn to match."
        >
          <Specimen label="Heroicons" source="@heroicons/react/24/outline">
            {[
              MagnifyingGlassIcon,
              BellIcon,
              PlusIcon,
              Cog6ToothIcon,
              StarIcon,
              LockClosedIcon,
              KeyIcon,
              ShieldCheckIcon,
              CpuChipIcon,
              CommandLineIcon,
              UsersIcon,
              CheckCircleIcon,
              ArrowDownTrayIcon,
              ArrowRightIcon,
            ].map((Icon, i) => (
              <Icon key={i} className="size-5" />
            ))}
          </Specimen>
          <Specimen
            label="Version control, drawn to match"
            source="~/components/icons"
          >
            <GitBranchIcon className="size-5" />
            <GitCommitIcon className="size-5" />
            <GitForkIcon className="size-5" />
            <GitMergeIcon className="size-5" />
          </Specimen>
        </Section>

        <Section
          id="buttons"
          title="Buttons"
          note="One brand button per screen. Variants: brand, default, outline, ghost, danger, link."
        >
          <Specimen label="Variants" source="~/components/ui/button">
            <Button variant="brand">Land change</Button>
            <Button variant="default">Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </Specimen>
          <Specimen label="Sizes and icons">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg" variant="brand">
              Large
            </Button>
            <Button>
              <PlusIcon /> With icon
            </Button>
            <Tip label="Settings">
              <Button size="icon" aria-label="Settings">
                <Cog6ToothIcon />
              </Button>
            </Tip>
          </Specimen>
        </Section>

        <Section
          id="badges"
          title="Badges"
          note="Status and metadata. Colour means something: green is good, amber needs a look, red is broken."
        >
          <Specimen label="Tones" source="~/components/ui/badge">
            {(
              [
                'muted',
                'outline',
                'success',
                'warning',
                'danger',
                'info',
                'merged',
                'brand',
              ] as const
            ).map((t) => (
              <Badge key={t} tone={t}>
                {t}
              </Badge>
            ))}
          </Specimen>
          <Specimen label="Other small parts">
            <Kbd>⌘K</Kbd>
            <LangDot language="Rust" />
            <LangDot language="TypeScript" />
            <Tile name="Dana" round />
            <Tile name="gitfs" />
          </Specimen>
        </Section>

        <Section
          id="forms"
          title="Forms"
          note="A label, a control, one line of help. That is every form."
        >
          <div className="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2">
            <Field label="Name" hint="Letters, numbers and dashes.">
              <Input defaultValue="gitfs" />
            </Field>
            <Field label="Visibility">
              <Select defaultValue="public">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea defaultValue="Git over object storage." />
            </Field>
            <div className="space-y-4 sm:col-span-2">
              <SwitchRow
                checked={on}
                onChange={setOn}
                label="Sign release files"
                hint="Adds a signature and checksum to every asset."
              />
              <div className="flex items-center gap-3 text-sm">
                <Switch
                  checked={!on}
                  onCheckedChange={(v) => setOn(!v)}
                  aria-label="Bare switch"
                />{' '}
                A bare switch
              </div>
            </div>
            <div className="sm:col-span-2">
              <CopyField value="sx change create" />
            </div>
          </div>
        </Section>

        <Section
          id="navigation"
          title="Navigation"
          note="Tabs for places (each is a link), segmented controls for modes."
        >
          <Specimen
            label="State tabs"
            source="~/components/ui/tabs"
            className="rounded-xl border bg-card p-5"
          >
            <div className="w-full space-y-5">
              <StateTabs
                label="Example"
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'a', label: 'Overview' },
                  { id: 'b', label: 'Changes', count: 5 },
                  { id: 'c', label: 'Settings' },
                ]}
              />
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  ['list', 'List'],
                  ['grid', 'Grid'],
                ]}
              />
            </div>
          </Specimen>
        </Section>

        <Section
          id="overlays"
          title="Overlays"
          note="Dialogs for decisions, menus for lists of actions, tooltips for icon-only controls."
        >
          <Specimen label="Dialog, menu, callout">
            <Button onClick={() => setOpen(true)}>Open dialog</Button>
            <Dropdown align="start" trigger={<Button>Menu</Button>}>
              <MenuItem>Profile</MenuItem>
              <MenuItem>Settings</MenuItem>
              <MenuSeparator />
              <MenuItem>Sign out</MenuItem>
            </Dropdown>
            <Modal
              open={open}
              onClose={() => setOpen(false)}
              title="Connect CodeRabbit"
              description="Line-by-line review of each change, with a summary."
            >
              <Callout tone="info">
                It will be able to read code and comment on changes.
              </Callout>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="brand" onClick={() => setOpen(false)}>
                  Connect
                </Button>
              </div>
            </Modal>
          </Specimen>
          <div className="grid gap-3 sm:grid-cols-3">
            <Callout tone="info" title="Info">
              Neutral guidance.
            </Callout>
            <Callout tone="success" title="Success">
              It worked.
            </Callout>
            <Callout tone="warning" title="Warning">
              Needs a look.
            </Callout>
          </div>
        </Section>

        <Section
          id="charts"
          title="Charts"
          note="Dither Kit. Ordered-dither canvas charts that give data texture without chart-junk. Always in a parent with a height."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <Specimen
              label="Trend"
              source="TrendChart"
              className="h-56 rounded-xl border bg-card p-3"
            >
              <TrendChart
                data={sampleSeries}
                unit="Commits"
                className="h-full"
              />
            </Specimen>
            <Specimen
              label="Grouped bars"
              source="GroupedBars"
              className="h-56 rounded-xl border bg-card p-3"
            >
              <GroupedBars
                data={['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label, i) => ({
                  label,
                  commits: 20 + i * 7,
                  reviews: 10 + ((i * 5) % 12),
                }))}
                series={[
                  { key: 'commits', label: 'Commits', color: 'green' },
                  { key: 'reviews', label: 'Reviews', color: 'blue' },
                ]}
              />
            </Specimen>
            <Specimen
              label="Share"
              source="ShareDonut"
              className="h-56 rounded-xl border bg-card p-3"
            >
              <ShareDonut
                data={[
                  { name: 'Rust', value: 62 },
                  { name: 'TypeScript', value: 24 },
                  { name: 'Shell', value: 14 },
                ]}
              />
            </Specimen>
            <Specimen
              label="Shape"
              source="ShapeRadar"
              className="h-56 rounded-xl border bg-card p-3"
            >
              <ShapeRadar
                data={[
                  { axis: 'Commits', value: 46 },
                  { axis: 'Reviews', value: 28 },
                  { axis: 'Changes', value: 16 },
                  { axis: 'Issues', value: 9 },
                  { axis: 'Releases', value: 5 },
                ]}
              />
            </Specimen>
          </div>
          <Specimen label="Sparkline, for dense rows" source="Sparkline">
            <div className="h-10 w-40">
              <Sparkline
                data={sampleSeries.map((p) => p.value)}
                color="green"
              />
            </div>
            <div className="h-10 w-40">
              <Sparkline
                data={sampleSeries.map((p) => 60 - p.value)}
                color="blue"
              />
            </div>
          </Specimen>
        </Section>

        <Section
          id="patterns"
          title="Patterns"
          note="Larger parts built from the pieces above. The same row shape shows up wherever a list of things appears."
        >
          <Specimen
            label="Project row"
            source="RepoRow"
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="w-full divide-y">
              <RepoRow repo={repos[0]} showToday />
              <RepoRow repo={repos[1]} />
            </div>
          </Specimen>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Specimen label="Project card" source="RepoCard" className="">
              <RepoCard repo={repos[2]} />
            </Specimen>
            <Specimen
              label="Person row"
              source="DeveloperRow"
              className="overflow-hidden rounded-xl border bg-card"
            >
              <div className="w-full">
                <DeveloperRow dev={developers[1]} />
              </div>
            </Specimen>
          </div>
          <Specimen
            label="Row with a status and one action"
            className="overflow-hidden rounded-xl border bg-card"
          >
            <ul className="w-full divide-y">
              {[
                ['CodeRabbit', 'coderabbit', true],
                ['Blacksmith', 'blacksmith', false],
              ].map(([name, id, connected]) => (
                <li key={String(id)} className="flex items-center gap-3 p-4">
                  <span className="flex size-9 items-center justify-center rounded-lg border bg-card">
                    <BrandLogo id={id as BrandId} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {String(name)}
                      {connected && <Badge tone="success">Connected</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      One line that says what it does.
                    </p>
                  </div>
                  <Button size="sm">
                    {connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </li>
              ))}
            </ul>
          </Specimen>
        </Section>
      </div>
    </div>
  )
}
