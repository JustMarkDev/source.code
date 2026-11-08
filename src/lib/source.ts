import { createElement } from 'react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BoltIcon,
  BookOpenIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  DocumentTextIcon,
  KeyIcon,
  LightBulbIcon,
  ListBulletIcon,
  LockClosedIcon,
  PlayIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  VariableIcon,
} from '@heroicons/react/24/outline'
import { defineDocs } from 'fumadocs-mdx/macro'
import { loader } from 'fumadocs-core/source'
import type { ComponentType, SVGProps } from 'react'
import { GitMergeIcon } from '~/components/icons'

// Docs pages name their icon in frontmatter (`icon: KeyIcon`). Same icon set as the app.
const icons: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BoltIcon,
  BookOpenIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  DocumentTextIcon,
  GitMergeIcon,
  KeyIcon,
  LightBulbIcon,
  ListBulletIcon,
  LockClosedIcon,
  PlayIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  VariableIcon,
}

export const docs = defineDocs({
  dir: 'content/docs',
})

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  icon(name) {
    const Icon = name
      ? (icons[name] as ComponentType<SVGProps<SVGSVGElement>> | undefined)
      : undefined
    return Icon ? createElement(Icon) : undefined
  },
})
