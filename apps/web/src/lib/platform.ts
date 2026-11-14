import * as React from 'react'
import type { Asset, Platform, Release } from '~/lib/model/data'

export type Arch = 'arm64' | 'x64'
export type Target = { os: Platform; arch: Arch | null }

type State = { detected: Target | null; override: Target | null }

const OVERRIDE_KEY = 'download-target'
const listeners = new Set<() => void>()
let state: State = { detected: null, override: null }
let started = false

function emit(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

interface UAData {
  platform?: string
  getHighEntropyValues?: (
    hints: Array<string>,
  ) => Promise<{ architecture?: string; platform?: string }>
}

/** Apple silicon Macs report an "Apple" GPU, Intel Macs report Intel or AMD. */
function isAppleGpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!gl || !ext) return false
    return /apple/i.test(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)))
  } catch {
    return false
  }
}

function detectSync(): Target {
  const ua = navigator.userAgent
  const uad = (navigator as Navigator & { userAgentData?: UAData })
    .userAgentData
  const plat = (uad?.platform ?? navigator.platform).toLowerCase()
  const os: Platform =
    /win/.test(plat) || /Windows/.test(ua)
      ? 'windows'
      : /mac/.test(plat) || /Mac OS/.test(ua)
        ? 'macos'
        : 'linux'
  let arch: Arch | null = /aarch64|arm64|armv8/i.test(ua) ? 'arm64' : null
  if (os === 'macos') arch = isAppleGpu() ? 'arm64' : 'x64'
  if (os === 'windows' && !arch) arch = 'x64'
  if (os === 'linux' && !arch) arch = 'x64'
  return { os, arch }
}

function start() {
  if (started) return
  started = true
  const detected = detectSync()
  let override: Target | null = null
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY)
    if (raw) override = JSON.parse(raw) as Target
  } catch {
    override = null
  }
  emit({ detected, override })
  // Chromium exposes the real CPU architecture; refine when available.
  const uad = (navigator as Navigator & { userAgentData?: UAData })
    .userAgentData
  void uad?.getHighEntropyValues?.(['architecture']).then((v) => {
    if (!v.architecture) return
    const arch: Arch = v.architecture === 'arm' ? 'arm64' : 'x64'
    if (state.detected && state.detected.os !== 'macos') {
      emit({ detected: { ...state.detected, arch } })
    }
  })
}

export function setTargetOverride(target: Target | null) {
  try {
    if (target) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(target))
    else localStorage.removeItem(OVERRIDE_KEY)
  } catch {
    // Storage can be blocked; the override then lasts for this page view.
  }
  emit({ override: target })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const SERVER: State = { detected: null, override: null }

/**
 * The machine the visitor is on. `target` is null until the client has looked,
 * so server and first client render agree.
 */
export function useTarget() {
  React.useEffect(start, [])
  const s = React.useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  )
  return {
    target: s.override ?? s.detected,
    detected: s.detected,
    isOverridden: s.override !== null,
    setTarget: setTargetOverride,
  }
}

export function archLabel(t: Target): string {
  if (t.os === 'macos') return t.arch === 'arm64' ? 'Apple silicon' : 'Intel'
  return t.arch === 'arm64' ? 'ARM64' : '64-bit'
}

export const osLabel: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

export type Fit = 'exact' | 'os' | 'none'

/**
 * How well a release fits a machine. `exact`: same OS and CPU. `os`: same OS,
 * another CPU (the asset is the one that is there). `none`: no build for this
 * OS at all, and we say so instead of offering a file that will not run.
 */
export function matchAsset(
  release: Release,
  target: Target | null,
): { asset: Asset | undefined; fit: Fit } {
  if (!target) return { asset: release.assets.at(0), fit: 'exact' }
  const exact = release.assets.find(
    (a) => a.platform === target.os && a.arch === target.arch,
  )
  if (exact) return { asset: exact, fit: 'exact' }
  const sameOs = release.assets.find((a) => a.platform === target.os)
  if (sameOs) return { asset: sameOs, fit: 'os' }
  return { asset: undefined, fit: 'none' }
}

/** Operating systems a release has at least one build for. */
export function availableOses(release: Release): Array<Platform> {
  return [...new Set(release.assets.map((a) => a.platform))]
}
