import * as React from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { Modal } from './bits'
import type { Repo } from '~/lib/model/data'
import { Button } from '~/components/ui/button'
import { Select, SelectItem } from '~/components/ui/select'
import { Textarea } from '~/components/ui/input'
import { useWrite } from '~/lib/forge'

type Platform = 'macos' | 'windows' | 'linux'
type Picked = { file: File; platform: Platform; arch: 'arm64' | 'x64' }

/** What a file probably runs on, from its name. */
function guess(name: string): Pick<Picked, 'platform' | 'arch'> {
  const n = name.toLowerCase()
  const platform: Platform = /darwin|mac|\.dmg$|\.pkg$/.test(n)
    ? 'macos'
    : /windows|win|\.exe$|\.msi$/.test(n)
      ? 'windows'
      : 'linux'
  const arch = /arm64|aarch64/.test(n) ? 'arm64' : 'x64'
  return { platform, arch }
}

const typeOf = (name: string) =>
  name.endsWith('.zip')
    ? 'application/zip'
    : /\.(t?gz)$/.test(name)
      ? 'application/gzip'
      : 'application/octet-stream'

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)

/**
 * Publish a release: its notes and its files. Each file is uploaded straight
 * to its signed address, then the release names the uploads.
 */
export function PublishRelease({ repo }: { repo: Repo }) {
  const write = useWrite()
  const [open, setOpen] = React.useState(false)
  const [tag, setTag] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [channel, setChannel] = React.useState<'stable' | 'beta' | 'nightly'>(
    'stable',
  )
  const [added, setAdded] = React.useState('')
  const [fixed, setFixed] = React.useState('')
  const [files, setFiles] = React.useState<Array<Picked>>([])
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')

  const publish = async () => {
    setError('')
    const assets: Array<{
      name: string
      platform: Platform
      arch: string
      upload: string
    }> = []
    for (const p of files) {
      setBusy(`Uploading ${p.file.name}`)
      const up = await write('uploads.create', {
        body: {
          filename: p.file.name,
          content_type: typeOf(p.file.name),
          size: p.file.size,
          purpose: 'release',
        },
      })
      if (up.error) return fail(up.error.message)
      const sent = await fetch(up.data.upload_url ?? '', {
        method: 'PUT',
        headers: { 'content-type': typeOf(p.file.name) },
        body: p.file,
      })
      if (!sent.ok)
        return fail(`${p.file.name} did not upload (${sent.status}).`)
      assets.push({
        name: p.file.name,
        platform: p.platform,
        arch: p.arch,
        upload: up.data.id,
      })
    }
    setBusy('Publishing')
    const r = await write('releases.create', {
      owner: repo.owner,
      repo: repo.name,
      body: {
        tag: tag.trim(),
        channel,
        title: title.trim(),
        notes: { added: lines(added), fixed: lines(fixed) },
        assets,
      },
    })
    if (r.error) return fail(r.error.message)
    setBusy('')
    setOpen(false)
    setTag('')
    setTitle('')
    setAdded('')
    setFixed('')
    setFiles([])
  }
  const fail = (message: string) => {
    setBusy('')
    setError(message)
  }
  const input = 'h-9 w-full rounded-lg border bg-background px-3'

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon /> Publish a release
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Publish a release"
        description="Its files are stored here and served from the download button. A stable release tells the people who starred the project."
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-muted-foreground">Tag</span>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="v1.0.0"
                className={`${input} font-mono`}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Channel</span>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as typeof channel)}
              >
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
                <SelectItem value="nightly">Nightly</SelectItem>
              </Select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={input}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Added, one per line</span>
            <Textarea
              value={added}
              rows={2}
              onChange={(e) => setAdded(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Fixed, one per line</span>
            <Textarea
              value={fixed}
              rows={2}
              onChange={(e) => setFixed(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Files</span>
            <input
              type="file"
              multiple
              aria-label="Release files"
              onChange={(e) =>
                setFiles(
                  [...(e.target.files ?? [])].map((file) => ({
                    file,
                    ...guess(file.name),
                  })),
                )
              }
              className="block w-full text-sm"
            />
          </label>
          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((p, i) => (
                <li key={p.file.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {p.file.name}
                  </span>
                  <Select
                    value={p.platform}
                    onValueChange={(v) =>
                      setFiles(
                        files.map((f, j) =>
                          j === i ? { ...f, platform: v as Platform } : f,
                        ),
                      )
                    }
                  >
                    <SelectItem value="macos">macOS</SelectItem>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                  </Select>
                  <Select
                    value={p.arch}
                    onValueChange={(v) =>
                      setFiles(
                        files.map((f, j) =>
                          j === i ? { ...f, arch: v as Picked['arch'] } : f,
                        ),
                      )
                    }
                  >
                    <SelectItem value="arm64">arm64</SelectItem>
                    <SelectItem value="x64">x64</SelectItem>
                  </Select>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {busy && <span className="text-muted-foreground">{busy}…</span>}
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!tag.trim() || !title.trim() || !!busy}
              onClick={() => void publish()}
            >
              Publish
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
