// Mock evidence for changes and issues: what a person looks at to understand a
// change without reading the diff. Everything is generated here, so there are
// no image or video files to ship. A real repository stores uploads instead.

export type Tone = 'dim' | 'ok' | 'bad' | 'warn' | 'add' | 'del'
export type Line = { t: string; tone?: Tone }

/** Who produced a piece of evidence. Agents and CI attach it as they work. */
export type Origin = {
  by: string
  kind: 'human' | 'agent' | 'ci'
  /** Where it ran, for an agent or a runner. */
  via?: string
}

export type Media = {
  id: string
  title: string
  caption?: string
  origin: Origin
} & (
  | {
      kind: 'compare'
      before: string
      after: string
      beforeLabel?: string
      afterLabel?: string
    }
  | { kind: 'image'; src: string }
  | { kind: 'frame'; label: 'Recording' | 'Interactive'; html: string }
)

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ink: Record<Tone | 'base', string> = {
  base: '#c9d1d9',
  dim: '#7d8590',
  ok: '#3fb950',
  bad: '#f85149',
  warn: '#d29922',
  add: '#3fb950',
  del: '#f85149',
}

const uri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** A terminal window as an image. Lines marked add or del get a tinted row. */
export function terminalShot(title: string, lines: Array<Line>, width = 640) {
  const lh = 20
  const top = 40
  const height = top + lines.length * lh + 18
  const rows = lines
    .map((l, i) => {
      const y = top + i * lh
      const tint =
        l.tone === 'add'
          ? `<rect x="0" y="${y - 2}" width="${width}" height="${lh}" fill="rgba(63,185,80,.14)"/>`
          : l.tone === 'del'
            ? `<rect x="0" y="${y - 2}" width="${width}" height="${lh}" fill="rgba(248,81,73,.14)"/>`
            : ''
      return `${tint}<text xml:space="preserve" x="16" y="${y + 12}" fill="${ink[l.tone ?? 'base']}">${esc(l.t)}</text>`
    })
    .join('')
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="12.5">` +
      `<rect width="${width}" height="${height}" rx="10" fill="#0b0d10"/>` +
      `<rect width="${width}" height="30" rx="10" fill="#161b22"/><rect y="20" width="${width}" height="10" fill="#161b22"/>` +
      `<circle cx="16" cy="15" r="5" fill="#f85149"/><circle cx="34" cy="15" r="5" fill="#d29922"/><circle cx="52" cy="15" r="5" fill="#3fb950"/>` +
      `<text x="${width / 2}" y="19" text-anchor="middle" fill="#7d8590" font-size="11">${esc(title)}</text>` +
      rows +
      `</svg>`,
  )
}

/** A simple line chart as an image. */
export function chartShot(
  title: string,
  points: Array<number>,
  unit: string,
  tone: 'bad' | 'ok',
) {
  const w = 640
  const h = 220
  const pad = { l: 56, r: 20, t: 40, b: 30 }
  const max = Math.max(...points) * 1.1
  const x = (i: number) =>
    pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b)
  const path = points
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ')
  const grid = [0, 0.5, 1]
    .map((f) => {
      const gy = y(max * f)
      return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${gy}" y2="${gy}" stroke="#30363d"/><text x="${pad.l - 8}" y="${gy + 4}" text-anchor="end" fill="#7d8590" font-size="10">${Math.round(max * f)} ${unit}</text>`
    })
    .join('')
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-sans-serif,system-ui,sans-serif">` +
      `<rect width="${w}" height="${h}" rx="10" fill="#0b0d10"/>` +
      `<text x="16" y="24" fill="#c9d1d9" font-size="12" font-weight="600">${esc(title)}</text>` +
      grid +
      `<path d="${path}" fill="none" stroke="${ink[tone]}" stroke-width="2"/>` +
      `<text x="${w - pad.r}" y="${h - 10}" text-anchor="end" fill="#7d8590" font-size="10">hours</text>` +
      `</svg>`,
  )
}

