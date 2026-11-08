// How source.code compares with other hosts. This is a claim about other
// people's products, so every row is kept short, says what we could confirm,
// and links the page it came from where we read one. Rows where we are behind
// stay in: a comparison that only lists wins is not one.
//
// Review the date and the sources whenever a product ships something.

import { trial } from './pricing'

export const checkedOn = 'November 5 to 7, 2026'

export type Product =
  | 'us'
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'gitcafe'
  | 'forgejo'

export const products: Array<{ id: Product; name: string; note?: string }> = [
  { id: 'us', name: 'source.code' },
  { id: 'github', name: 'GitHub' },
  { id: 'gitlab', name: 'GitLab' },
  { id: 'bitbucket', name: 'Bitbucket' },
  { id: 'gitcafe', name: 'GitCafe', note: 'In public beta' },
  { id: 'forgejo', name: 'Gitea and Forgejo', note: 'Includes Codeberg' },
]

/** `unclear` is for what we could not confirm from public documentation. */
export type Level = 'yes' | 'partly' | 'no' | 'unclear'

export const levelLabel: Record<Level, string> = {
  yes: 'Yes',
  partly: 'In part',
  no: 'No',
  unclear: 'Not confirmed',
}

export type Source = { label: string; href: string }

export type Cell = {
  level: Level
  text: string
  /** Pages we read. Community reports are named as such. */
  sources?: Array<Source>
}

export type Row = {
  id: string
  topic: string
  question: string
  cells: Record<Product, Cell>
}

