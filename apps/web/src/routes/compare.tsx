import { Link, createFileRoute } from '@tanstack/react-router'
import { CompareDetails, Legend } from '~/components/forge/compare-table'
import { Button } from '~/components/ui/button'
import { behind, checkedOn } from '~/lib/compare'

export const Route = createFileRoute('/compare')({
  head: () => ({
    meta: [
      {
        title:
          'source.code compared with GitHub, GitLab, Bitbucket, GitCafe and Forgejo',
      },
    ],
  }),
  component: Compare,
})

function Compare() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="max-w-2xl space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          How source.code compares
        </h1>
        <p className="text-lg text-muted-foreground text-balance">
          GitHub, GitLab, Bitbucket, GitCafe, Gitea and Forgejo are good
          products, and each has things we do not. This is where we differ, and
          where they are ahead or level.
        </p>
      </header>

      <section className="space-y-4" aria-labelledby="table">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="table" className="text-xl font-semibold tracking-tight">
            Row by row
          </h2>
          <Legend />
        </div>
        <CompareDetails />
        <p className="max-w-3xl text-sm text-muted-foreground">
          Checked against public documentation and announcements on {checkedOn}.
          Where we read a page, it is linked. “Not confirmed” means we could not
          confirm it from public documentation, which is not the same as no.
          Several of these are previews and move quickly. If something is out of
          date, tell us and we will fix it.
        </p>
      </section>

      <section className="max-w-2xl space-y-3" aria-labelledby="behind">
        <h2 id="behind" className="text-xl font-semibold tracking-tight">
          Where the others are ahead or level
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          {behind.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          If those matter more to you than the rest, one of them is the better
          choice, and your repositories are plain git either way.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="brand"
          size="lg"
          render={<Link to="/sign-up" />}
          nativeButton={false}
        >
          Start a trial
        </Button>
        <Button
          variant="ghost"
          size="lg"
          render={<Link to="/pricing" />}
          nativeButton={false}
        >
          See pricing
        </Button>
        <Button
          variant="ghost"
          size="lg"
          render={
            <Link
              to="/docs/$"
              params={{ _splat: 'getting-started/import-and-mirrors' }}
            />
          }
          nativeButton={false}
        >
          How leaving works
        </Button>
      </div>
    </div>
  )
}
