/**
 * Documents the sample repositories carry: a README, a contributing guide and
 * a licence. They are files in the fake git store, read through the API like
 * any other file.
 */
export type SampleRepo = {
  owner: string
  name: string
  description: string
  license: string
}

/** A sample README for a project. Descriptions only: install and facts live in About. */
export function readmeFor(repo: SampleRepo): string {
  const n = repo.name
  return `# ${n}

${repo.description}

${n} is small on purpose. It does one thing, keeps its dependencies to a minimum, and behaves the same on every platform.

## Why ${n}

- **Small and fast.** A single binary with no runtime to install.
- **Honest releases.** Every release is signed and ships with checksums.
- **The same everywhere.** macOS, Windows and Linux behave alike.
- **Local first.** Nothing leaves your machine unless you ask it to.

## A quick look

\`\`\`bash
${n} init
${n} run --watch
${n} --help
\`\`\`

## Configuration

${n} reads a small file in the project root. Every option has a sensible default.

| Option | Default | What it does |
| --- | --- | --- |
| \`watch\` | \`false\` | Rebuild when files change |
| \`cache\` | \`true\` | Keep results between runs |
| \`threads\` | \`auto\` | How many workers to use |
| \`log\` | \`warn\` | How much to say while working |

## Roadmap

- [x] Stable file format
- [x] Signed releases
- [ ] Plugin API
- [ ] A hosted mirror
`
}

/** CONTRIBUTING.md for a project. It has its own tab, so the README stays about the product. */
export function contributingFor(repo: SampleRepo): string {
  const n = repo.name
  return `# Contributing to ${n}

Bug reports and small fixes are welcome. For anything larger, open an issue first so we can agree on the shape of it.

## Reporting a bug

Include the version (\`${n} --version\`), your platform, and the smallest steps that reproduce it. A failing test is even better.

## Sending a change

1. Fork the repository and branch from \`main\`.
2. Keep the change focused. One fix or feature per change.
3. Add or update tests, and run the full suite before you push.
4. Open a change and describe what it does and why.

## Local setup

\`\`\`bash
git clone https://source.code/${repo.owner}/${n}.git
cd ${n}
${n} init
${n} run --watch
\`\`\`

## Style

Follow the formatter. If a rule gets in your way, say so in the change and we will talk about it.

## Conduct

Be kind. Assume good faith. Maintainers may close threads that are not constructive.
`
}

const BSD_BODY = (
  year: number,
  owner: string,
) => `Copyright (c) ${year}, ${owner}
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

const PERMISSIVE_WARRANTY = `THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

/** The LICENSE file. Permissive licenses are shown in full; the long ones show their notice. */
export function licenseFor(repo: SampleRepo): string {
  const year = 2026
  switch (repo.license) {
    case 'MIT':
      return `MIT License

Copyright (c) ${year} ${repo.owner}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

${PERMISSIVE_WARRANTY}`
    case 'ISC':
      return `ISC License

Copyright (c) ${year}, ${repo.owner}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
    case 'BSD-3-Clause':
      return `BSD 3-Clause License\n\n${BSD_BODY(year, repo.owner)}`
    default:
      return `${repo.name}
Copyright (c) ${year} ${repo.owner}

Licensed under the ${repo.license} license. You may not use this software except in compliance with the license.

The full license text is distributed with every release and can be read at
https://spdx.org/licenses/${repo.license}.html

Unless required by applicable law or agreed to in writing, the software is distributed on an "AS IS" basis, without warranties or conditions of any kind, either express or implied.`
  }
}
