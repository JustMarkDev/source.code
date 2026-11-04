import { HomeIcon } from '@heroicons/react/24/outline'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-brand-foreground">
            {'{}'}
          </span>
          source.code
        </span>
      ),
      url: '/',
    },
    themeSwitch: { enabled: false },
    links: [{ text: 'Home', url: '/', icon: <HomeIcon /> }],
  }
}
