import { createFileRoute } from '@tanstack/react-router'
import { RequireAuth } from '~/components/forge/auth'
import { PageTitle } from '~/components/forge/bits'
import { NewOrganizationForm } from '~/components/forge/organization'

export const Route = createFileRoute('/organizations/new')({
  head: () => ({ meta: [{ title: 'New organization · source.code' }] }),
  component: () => (
    <RequireAuth>
      <div className="mx-auto max-w-xl">
        <PageTitle title="New organization">
          For a company, a team or a project. It owns its repositories, and
          people join it with a role.
        </PageTitle>
        <NewOrganizationForm />
      </div>
    </RequireAuth>
  ),
})