export const rows: Array<Row> = [
  {
    id: 'rewrites',
    topic: 'Review',
    question: 'Compare a change before and after it is rewritten',
    cells: {
      us: {
        level: 'yes',
        text: 'A change keeps its number. Patch sets are numbered, and any two can be compared, so a reviewer reads only what is new.',
      },
      github: {
        level: 'partly',
        text: 'Compare links on force-push events, and “changes since last review”, which can lose its place after a rewrite.',
        sources: [
          {
            label: 'Community report',
            href: 'https://dev.to/pyor/re-reviewing-a-pr-after-changes-the-interdiff-problem-26i6',
          },
          {
            label: 'Zephyr pull request thread',
            href: 'https://github.com/zephyrproject-rtos/zephyr/pull/14444',
          },
        ],
      },
      gitlab: {
        level: 'yes',
        text: 'A diff version for each push, comparable from the Changes tab. The merge request is still tied to its branch.',
        sources: [
          {
            label: 'GitLab docs: diff versions',
            href: 'https://docs.gitlab.com/user/project/merge_requests/versions',
          },
        ],
      },
      bitbucket: {
        level: 'no',
        text: 'Review by commit with the change scope selector. We found no way to compare a branch across a force push. A request for it was closed as Won’t Fix in 2022.',
        sources: [
          {
            label: 'Atlassian issue BCLOUD-13397',
            href: 'https://jira.atlassian.com/browse/BCLOUD-13397',
          },
        ],
      },
      gitcafe: {
        level: 'unclear',
        text: 'Diffs and feedback beside the code. We found nothing about comparing a change across rewrites in its documentation.',
        sources: [{ label: 'git.cafe', href: 'https://git.cafe/' }],
      },
      forgejo: {
        level: 'unclear',
        text: 'A pull request is its branch. We did not find a comparison that follows a rewrite in the upstream documentation.',
      },
    },
  },
  {
    id: 'stacks',
    topic: 'Review',
    question: 'Stacked changes that land in order',
    cells: {
      us: {
        level: 'yes',
        text: 'A stack lands bottom first. Children are rebased onto the result and keep their approvals.',
      },
      github: {
        level: 'partly',
        text: 'Stacked pull requests are in public preview, with a CLI extension. Merge queue support is arriving in steps.',
        sources: [
          {
            label: 'InfoQ, April 2026',
            href: 'https://infoq.com/news/2026/04/github-stacked-prs',
          },
          {
            label: 'IT Brief, public preview',
            href: 'https://itbrief.co.uk/story/github-puts-stacked-pull-requests-into-public-preview',
          },
        ],
      },
      gitlab: {
        level: 'partly',
        text: '`glab stack` is experimental. Each merge request targets the one before it.',
        sources: [
          {
            label: 'GitLab docs: stacked diffs',
            href: 'https://docs.gitlab.com/user/project/merge_requests/stacked_diffs/',
          },
        ],
      },
      bitbucket: {
        level: 'no',
        text: 'No stacked pull requests that we found.',
      },
      gitcafe: {
        level: 'yes',
        text: 'A stack is a chain of open pull requests. Each targets the one below, and they merge in order. Jujutsu and Sapling are supported. How a stack is rebased as it lands is not documented that we found.',
        sources: [
          { label: 'git.cafe', href: 'https://git.cafe/' },
          { label: 'GitCafe docs summary', href: 'https://git.cafe/llms.txt' },
        ],
      },
      forgejo: {
        level: 'no',
        text: 'No stacked workflow that we found. AGit flow can open and update a pull request with a push.',
      },
    },
  },
  {
    id: 'agents',
    topic: 'Agents',
    question: 'Any model, harness or agent, under the same rules as people',
    cells: {
      us: {
        level: 'yes',
        text: 'Any of them, over the CLI or MCP, with scoped tokens and the same policies. We never resell tokens, so there is no markup.',
      },
      github: {
        level: 'partly',
        text: 'Agent HQ runs Copilot, Claude and Codex in public preview. Each session uses a premium request on a Copilot plan.',
        sources: [
          {
            label: 'GitHub blog, February 2026',
            href: 'https://github.blog/2026-02-04-pick-your-agent-use-claude-and-codex-on-agent-hq/',
          },
        ],
      },
      gitlab: {
        level: 'partly',
        text: 'Duo Agent Platform. Admins can connect third-party or self-hosted models through the AI Gateway.',
        sources: [
          {
            label: 'GitLab blog, February 2026',
            href: 'https://about.gitlab.com/blog/agentic-ai-enterprise-control-self-hosted-duo-agent-platform-and-byom/',
          },
        ],
      },
      bitbucket: {
        level: 'partly',
        text: 'Rovo Dev reviews pull requests and runs agentic steps in Pipelines. It needs a Rovo Dev subscription. The model is not named, and bring-your-own is not stated.',
        sources: [
          {
            label: 'Atlassian: Rovo Dev code review',
            href: 'https://www.atlassian.com/software/rovo-dev/code-review',
          },
          {
            label: 'Atlassian blog, November 2025',
            href: 'https://www.atlassian.com/blog/bitbucket/ai-powered-workflows-rovodev',
          },
        ],
      },
      gitcafe: {
        level: 'partly',
        text: 'A CLI with installable agent skills, and an MCP server for tools such as Claude and ChatGPT. We found no mention of agent accounts, scoped policies or token pricing.',
        sources: [
          { label: 'git.cafe', href: 'https://git.cafe/' },
          { label: 'GitCafe docs summary', href: 'https://git.cafe/llms.txt' },
        ],
      },
      forgejo: {
        level: 'no',
        text: 'No built-in agent platform that we found. Community projects add AI review with models you run.',
        sources: [
          {
            label: 'Community report',
            href: 'https://github.com/kernelle-soft/shellshock/issues/35',
          },
        ],
      },
    },
  },
  {
    id: 'mirrors',
    topic: 'Leaving',
    question: 'Mirror to another host and keep a copy there',
    cells: {
      us: {
        level: 'yes',
        text: 'Import from other hosts and mirror back out, one way or two. Issues, changes and releases can travel with the code.',
      },
      github: {
        level: 'partly',
        text: 'An importer for code and history. We found no built-in mirror out, so people script `git push --mirror`.',
        sources: [
          {
            label: 'GitHub docs issue',
            href: 'https://github.com/github/docs/issues/44554',
          },
        ],
      },
      gitlab: {
        level: 'partly',
        text: 'Push and pull mirrors for repository contents. Issues and merge requests do not travel.',
      },
      bitbucket: {
        level: 'partly',
        text: 'Imports code and history from other hosts. Pull requests and issues do not come with it, and we found no built-in mirror out. The source is an older community thread.',
        sources: [
          {
            label: 'Atlassian community thread',
            href: 'https://community.atlassian.com/forums/Bitbucket-questions/Import-repository-with-pull-requests/qaq-p/794373',
          },
        ],
      },
      gitcafe: {
        level: 'yes',
        text: 'Import from GitHub and sync one way or both, including issues, pull requests, reviews and comments. Git mirrors keep a branch in step with another server.',
        sources: [
          { label: 'GitCafe docs summary', href: 'https://git.cafe/llms.txt' },
        ],
      },
      forgejo: {
        level: 'partly',
        text: 'Push and pull mirrors for repository contents. Issues and pull requests do not travel.',
      },
    },
  },
  {
    id: 'ci',
    topic: 'Running code',
    question: 'CI that the host runs for you',
    cells: {
      us: {
        level: 'no',
        text: 'No hosted CI, on purpose. Connect any runner: Blacksmith or your own machines today, more planned. No minutes to buy.',
      },
      github: {
        level: 'yes',
        text: 'Hosted runners, and self-hosted ones.',
      },
      gitlab: {
        level: 'yes',
        text: 'Hosted runners, and self-managed ones.',
      },
      bitbucket: {
        level: 'yes',
        text: 'Pipelines on Atlassian’s cloud runners, and self-hosted runners.',
        sources: [
          {
            label: 'Atlassian pricing',
            href: 'https://www.atlassian.com/software/bitbucket/pricing?tab=cloud',
          },
        ],
      },
      gitcafe: {
        level: 'partly',
        text: 'Runs GitHub Actions workflows on hosted Linux machines or on your own runners. Support is in beta. Buildkite works too.',
        sources: [
          { label: 'GitCafe docs summary', href: 'https://git.cafe/llms.txt' },
        ],
      },
      forgejo: {
        level: 'partly',
        text: 'Actions, with runners you run yourself.',
      },
    },
  },
  {
    id: 'free',
    topic: 'Price',
    question: 'A free plan',
    cells: {
      us: {
        level: 'no',
        text: `No. Every plan is paid, with a ${trial.days}-day trial first. Hosting every clone and replica costs us real money.`,
      },
      github: { level: 'yes', text: 'A free plan.' },
      gitlab: { level: 'yes', text: 'A free tier.' },
      bitbucket: {
        level: 'yes',
        text: 'Free for up to 5 users, with 50 build minutes a month.',
        sources: [
          {
            label: 'Atlassian pricing',
            href: 'https://www.atlassian.com/software/bitbucket/pricing?tab=cloud',
          },
        ],
      },
      gitcafe: {
        level: 'yes',
        text: 'A free plan. Private repositories are free during the public beta, and what they cost after that is not stated.',
        sources: [
          { label: 'GitCafe pricing', href: 'https://git.cafe/pricing' },
        ],
      },
      forgejo: {
        level: 'yes',
        text: 'Free to run yourself. Codeberg is free and run by a non-profit.',
      },
    },
  },
  {
    id: 'selfhost',
    topic: 'Price',
    question: 'Run it on your own servers',
    cells: {
      us: {
        level: 'no',
        text: 'No. Hosted only. Your repositories are plain git, and mirrors keep copies elsewhere.',
      },
      github: { level: 'yes', text: 'GitHub Enterprise Server.' },
      gitlab: { level: 'yes', text: 'Self-managed.' },
      bitbucket: {
        level: 'yes',
        text: 'Data Center, through Atlassian sales.',
        sources: [
          {
            label: 'Atlassian pricing',
            href: 'https://www.atlassian.com/software/bitbucket/pricing?tab=cloud',
          },
        ],
      },
      gitcafe: {
        level: 'unclear',
        text: 'We found no self-hosted forge. Its docs describe self-hosted CI runners only.',
      },
      forgejo: { level: 'yes', text: 'That is what they are for.' },
    },
  },
]

/** What the others do better, said plainly. */
export const behind = [
  'Stacked pull requests and two-way GitHub sync: GitCafe has both too, and also supports Jujutsu and Sapling.',
  'A free plan, which we do not have.',
  'Running it on your own servers.',
  'CI the host runs for you, with no runner to bring.',
  'Years of ecosystem: integrations, answers, and people who already know the product.',
]