const frameCss = `
*{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#c9d1d9;font:12.5px/20px ui-monospace,Menlo,Consolas,monospace;display:flex;flex-direction:column;height:100vh}
.bar{display:flex;gap:10px;align-items:center;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;font-family:ui-sans-serif,system-ui,sans-serif;font-size:12px}
button{font:inherit;color:#c9d1d9;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:3px 10px;cursor:pointer}
button[aria-pressed=true]{background:#c9d1d9;color:#0b0d10}
input[type=range]{flex:1;accent-color:#c9d1d9}
.out{padding:10px 16px;overflow:auto;flex:1;white-space:pre}
.dim{color:#7d8590}.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}
.add{color:#3fb950;background:rgba(63,185,80,.14)}.del{color:#f85149;background:rgba(248,81,73,.14)}
`

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/** A terminal recording with play, pause and a scrubber. */
export function recording(lines: Array<Line>, stepMs = 380) {
  return `<!doctype html><meta charset="utf-8"><style>${frameCss}</style>
<div class="bar"><button id="p">Pause</button><input id="r" type="range" min="0" max="${lines.length}" value="0" aria-label="Position"><span id="t"></span></div>
<div class="out" id="o"></div>
<script>
const L=${json(lines)};let i=0,timer=null;const o=document.getElementById('o'),r=document.getElementById('r'),p=document.getElementById('p'),t=document.getElementById('t');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function show(n){o.innerHTML=L.slice(0,n).map(l=>'<div class="'+(l.tone||'')+'">'+esc(l.t)+'</div>').join('');r.value=n;t.textContent=n+' / '+L.length;o.scrollTop=o.scrollHeight}
function play(){clearInterval(timer);p.textContent='Pause';timer=setInterval(()=>{if(i>=L.length){clearInterval(timer);p.textContent='Replay';return}i++;show(i)},${stepMs})}
p.onclick=()=>{if(p.textContent==='Pause'){clearInterval(timer);p.textContent='Play'}else{if(i>=L.length)i=0;play()}};
r.oninput=()=>{clearInterval(timer);i=+r.value;show(i);p.textContent='Play'};
play();
</script>`
}

