import { createFileRoute, redirect } from '@tanstack/react-router'

/** A repository's address opens its code. */
export const Route = createFileRoute('/$handle/$repo/')({
  beforeLoad: ({ params, search }) => {
    const { path } = search as { path?: unknown }
    throw redirect({
      to: '/$handle/$repo/$tab',
      params: { ...params, tab: 'code' },
      search: typeof path === 'string' && path ? { path } : {},
    })
  },
})
