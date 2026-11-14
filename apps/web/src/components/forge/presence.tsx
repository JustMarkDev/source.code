import * as React from 'react'
import { CpuChipIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import { Tile } from './bits'
import { useOpMaybe, useWrite } from '~/lib/forge'
import { useMe } from '~/lib/auth/accounts'

/**
 * Who else is looking at a change or an issue. While the page is open it
 * sends a heartbeat every interval with the file in view, and says it left
 * when it closes. Each page is in its own room only.
 */

type At = { owner: string; repo: string; number: string }
type Kind = 'change' | 'issue'

export type Viewer = {
  actor: { handle: string; class: 'human' | 'agent' | 'bot' }
  path: string | null
}

/** One id per tab, so two tabs of yours are two sessions of one viewer. */
const tab =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `web-${crypto.randomUUID().slice(0, 13)}`
    : `web-${Math.random().toString(36).slice(2, 15)}`

export function usePresence(
  kind: Kind,
  at: At,
  path: string | null,
  /** Off for someone signed out: presence is for people with an account. */
  enabled = true,
): Array<Viewer> {
  const write = useWrite()
  const op = kind === 'change' ? 'changes.presence' : 'issues.presence'
  const input = kind === 'change' ? at : { ...at, number: Number(at.number) }
  const listed = useOpMaybe(
    `${op}.get` as 'changes.presence.get',
    input as At,
    enabled,
  )
  const interval = (listed?.interval ?? 20) * 1000
  // The heartbeat always sends the newest path without restarting its timer.
  const where = React.useRef(path)
  const key = `${at.owner}/${at.repo}/${kind}/${at.number}`
  React.useEffect(() => {
    where.current = path
    if (!enabled) return
    void write(`${op}.put` as 'changes.presence.put', {
      ...(input as At),
      body: { session: tab, path, leave: false },
    })
    // Only a move to another file sends one at once.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `at`
  }, [path, key, enabled])
  React.useEffect(() => {
    if (!enabled) return
    const beat = () => {
      if (document.visibilityState === 'hidden') return
      void write(`${op}.put` as 'changes.presence.put', {
        ...(input as At),
        body: { session: tab, path: where.current, leave: false },
      })
    }
    const timer = window.setInterval(beat, interval)
    document.addEventListener('visibilitychange', beat)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
      void write(`${op}.put` as 'changes.presence.put', {
        ...(input as At),
        body: { session: tab, path: null, leave: true },
      })
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `at`
  }, [key, interval, enabled])
  if (!enabled) return []
  return listed?.viewers ?? []
}

/** The others looking, as a row of faces; agents carry a chip mark. */
export function Viewers({ viewers }: { viewers: Array<Viewer> }) {
  const me = useMe()
  const others = viewers.filter(
    (v) => !(v.actor.class === 'human' && v.actor.handle === me?.handle),
  )
  if (!others.length) return null
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      aria-label="Also looking"
    >
      <div className="flex -space-x-1.5">
        {others.slice(0, 6).map((v) => (
          <Face key={`${v.actor.handle}:${v.actor.class}`} v={v} />
        ))}
      </div>
      <span>
        {others.length === 1
          ? `${others[0].actor.handle} is here`
          : `${others.length} others here`}
      </span>
    </div>
  )
}

function Face({ v, small }: { v: Viewer; small?: boolean }) {
  const title = `${v.actor.handle}${v.actor.class === 'human' ? '' : ` (${v.actor.class})`}${v.path ? ` on ${v.path}` : ''}`
  if (v.actor.class === 'human')
    return (
      <span title={title} className="rounded-full ring-2 ring-background">
        <Tile
          name={v.actor.handle}
          round
          className={small ? 'size-4 text-[9px]' : 'size-6 text-xs'}
        />
      </span>
    )
  return (
    <span
      title={title}
      className={cn(
        'flex items-center justify-center rounded-full bg-info/12 text-info ring-2 ring-background',
        small ? 'size-4' : 'size-6',
      )}
    >
      <CpuChipIcon className={small ? 'size-2.5' : 'size-3.5'} />
    </span>
  )
}

/** Who else has this file in view, for a file's header. */
export function FileViewers({
  viewers,
  path,
}: {
  viewers: Array<Viewer>
  path: string
}) {
  const me = useMe()
  const here = viewers.filter(
    (v) =>
      v.path === path &&
      !(v.actor.class === 'human' && v.actor.handle === me?.handle),
  )
  if (!here.length) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex -space-x-1">
        {here.map((v) => (
          <Face key={`${v.actor.handle}:${v.actor.class}`} v={v} small />
        ))}
      </span>
      {here.length === 1
        ? `${here[0].actor.handle} is on this file`
        : `${here.length} others on this file`}
    </span>
  )
}

/**
 * The file nearest the top of the screen among `[data-presence-file]`
 * elements, for the heartbeat to name.
 */
export function useFileInView(enabled: boolean): string | null {
  const [file, setFile] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!enabled) {
      setFile(null)
      return
    }
    const seen = new Map<Element, IntersectionObserverEntry>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e)
        const top = [...seen.values()]
          .filter((e) => e.isIntersecting)
          .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)
          .at(0)
        setFile(top?.target.getAttribute('data-presence-file') ?? null)
      },
      { rootMargin: '-80px 0px -40% 0px' },
    )
    const watch = () =>
      document
        .querySelectorAll('[data-presence-file]')
        .forEach((el) => io.observe(el))
    watch()
    const mo = new MutationObserver(watch)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [enabled])
  return file
}