/** Two states of the same screen, switched with a button. Interactive. */
export function explorer(a: [string, Array<Line>], b: [string, Array<Line>]) {
  return `<!doctype html><meta charset="utf-8"><style>${frameCss}</style>
<div class="bar"><span>Show</span><button id="a" aria-pressed="false">${esc(a[0])}</button><button id="b" aria-pressed="true">${esc(b[0])}</button></div>
<div class="out" id="o"></div>
<script>
const S={a:${json(a[1])},b:${json(b[1])}};const o=document.getElementById('o');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function pick(k){o.innerHTML=S[k].map(l=>'<div class="'+(l.tone||'')+'">'+esc(l.t)+'</div>').join('');['a','b'].forEach(x=>document.getElementById(x).setAttribute('aria-pressed',String(x===k)))}
document.getElementById('a').onclick=()=>pick('a');document.getElementById('b').onclick=()=>pick('b');pick('b');
</script>`
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const claude: Origin = { by: 'claude', kind: 'agent', via: 'E2B sandbox' }
const ci: Origin = { by: 'ci/test', kind: 'ci', via: 'run #1842' }

const benchBefore: Array<Line> = [
  { t: '$ gitfs bench lookup --missing refs/heads/nope', tone: 'dim' },
  { t: 'lookups        2' },
  { t: 'disk reads     2', tone: 'del' },
  { t: 'p50            0.94 ms', tone: 'del' },
  { t: 'cache          none' },
]
const benchAfter: Array<Line> = [
  { t: '$ gitfs bench lookup --missing refs/heads/nope', tone: 'dim' },
  { t: 'lookups        2' },
  { t: 'disk reads     1', tone: 'add' },
  { t: 'p50            0.02 ms', tone: 'add' },
  { t: 'cache          negative (1 entry)', tone: 'add' },
]

const doctorBefore: Array<Line> = [
  { t: '$ gitfs doctor', tone: 'dim' },
  { t: 'mount          ok', tone: 'ok' },
  { t: 'object store   ok  (s3, 4 retries/h)', tone: 'ok' },
  { t: 'refs           ok  (3,204 refs)', tone: 'ok' },
]
const doctorAfter: Array<Line> = [
  { t: '$ gitfs doctor', tone: 'dim' },
  { t: 'mount          ok', tone: 'ok' },
  { t: 'object store   ok  (s3, 4 retries/h)', tone: 'ok' },
  { t: 'refs           ok  (3,204 refs)', tone: 'ok' },
  { t: 'cache          hit 94.1%  miss 5.9%', tone: 'add' },
  { t: '  positive     8,812 / 10,000 entries', tone: 'add' },
  { t: '  negative       412 / 10,000 entries', tone: 'add' },
]

const pathBefore: Array<Line> = [
  { t: 'C:\\Users\\ines> gitfs status', tone: 'dim' },
  { t: 'modified  src\\refs.rs', tone: 'ok' },
  { t: 'modified  src/neg_cache.rs', tone: 'del' },
  { t: 'warning: 1 path uses a different separator', tone: 'warn' },
]
const pathAfter: Array<Line> = [
  { t: 'C:\\Users\\ines> gitfs status', tone: 'dim' },
  { t: 'modified  src\\refs.rs', tone: 'ok' },
  { t: 'modified  src\\neg_cache.rs', tone: 'add' },
]

const testRun: Array<Line> = [
  { t: '$ cargo test lookup', tone: 'dim' },
  { t: 'running 3 tests' },
  { t: 'test refs::lookup_hits_cache ... ok', tone: 'ok' },
  { t: 'test refs::lookup_reads_disk_once ... ok', tone: 'ok' },
  { t: 'test refs::lookup_survives_empty_name ... ok', tone: 'ok' },
  { t: 'test result: ok. 3 passed; 0 failed', tone: 'ok' },
]

export function mediaForChange(id: string): Array<Media> {
  switch (id) {
    case '216':
      return [
        {
          id: 'm1',
          title: 'Two lookups of a missing ref',
          caption: 'The second lookup no longer touches the disk.',
          origin: claude,
          kind: 'compare',
          before: terminalShot('main · gitfs bench', benchBefore),
          after: terminalShot('#216 · gitfs bench', benchAfter),
          beforeLabel: 'main',
          afterLabel: 'This change',
        },
        {
          id: 'm2',
          title: 'The new tests, as they ran',
          caption: 'Pause or drag to follow along.',
          origin: ci,
          kind: 'frame',
          label: 'Recording',
          html: recording(testRun),
        },
      ]
    case '217':
      return [
        {
          id: 'm1',
          title: 'Cache size over a 36 hour scan',
          caption: 'Random names no longer grow memory without limit.',
          origin: claude,
          kind: 'compare',
          before: chartShot(
            'main · negative cache entries',
            [0, 40, 110, 230, 420, 700, 1050, 1500],
            'k',
            'bad',
          ),
          after: chartShot(
            '#217 · negative cache entries',
            [0, 4, 8, 10, 10, 10, 10, 10],
            'k',
            'ok',
          ),
          beforeLabel: 'main',
          afterLabel: 'This change',
        },
      ]
    case '218':
      return [
        {
          id: 'm1',
          title: 'gitfs doctor',
          caption: 'Three new lines, under the checks that already exist.',
          origin: { by: 'dana', kind: 'human' },
          kind: 'compare',
          before: terminalShot('main · gitfs doctor', doctorBefore),
          after: terminalShot('#218 · gitfs doctor', doctorAfter),
          beforeLabel: 'main',
          afterLabel: 'This change',
        },
        {
          id: 'm2',
          title: 'Try it',
          caption: 'Switch between the two outputs.',
          origin: claude,
          kind: 'frame',
          label: 'Interactive',
          html: explorer(['main', doctorBefore], ['This change', doctorAfter]),
        },
      ]
    case '212':
      return [
        {
          id: 'm1',
          title: 'gitfs status on Windows',
          caption: 'The second path no longer mixes separators.',
          origin: { by: 'ines', kind: 'human' },
          kind: 'compare',
          before: terminalShot('main · cmd.exe', pathBefore),
          after: terminalShot('#212 · cmd.exe', pathAfter),
          beforeLabel: 'main',
          afterLabel: 'This change',
        },
      ]
    default:
      return []
  }
}

export function mediaForIssue(n: number): Array<Media> {
  const reporter = (by: string): Origin => ({ by, kind: 'human' })
  switch (n) {
    case 214:
      return [
        {
          id: 'i1',
          title: 'Empty config',
          caption: 'What happens, and what should happen.',
          origin: reporter('kofi'),
          kind: 'compare',
          before: terminalShot('actual', [
            { t: '$ : > gitfs.toml && gitfs run', tone: 'dim' },
            { t: '$ echo $?', tone: 'dim' },
            { t: '1', tone: 'bad' },
          ]),
          after: terminalShot('expected', [
            { t: '$ : > gitfs.toml && gitfs run', tone: 'dim' },
            { t: 'using defaults', tone: 'ok' },
            { t: '$ echo $?', tone: 'dim' },
            { t: '0', tone: 'ok' },
          ]),
          beforeLabel: 'Actual',
          afterLabel: 'Expected',
        },
        {
          id: 'i2',
          title: 'Reproduced on main',
          caption: 'Recorded by an agent so a person can watch it fail.',
          origin: claude,
          kind: 'frame',
          label: 'Recording',
          html: recording([
            { t: '$ git checkout main && cargo build', tone: 'dim' },
            { t: 'Finished dev profile in 11.2s', tone: 'ok' },
            { t: '$ : > gitfs.toml', tone: 'dim' },
            { t: '$ ./target/debug/gitfs run', tone: 'dim' },
            { t: '$ echo $?', tone: 'dim' },
            { t: '1', tone: 'bad' },
          ]),
        },
      ]
    case 207:
      return [
        {
          id: 'i1',
          title: 'Resident memory with the watcher on',
          origin: reporter('otto'),
          kind: 'image',
          src: chartShot(
            'RSS over 36 hours',
            [40, 90, 180, 320, 520, 760, 940, 1100],
            'MB',
            'bad',
          ),
        },
      ]
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export type TestResult = 'pass' | 'fail' | 'skipped'

export type TestCase = {
  suite: string
  name: string
  ms: number
  /** The same test against the base. `fail` means it reproduces the bug. */
  base: TestResult | 'missing'
  head: TestResult
  /** Screenshots from the test, before and after. */
  shot?: { before: string; after: string; note: string }
}

export type TestRun = {
  runner: string
  run: number
  tree: string
  origin: Origin
  cases: Array<TestCase>
}

export function testRunFor(id: string): TestRun | undefined {
  if (id !== '216') return undefined
  return {
    runner: 'ci/test',
    run: 1842,
    tree: '9c4d7e1',
    origin: ci,
    cases: [
      {
        suite: 'refs',
        name: 'lookup_reads_disk_once',
        ms: 12,
        base: 'fail',
        head: 'pass',
        shot: {
          before: terminalShot('main · lookup_reads_disk_once', [
            { t: 'assertion `left == right` failed', tone: 'bad' },
            { t: '  left: 2', tone: 'del' },
            { t: ' right: 1', tone: 'add' },
          ]),
          after: terminalShot('#216 · lookup_reads_disk_once', [
            { t: 'test refs::lookup_reads_disk_once ... ok', tone: 'ok' },
            { t: 'disk reads: 1', tone: 'ok' },
          ]),
          note: 'Fails on main for the reason the change fixes, so the test is a real check.',
        },
      },
      {
        suite: 'refs',
        name: 'lookup_hits_cache',
        ms: 8,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'refs',
        name: 'lookup_survives_empty_name',
        ms: 5,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'mount',
        name: 'mounts_readonly',
        ms: 140,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'mount',
        name: 'remounts_after_error',
        ms: 210,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'store',
        name: 'retries_on_503',
        ms: 480,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'store',
        name: 'backoff_is_capped',
        ms: 35,
        base: 'pass',
        head: 'pass',
      },
      {
        suite: 'refs',
        name: 'neg_cache_is_bounded',
        ms: 0,
        base: 'missing',
        head: 'skipped',
      },
    ],
  }
}
