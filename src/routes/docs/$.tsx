import * as React from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { docs, source } from '~/lib/source'
import { baseOptions } from '~/lib/layout.shared'
import { useMDXComponents } from '~/components/mdx'

export const Route = createFileRoute('/docs/$')({
  head: () => ({ meta: [{ title: 'Docs · source.code' }] }),
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? []
    const data = await serverLoader({ data: slugs })
    return data
  },
})

const serverLoader = createServerFn({ method: 'GET' })
  .validator((slugs: Array<string>) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()
    return {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

/**
 * Fumadocs draws its own page furniture. It leaves the table of contents
 * outside any landmark, has two banners, and gives every scrollable code block
 * the same unnamed region. Name them once the page is there, so a screen
 * reader's landmark list reads as one page.
 */
function useDocsLandmarks(path: string) {
  React.useEffect(() => {
    document.getElementById('nd-toc')?.setAttribute('role', 'complementary')
    document
      .getElementById('nd-toc')
      ?.setAttribute('aria-label', 'On this page')
    // The sidebar's header is part of the navigation, not a second page banner.
    document
      .querySelectorAll('#nd-sidebar header')
      .forEach((h) => h.setAttribute('role', 'none'))
    document
      .querySelectorAll('figure [role="region"]:not([aria-label])')
      .forEach((el, i) => el.setAttribute('aria-label', `Code sample ${i + 1}`))
  }, [path])
}

function Content({ path }: { path: string }) {
  useDocsLandmarks(path)
  const page = docs.getPage(path)
  if (!page) throw new Error(`unknown page: ${path}`)
  const MDX = page.body
  return (
    <DocsPage toc={page.toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

function Page() {
  const data = useFumadocsLoader(Route.useLoaderData())
  return (
    <DocsLayout {...baseOptions()} tree={data.pageTree}>
      <Content path={data.path} />
    </DocsLayout>
  )
}
