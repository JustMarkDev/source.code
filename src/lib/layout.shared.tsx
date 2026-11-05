import { HomeIcon } from '@heroicons/react/24/outline'
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="-my-1.5 block py-1.5 font-mono text-sm font-semibold tracking-tight">
          source.code
        </span>
      ),
      url: '/',
    },
    themeSwitch: { enabled: false },
    links: [{ text: 'Home', url: '/', icon: <HomeIcon /> }],
  }
}
