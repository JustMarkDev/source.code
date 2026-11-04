import { HomeIcon } from '@heroicons/react/24/outline'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-mono text-sm font-semibold tracking-tight">
          source.code
        </span>
      ),
      url: '/',
    },
    themeSwitch: { enabled: false },
    links: [{ text: 'Home', url: '/', icon: <HomeIcon /> }],
  }
}
