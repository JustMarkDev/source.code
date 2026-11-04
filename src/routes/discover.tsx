import { createFileRoute } from '@tanstack/react-router'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from 'cn'
import type { Category } from '~/mock/data'
import { Stagger } from '~/components/motion'
import { DeveloperRow, RepoRow } from '~/components/forge/repo-card'
import { LangDot } from '~/components/forge/bits'
import { Input, Select } from '~/components/ui/input'
import { StateTabs } from '~/components/ui/tabs'
import { categories, developers, repos } from '~/mock/data'

type View = 'projects' | 'people'
type Sort = 'trending' | 'stars' | 'updated'

type Search = {
  q?: string
  category?: Category
  lang?: string
  sort?: Sort
  view?: View
}

export const Route = createFileRoute('/discover')({
  head: () => ({ meta: [{ title: 'Discover · source.code' }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    category: categories.find((c) => c === s.category),
    lang: typeof s.lang === 'string' && s.lang ? s.lang : undefined,
    sort: (['trending', 'stars', 'updated'] as const).find((x) => x === s.sort),
    view: s.view === 'people' ? 'people' : undefined,
  }),
  component: Discover,
})

const languages = Array.from(new Set(repos.map((r) => r.language))).sort()

function FilterList<T extends string>({
  title,
  value,
  options,
  onChange,
  render,
}: {
  title: string
  value: T | undefined
  options: ReadonlyArray<T>
  onChange: (v: T | undefined) => void
  render?: (v: T) => React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(value === o ? undefined : o)}
          className={cn(
            'flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            value === o && 'bg-muted font-medium text-foreground',
          )}
        >
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  )
}

function Discover() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    q = '',
    category,
    lang,
    sort = 'trending',
    view = 'projects',
  } = search
  const set = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) })

  const query = q.trim().toLowerCase()
  const projects = repos
    .filter(
      (r) =>
        (!query ||
          `${r.owner}/${r.name} ${r.description}`
            .toLowerCase()
            .includes(query)) &&
        (!category || r.category === category) &&
        (!lang || r.language === lang),
    )
    .sort((a, b) =>
      sort === 'stars'
        ? b.stars - a.stars
        : sort === 'updated'
          ? a.updated.localeCompare(b.updated)
          : b.starsToday - a.starsToday,
    )
  const people = developers.filter(
    (d) =>
      !query || `${d.name} ${d.handle} ${d.bio}`.toLowerCase().includes(query),
  )
  const filtered = !!(q || category || lang)

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <div className="relative max-w-xl">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder="Search projects and people"
            aria-label="Search projects and people"
            className="h-10 pl-9"
          />
        </div>
      </header>

      <StateTabs
        label="What to browse"
        value={view}
        onChange={(v) => set({ view: v === 'people' ? 'people' : undefined })}
        options={[
          { id: 'projects', label: 'Projects', count: projects.length },
          { id: 'people', label: 'People', count: people.length },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        {view === 'projects' && (
          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <FilterList
              title="Category"
              value={category}
              options={categories}
              onChange={(v) => set({ category: v })}
            />
            <FilterList
              title="Language"
              value={lang}
              options={languages}
              onChange={(v) => set({ lang: v })}
              render={(l) => <LangDot language={l} />}
            />
          </aside>
        )}

        <section
          className={cn(
            'min-w-0 space-y-3',
            view === 'people' && 'lg:col-span-2',
          )}
        >
          {view === 'projects' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {filtered ? `${projects.length} results` : 'Popular this week'}
                {(category || lang) && (
                  <button
                    type="button"
                    onClick={() =>
                      set({ category: undefined, lang: undefined })
                    }
                    className="ml-3 inline-flex items-center gap-1 text-foreground hover:underline"
                  >
                    <XMarkIcon className="size-3.5" /> Clear filters
                  </button>
                )}
              </p>
              <Select
                value={sort}
                onChange={(e) =>
                  set({
                    sort:
                      e.target.value === 'stars' || e.target.value === 'updated'
                        ? e.target.value
                        : undefined,
                  })
                }
                aria-label="Sort"
                className="w-44"
              >
                <option value="trending">Trending</option>
                <option value="stars">Most stars</option>
                <option value="updated">Recently updated</option>
              </Select>
            </div>
          )}

          <Stagger className="divide-y overflow-hidden rounded-xl border bg-card">
            {view === 'projects' &&
              projects.map((r) => (
                <RepoRow
                  key={`${r.owner}/${r.name}`}
                  repo={r}
                  showToday={sort === 'trending'}
                />
              ))}
            {view === 'people' &&
              people.map((d) => <DeveloperRow key={d.handle} dev={d} />)}
            {((view === 'projects' && projects.length === 0) ||
              (view === 'people' && people.length === 0)) && (
              <p className="p-10 text-center text-sm text-muted-foreground">
                Nothing matches. Try fewer words or clear the filters.
              </p>
            )}
          </Stagger>
        </section>
      </div>
    </div>
  )
}
