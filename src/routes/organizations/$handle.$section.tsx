import { createFileRoute, notFound } from '@tanstack/react-router'
import type { OrgSection } from '~/components/forge/organization'
import { RequireAuth } from '~/components/forge/auth'
import { OrgSettings, orgSections } from '~/components/forge/organization'

export const Route = createFileRoute('/organizations/$handle/$section')({
  head: () => ({ meta: [{ title: 'Organization settings · source.code' }] }),
  component: OrganizationSettings,
})

function OrganizationSettings() {
  const { handle, section } = Route.useParams()
  const known = orgSections.find(([id]) => id === section)?.[0]
  if (!known) throw notFound()
  return (
    <RequireAuth>
      <OrgSettings handle={handle} section={known satisfies OrgSection} />
    </RequireAuth>
  )
}
