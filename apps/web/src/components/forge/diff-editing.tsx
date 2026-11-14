import * as React from 'react'
import { EditProvider } from '@pierre/diffs/react'
import type { EditorFactory } from '@pierre/diffs/react'

/**
 * Pierre's editor is loaded the first time someone edits, not with the page.
 * Until it arrives `factory` is undefined and a diff should stay read-only.
 */
export function useEditorFactory(wanted: boolean) {
  const [factory, setFactory] = React.useState<EditorFactory<any, any>>()
  React.useEffect(() => {
    if (!wanted || factory) return
    let live = true
    void import('@pierre/diffs/edit').then(({ Editor }) => {
      if (live)
        setFactory(
          () =>
            ((type: 'file' | 'file-diff', options: object, key?: string) =>
              new Editor(type, options, key)) as EditorFactory<any, any>,
        )
    })
    return () => {
      live = false
    }
  }, [wanted, factory])
  return factory
}

export function EditingProvider({
  factory,
  children,
}: {
  factory: EditorFactory<any, any> | undefined
  children: React.ReactNode
}) {
  if (!factory) return <>{children}</>
  return <EditProvider createEditor={factory}>{children}</EditProvider>
}
