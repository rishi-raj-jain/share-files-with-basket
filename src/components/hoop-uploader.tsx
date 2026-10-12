'use client'

import { formatBytes, MAX_BYTES, storedType } from '@/lib/limits'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { emptyFlow, FlowPanel, type Flow, type Session } from './flow-panel'

type Phase = 'idle' | 'missed' | 'provisioning' | 'uploading' | 'done' | 'error'
type Mode = 'idle' | 'drag' | 'fly' | 'rest' | 'tween' | 'held'
type Pose = {
  x: number
  y: number
  rot: number
  scale: number
  opacity: number
}
type Geo = ReturnType<typeof layout>
type Engine = {
  autoShoot: () => void
  canTake: () => boolean
  dropAt: (clientX: number, clientY: number) => void
  setOsDrag: (on: boolean) => void
}
type Ready = {
  step: 'ready'
  reused: boolean
  projectId: string
  region: string
  upload: { url: string; method: string; headers: Record<string, string> }
  publicUrl: string
  claimUrl: string
  expiresAt: string
}
type DropEvent =
  | {
      step: 'project'
      projectId: string
      region: string
      ms: number
      reused?: boolean
    }
  | { step: 'bucket'; ms: number }
  | Ready
  | { step: 'error'; message: string }

const G = 3000
const BALL_W = 52
const BALL_H = 52
const SAMPLE = {
  name: 'moodboard.png',
  type: 'image/png',
  url: '/moodboard.png',
}
const IN_NET: Phase[] = ['provisioning', 'uploading', 'done', 'error']

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

function layout(W: number, H: number) {
  const boardW = Math.min(320, W - 32)
  const boardH = Math.round(boardW * 0.52)
  const boardTop = 32
  const rimW = Math.round(boardW * 0.5)
  const rimY = boardTop + boardH - 10
  const netH = Math.round(rimW * 0.72)
  const floorY = H - 112
  return {
    W,
    H,
    cx: W / 2,
    boardW,
    boardH,
    boardTop,
    rimW,
    rimY,
    netH,
    floorY,
    homeX: W / 2 - Math.min(230, W * 0.3),
    homeY: floorY,
  }
}

// Diamond mesh that tapers toward the bottom, drawn as two families of diagonals.
function netPath(w: number, h: number, cols = 8, rows = 6) {
  const pt = (r: number, c: number) => {
    const t = r / rows
    const ww = w * (0.96 - 0.36 * t)
    return [(w - ww) / 2 + (ww * c) / cols, h * t]
  }
  const segs: string[] = []
  for (const dir of [1, -1]) {
    for (let i = -cols; i <= cols * 2; i++) {
      let d = ''
      for (let r = 0; r <= rows; r++) {
        const c = i + (dir * r) / 2
        if (c < 0 || c > cols) {
          if (d) break
          continue
        }
        const [x, y] = pt(r, c)
        d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
      }
      if (d.includes('L')) segs.push(d)
    }
  }
  segs.push(
    Array.from({ length: cols + 1 }, (_, c) => pt(rows, c))
      .map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(''),
  )
  return segs.join('')
}

async function sampleFile() {
  const blob = await (await fetch(SAMPLE.url)).blob()
  return new File([blob], SAMPLE.name, { type: SAMPLE.type })
}

async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: DropEvent) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let last: DropEvent | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      last = JSON.parse(line) as DropEvent
      onEvent(last)
    }
  }
  return last
}

function putWithProgress(upload: Ready['upload'], file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(upload.method, upload.url)
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage returned ${xhr.status}. Shoot again.`)))
    xhr.onerror = () => reject(new Error('The upload dropped. Shoot again.'))
    xhr.send(file)
  })
}

// The file token is a basketball with the file type printed on it like a logo.
function FileGlyph({ name }: { name: string }) {
  const ext = (name.includes('.') ? name.split('.').pop()! : 'file').slice(0, 4).toUpperCase()
  const w = 9 + ext.length * 5.4
  return (
    <svg viewBox="0 0 52 52" className="size-full drop-shadow-[0_6px_10px_rgba(24,24,27,0.14)]">
      <circle cx="26" cy="26" r="24" fill="#f0522d" />
      <path d="M9.5 9q10 17 0 34M42.5 9q-10 17 0 34M26 2v11M26 39v11M2 26h7M43 26h7" fill="none" stroke="#8a2d12" strokeWidth="1.6" strokeLinecap="round" />
      <rect x={26 - w / 2} y="19" width={w} height="14" rx="7" fill="#fff" />
      <text x="26" y="28.6" textAnchor="middle" fontSize="8" fontWeight="600" fill="#c2410c" fontFamily="inherit" letterSpacing="0.2">
        {ext}
      </text>
    </svg>
  )
}

function Backboard({ geo, phase, aim, percent, flow, errorMsg, rimMiss, reusing }: { geo: Geo; phase: Phase; aim: boolean; percent: number; flow: Flow; errorMsg: string | null; rimMiss: boolean; reusing: boolean }) {
  const tone =
    phase === 'missed' || phase === 'error'
      ? 'border-red-300 bg-red-50 dark:border-red-500/50 dark:bg-red-950/40'
      : phase === 'done'
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-950/40'
        : phase === 'provisioning' || phase === 'uploading' || aim
          ? 'border-blue-300 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-950/40'
          : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
  const box =
    phase === 'missed' || phase === 'error'
      ? 'border-red-400'
      : phase === 'done'
        ? 'border-emerald-400'
        : phase === 'provisioning' || phase === 'uploading' || aim
          ? 'border-blue-400'
          : 'border-zinc-300 dark:border-zinc-600'
  const icon = phase === 'missed' || phase === 'error' ? 'bg-red-500' : phase === 'done' ? 'bg-emerald-500' : 'bg-blue-600'

  const fileLine = flow.fileName ?? ''
  const [title, sub] = {
    idle: ['Upload file', 'Shoot it into the hoop'],
    missed: [rimMiss ? 'Off the rim!' : 'Airball!', 'Shoot again'],
    provisioning: reusing ? ['Back to your project', 'Same bucket, new file'] : ['Spinning up Neon', flow.bucket === 'active' ? 'Adding a storage bucket' : 'New project in us-east-2'],
    uploading: [`Uploading ${percent}%`, fileLine],
    done: ['Swish! Uploaded', flow.fileSize ? `${fileLine} · ${formatBytes(flow.fileSize)}` : fileLine],
    error: ['Shot blocked', errorMsg ?? 'Shoot again'],
  }[phase]

  return (
    <div
      className={`absolute rounded-2xl border-2 border-dashed shadow-[0_8px_30px_rgba(24,24,27,0.06)] transition-colors duration-300 ${tone}`}
      style={{
        left: geo.cx - geo.boardW / 2,
        top: geo.boardTop,
        width: geo.boardW,
        height: geo.boardH,
      }}
    >
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full transition-colors ${icon}`}>
          {phase === 'done' ? (
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="#fff" strokeWidth={2.6}>
              <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : phase === 'provisioning' ? (
            <span className="size-2.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="#fff" strokeWidth={2.4}>
              <path d="M8 12.5v-9M4 7.5l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] leading-tight font-semibold tabular-nums">{title}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>
        </div>
      </div>
      <div
        className={`absolute left-1/2 -translate-x-1/2 rounded-md border-2 transition-colors duration-300 ${box}`}
        style={{
          bottom: 16,
          width: geo.rimW * 0.44,
          height: geo.boardH * 0.27,
        }}
      />
    </div>
  )
}

type Stats = { makes: number; misses: number }

// Your shooting stays in this browser. Nothing about shots reaches the server.
const STATS_KEY = 'nbn_stats'

let memory: Stats = { makes: 0, misses: 0 }
let lastRaw: string | null | undefined
const listeners = new Set<() => void>()

// Falls back to memory when storage is blocked, so the line still counts this visit.
function readStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (raw !== lastRaw) {
      lastRaw = raw
      const s = JSON.parse(raw ?? 'null')
      memory = typeof s?.makes === 'number' && typeof s?.misses === 'number' ? s : { makes: 0, misses: 0 }
    }
  } catch {}
  return memory
}

function bumpStat(key: keyof Stats) {
  const prev = readStats()
  memory = { ...prev, [key]: prev[key] + 1 }
  try {
    const raw = JSON.stringify(memory)
    localStorage.setItem(STATS_KEY, raw)
    lastRaw = raw
  } catch {}
  listeners.forEach((l) => l())
}

// Other tabs fire "storage", so every open tab shows the same numbers.
function subscribeStats(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function StatsLine({ stats }: { stats: Stats | null }) {
  const makes = stats?.makes ?? 0
  const misses = stats?.misses ?? 0
  const fg = makes + misses ? Math.round((makes / (makes + misses)) * 100) : 0
  const n = (v: number) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{stats ? v : '–'}</span>
  return (
    <p className="tabular-nums">
      Your shooting: {n(makes)} {makes === 1 ? 'basket' : 'baskets'} · {n(misses)} {misses === 1 ? 'miss' : 'misses'} · {n(fg)}
      {stats ? '%' : ''} from the field
    </p>
  )
}

export default function HoopUploader() {
  const clipId = useId()
  const stageRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLButtonElement>(null)
  const shadowRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGRectElement>(null)
  const netRef = useRef<SVGGElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const engine = useRef<Engine | null>(null)
  const fileRef = useRef<File | null>(null)

  const [geo, setGeo] = useState<Geo | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [aim, setAim] = useState(false)
  const [atHome, setAtHome] = useState(true)
  const [file, setFile] = useState({ name: SAMPLE.name, type: SAMPLE.type })
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [rimMiss, setRimMiss] = useState(false)
  const [hint, setHint] = useState(true)
  const [flow, setFlow] = useState<Flow>(emptyFlow)
  const [session, setSession] = useState<Session | null>(null)
  const stats = useSyncExternalStore<Stats | null>(subscribeStats, readStats, () => null)

  const choose = (f: File | undefined) => {
    if (!f) return false
    if (f.size === 0) {
      setNotice(`${f.name} is empty.`)
      return false
    }
    if (f.size > MAX_BYTES) {
      setNotice(`${f.name} is ${formatBytes(f.size)}. Files are capped at 10 MB.`)
      return false
    }
    fileRef.current = f
    setFile({ name: f.name, type: f.type })
    setNotice(null)
    return true
  }

  // A reload keeps sharing from the same project until its buzzer.
  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((d: { session: Session | null }) => d.session && setSession(d.session))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const stage = stageRef.current!
    const ball = ballRef.current!
    const shadow = shadowRef.current!
    let g: Geo | null = null
    const phaseRef: { current: Phase } = { current: 'idle' }

    const s = {
      pose: { x: 0, y: 0, rot: 0, scale: 1, opacity: 0 } as Pose,
      vx: 0,
      vy: 0,
      vr: 0,
      mode: 'idle' as Mode,
      shot: false,
      missed: false,
      rimHit: false,
      flyStart: 0,
      restAt: 0,
      tween: null as null | {
        from: Pose
        to: Pose
        t0: number
        dur: number
        ease: (t: number) => number
        done?: () => void
      },
      trail: [] as [number, number][],
      trailAlpha: 0,
      samples: [] as { x: number; y: number; t: number }[],
      grab: { dx: 0, dy: 0 },
      down: { x: 0, y: 0, t: 0 },
      moved: 0,
      osDrag: false,
      aim: false,
      fill: 0,
      shown: 0,
      actual: 0,
      pct: -1,
      dropStart: 0,
      provBoost: 0,
      uploadStart: 0,
      uploadDone: false,
      ready: null as null | {
        projectId: string
        region: string
        claimUrl: string
        expiresAt: string
        file: Session['files'][number]
      },
    }

    const go = (p: Phase) => {
      phaseRef.current = p
      setPhase(p)
    }
    const busy = () => IN_NET.includes(phaseRef.current)
    const local = (clientX: number, clientY: number) => {
      const r = stage.getBoundingClientRect()
      return { x: clientX - r.left, y: clientY - r.top }
    }

    const tweenTo = (to: Partial<Pose>, dur: number, ease: (t: number) => number, done?: () => void) => {
      s.mode = 'tween'
      s.tween = {
        from: { ...s.pose },
        to: { ...s.pose, ...to },
        t0: performance.now(),
        dur,
        ease,
        done,
      }
    }
    const settleHome = () => {
      s.mode = 'idle'
      setAtHome(true)
    }
    const returnHome = (after?: () => void) => {
      if (!g) return
      tweenTo({ x: g.homeX, y: g.homeY, rot: 0, scale: 1, opacity: 1 }, 520, easeInOut, () => {
        settleHome()
        after?.()
      })
    }
    const respawn = () => {
      if (!g) return
      Object.assign(s.pose, {
        x: g.homeX,
        y: g.homeY,
        rot: 0,
        scale: 0.6,
        opacity: 0,
      })
      tweenTo({ scale: 1, opacity: 1 }, 320, easeOut, settleHome)
    }
    const dropOut = () => {
      if (!g) return
      tweenTo({ y: g.rimY + g.netH + 70, opacity: 0, scale: 0.66 }, 420, easeIn, () => {
        go('idle')
        respawn()
      })
    }

    const launch = (vx: number, vy: number) => {
      s.vx = vx
      s.vy = vy
      s.vr = clamp(vx * 0.35, -540, 540)
      s.mode = 'fly'
      s.shot = true
      s.missed = false
      s.rimHit = false
      s.flyStart = performance.now()
      s.trail = [[s.pose.x, s.pose.y]]
      s.trailAlpha = 1
      setAtHome(false)
      setHint(false)
      if (phaseRef.current === 'missed') go('idle')
    }

    const miss = () => {
      s.missed = true
      if (!s.shot) return
      setRimMiss(s.rimHit)
      go('missed')
      bumpStat('misses')
    }

    const startDrop = async () => {
      s.dropStart = performance.now()
      s.provBoost = 0
      s.actual = 0
      s.shown = 0
      s.pct = -1
      s.uploadDone = false
      setPercent(0)
      setErrorMsg(null)
      go('provisioning')
      setFlow({ ...emptyFlow, project: 'active' })
      try {
        const f = fileRef.current ?? (await sampleFile())
        setFlow((x) => ({
          ...x,
          fileName: f.name,
          fileType: storedType(f.type),
          fileSize: f.size,
        }))
        const res = await fetch('/api/drops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: f.name,
            type: storedType(f.type),
            size: f.size,
          }),
        })
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? "Couldn't start a Neon project. Shoot again.")
        }
        const last = await readEvents(res.body, (e) => {
          if (e.step === 'project') {
            s.provBoost = 1
            setFlow((x) => ({
              ...x,
              project: 'done',
              bucket: 'active',
              reused: e.reused,
              projectId: e.projectId,
              region: e.region,
              projectMs: e.ms,
            }))
          } else if (e.step === 'bucket') {
            s.provBoost = 2
            setFlow((x) => ({
              ...x,
              bucket: 'done',
              upload: 'active',
              bucketMs: e.ms,
            }))
          }
        })
        if (last?.step === 'error') throw new Error(last.message)
        if (last?.step !== 'ready') throw new Error('Setup stopped early. Shoot again.')
        s.ready = {
          projectId: last.projectId,
          region: last.region,
          claimUrl: last.claimUrl,
          expiresAt: last.expiresAt,
          file: {
            name: f.name,
            type: storedType(f.type),
            size: f.size,
            publicUrl: last.publicUrl,
          },
        }
        s.uploadStart = performance.now()
        go('uploading')
        await putWithProgress(last.upload, f, (p) => (s.actual = Math.min(0.97, p)))
        s.actual = 1
        s.uploadDone = true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        const fail = (st: Flow['project']) => (st === 'active' ? 'error' : st)
        setFlow((x) => ({
          ...x,
          error: message,
          project: fail(x.project),
          bucket: fail(x.bucket),
          upload: fail(x.upload),
        }))
        setErrorMsg(message)
        go('error')
        setTimeout(dropOut, 2400)
      }
    }

    const finish = () => {
      const uploadMs = performance.now() - s.uploadStart
      go('done')
      setFlow((x) => ({ ...x, upload: 'done', uploadMs }))
      const r = s.ready
      if (r)
        setSession((prev) => ({
          projectId: r.projectId,
          region: r.region,
          claimUrl: r.claimUrl,
          expiresAt: r.expiresAt,
          files: [r.file, ...(prev?.projectId === r.projectId ? prev.files : [])],
        }))
      bumpStat('makes')
      setTimeout(dropOut, 1800)
    }

    const make = () => {
      if (!g) return
      netRef.current?.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.16)' }, { transform: 'scaleY(0.96)' }, { transform: 'scaleY(1)' }], { duration: 560, easing: 'ease-out' })
      tweenTo({ x: g.cx, y: g.rimY + g.netH * 0.42, rot: 0, scale: 0.7, opacity: 1 }, 360, easeOut, () => {
        s.mode = 'held'
      })
      startDrop()
    }

    // Pointer: grab, drag, flick.
    const onDown = (e: PointerEvent) => {
      if (!g || busy() || !(s.mode === 'idle' || s.mode === 'rest')) return
      e.preventDefault()
      ball.setPointerCapture(e.pointerId)
      const pt = local(e.clientX, e.clientY)
      s.mode = 'drag'
      s.grab = { dx: pt.x - s.pose.x, dy: pt.y - s.pose.y }
      s.down = { ...pt, t: e.timeStamp }
      s.samples = [{ ...pt, t: e.timeStamp }]
      s.moved = 0
      setAtHome(false)
      if (phaseRef.current === 'missed') go('idle')
    }
    const onMove = (e: PointerEvent) => {
      if (s.mode !== 'drag' || !g) return
      const pt = local(e.clientX, e.clientY)
      s.pose.x = clamp(pt.x - s.grab.dx, BALL_W / 2, g.W - BALL_W / 2)
      s.pose.y = clamp(pt.y - s.grab.dy, BALL_H / 2, g.floorY)
      s.pose.scale = 1.06
      s.moved = Math.max(s.moved, Math.hypot(pt.x - s.down.x, pt.y - s.down.y))
      s.samples.push({ ...pt, t: e.timeStamp })
      while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > 90) s.samples.shift()
      const a = s.samples[0]
      const dtm = e.timeStamp - a.t
      if (dtm > 0) s.pose.rot = clamp(((pt.x - a.x) / dtm) * 8, -18, 18)
    }
    const onUp = (e: PointerEvent) => {
      if (s.mode !== 'drag') return
      s.pose.scale = 1
      if (s.moved < 6 && e.timeStamp - s.down.t < 400) {
        returnHome()
        inputRef.current?.click()
        return
      }
      const pt = local(e.clientX, e.clientY)
      const a = s.samples[0]
      const dtm = Math.max(16, e.timeStamp - a.t)
      let vx = ((pt.x - a.x) / dtm) * 1000 * 0.85
      let vy = ((pt.y - a.y) / dtm) * 1000 * 0.85
      const speed = Math.hypot(vx, vy)
      if (speed > 3200) {
        vx *= 3200 / speed
        vy *= 3200 / speed
      }
      if (speed < 380 || vy > -200) returnHome()
      else launch(vx, vy)
    }
    const onCancel = () => s.mode === 'drag' && returnHome()
    ball.addEventListener('pointerdown', onDown)
    ball.addEventListener('pointermove', onMove)
    ball.addEventListener('pointerup', onUp)
    ball.addEventListener('pointercancel', onCancel)

    engine.current = {
      canTake: () => !busy() && (s.mode === 'idle' || s.mode === 'rest'),
      // Keyboard shot: solve for a launch that peaks above the rim and drops in.
      autoShoot: () => {
        if (!g || busy() || !(s.mode === 'idle' || s.mode === 'rest')) return
        const apex = g.rimY - 110
        const vy = -Math.sqrt(2 * G * (s.pose.y - apex))
        const t = -vy / G + Math.sqrt((2 * (g.rimY - apex)) / G)
        launch((g.cx - s.pose.x) / t, vy)
      },
      // A file dropped from the desktop onto the hoop falls straight in.
      dropAt: (clientX, clientY) => {
        if (!g) return
        const pt = local(clientX, clientY)
        const overHoop = Math.abs(pt.x - g.cx) < g.boardW / 2 && pt.y < g.rimY + g.netH
        Object.assign(s.pose, {
          x: clamp(pt.x, BALL_W / 2, g.W - BALL_W / 2),
          y: clamp(pt.y, BALL_H / 2, g.floorY),
          rot: 0,
          scale: 1,
          opacity: 1,
        })
        setAtHome(false)
        if (overHoop) {
          s.pose.x = g.cx + clamp(pt.x - g.cx, -g.rimW * 0.2, g.rimW * 0.2)
          s.pose.y = Math.min(pt.y, g.rimY - 70)
          launch(0, 0)
        } else returnHome()
      },
      setOsDrag: (on) => (s.osDrag = on),
    }

    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect()
      const first = !g
      g = layout(r.width, r.height)
      setGeo(g)
      if (first || s.mode === 'idle')
        Object.assign(s.pose, {
          x: g.homeX,
          y: g.homeY,
          rot: 0,
          scale: 1,
          opacity: 1,
        })
    })
    ro.observe(stage)

    // One physics substep. Substepping by real elapsed time keeps the flight
    // correct when the browser drops frames.
    const stepFly = (dt: number, now: number) => {
      if (!g) return
      const p = s.pose
      const prevY = p.y
      s.vy += G * dt
      // A little help near the rim, so a close shot rolls in.
      if (!s.missed && s.vy > 0 && p.y > g.rimY - 100 && p.y < g.rimY && Math.abs(p.x - g.cx) < g.rimW * 0.8) {
        s.vx += (g.cx - p.x) * 10 * dt
        s.vx *= 1 - 2.5 * dt
      }
      p.x += s.vx * dt
      p.y += s.vy * dt
      p.rot += s.vr * dt
      const half = BALL_W / 2
      if (p.x < half) {
        p.x = half
        s.vx = Math.abs(s.vx) * 0.6
      } else if (p.x > g.W - half) {
        p.x = g.W - half
        s.vx = -Math.abs(s.vx) * 0.6
      }
      if (!s.missed && s.vy > 0 && prevY < g.rimY && p.y >= g.rimY) {
        const dx = p.x - g.cx
        if (Math.abs(dx) <= g.rimW / 2 - 12) make()
        else if (Math.abs(dx) <= g.rimW / 2 + 20) {
          p.y = g.rimY - 1
          s.vy = -s.vy * 0.42
          s.vx += Math.sign(dx) * 260
          s.vr = Math.sign(dx) * 420
          s.rimHit = true
        }
      }
      if (s.mode === 'fly') {
        if (!s.missed && s.vy > 0 && (p.y > g.rimY + 50 || now - s.flyStart > 4000)) miss()
        if (p.y >= g.floorY) {
          p.y = g.floorY
          if (s.vy > 260) {
            s.vy = -s.vy * 0.36
            s.vx *= 0.7
            s.vr *= 0.5
          } else {
            s.vy = 0
            s.mode = 'rest'
            s.restAt = now
            if (!s.missed) miss()
          }
        }
      }
    }

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(1, (now - last) / 1000)
      last = now
      raf = requestAnimationFrame(frame)
      if (!g) return
      const p = s.pose

      if (s.mode === 'fly') {
        const steps = Math.max(1, Math.ceil(dt * 240))
        for (let i = 0; i < steps && s.mode === 'fly'; i++) stepFly(dt / steps, now)
        if (s.mode === 'fly' && s.trail.length < 120) s.trail.push([p.x, p.y])
      } else if (s.mode === 'rest') {
        if (now - s.restAt > 450) returnHome(() => phaseRef.current === 'missed' && go('idle'))
      } else if (s.mode === 'tween' && s.tween) {
        const tw = s.tween
        const t = clamp((now - tw.t0) / tw.dur, 0, 1)
        const e = tw.ease(t)
        for (const k of ['x', 'y', 'rot', 'scale', 'opacity'] as const) p[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e
        if (t >= 1) {
          s.tween = null
          s.mode = 'idle'
          tw.done?.()
        }
      }

      // Net fill: provisioning creeps up to 30%, the real upload fills the rest.
      const ph = phaseRef.current
      if (ph === 'provisioning') {
        const target = Math.min(0.3, 0.08 * s.provBoost + 0.12 * (1 - Math.exp(-(now - s.dropStart) / 800)))
        s.fill += (target - s.fill) * Math.min(1, dt * 4)
      } else if (ph === 'uploading') {
        const target = Math.min(s.actual, (now - s.uploadStart) / 1200)
        s.shown += (target - s.shown) * Math.min(1, dt * 8)
        if (s.uploadDone && target >= 1 && s.shown > 0.993) s.shown = 1
        const pct = Math.floor(s.shown * 100)
        if (pct !== s.pct) {
          s.pct = pct
          setPercent(pct)
        }
        s.fill = Math.max(s.fill, 0.3 + 0.7 * s.shown)
        if (s.shown === 1) finish()
      } else if (ph === 'done') s.fill = 1
      else if (ph !== 'error' && s.fill > 0) s.fill = Math.max(0, s.fill - dt * 2.2)

      const aimNow = s.osDrag || (s.mode === 'fly' && !s.missed && p.y < g.rimY + 10 && Math.abs(p.x - g.cx) < g.boardW / 2 + 30)
      if (aimNow !== s.aim) {
        s.aim = aimNow
        setAim(aimNow)
      }

      if (s.mode !== 'fly' && s.trailAlpha > 0) {
        s.trailAlpha = Math.max(0, s.trailAlpha - dt * 2.5)
        if (s.trailAlpha === 0) s.trail = []
      }

      ball.style.transform = `translate3d(${p.x - BALL_W / 2}px, ${p.y - BALL_H / 2}px, 0) rotate(${p.rot}deg) scale(${p.scale})`
      ball.style.opacity = String(p.opacity)
      const lift = clamp((g.floorY - p.y) / 420, 0, 1)
      shadow.style.transform = `translate3d(${p.x - 28}px, ${g.floorY + BALL_H / 2 - 2}px, 0) scale(${1 - lift * 0.6})`
      shadow.style.opacity = String(busy() ? 0 : (1 - lift) * p.opacity)
      const trail = trailRef.current
      if (trail) {
        trail.setAttribute('d', s.trail.length > 1 ? 'M' + s.trail.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') : '')
        trail.style.opacity = String(s.trailAlpha * 0.7)
      }
      const fill = fillRef.current
      if (fill) {
        const h = Math.max(0, g.netH * s.fill)
        fill.setAttribute('y', String(g.netH - h))
        fill.setAttribute('height', String(h))
      }
    }
    raf = requestAnimationFrame(frame)

    sampleFile().catch(() => {})

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      ball.removeEventListener('pointerdown', onDown)
      ball.removeEventListener('pointermove', onMove)
      ball.removeEventListener('pointerup', onUp)
      ball.removeEventListener('pointercancel', onCancel)
    }
  }, [])

  const inNet = IN_NET.includes(phase)
  const netTone = phase === 'done' ? 'stroke-emerald-500' : phase === 'error' ? 'stroke-red-500' : 'stroke-blue-600'
  const rimTone = phase === 'done' ? 'stroke-emerald-500' : 'stroke-blue-600'
  const net = geo ? netPath(geo.rimW, geo.netH) : ''

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div
          ref={stageRef}
          className="relative h-[560px] touch-none overflow-hidden rounded-3xl border border-zinc-200 bg-[radial-gradient(circle_at_center,rgb(228_228_231/0.7)_1px,transparent_1px)] [background-size:22px_22px] select-none sm:h-[600px] dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_center,rgb(63_63_70/0.6)_1px,transparent_1px)]"
          onDragOver={(e) => {
            e.preventDefault()
            engine.current?.setOsDrag(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) engine.current?.setOsDrag(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            engine.current?.setOsDrag(false)
            if (!engine.current?.canTake()) return
            if (choose(e.dataTransfer.files[0])) engine.current.dropAt(e.clientX, e.clientY)
          }}
        >
          {geo && <Backboard geo={geo} phase={phase} aim={aim} percent={percent} flow={flow} errorMsg={errorMsg} rimMiss={rimMiss} reusing={!!session} />}

          <svg className="pointer-events-none absolute inset-0 z-[5] size-full" aria-hidden>
            <path ref={trailRef} fill="none" className="stroke-blue-400" strokeWidth={3} strokeLinecap="round" strokeDasharray="0 9" />
          </svg>

          <div ref={shadowRef} aria-hidden className="pointer-events-none absolute top-0 left-0 h-2.5 w-14 rounded-[50%] bg-zinc-900/15 blur-[3px] dark:bg-black/50" />

          <button
            ref={ballRef}
            type="button"
            aria-label={`${file.name}. Press Enter to take the shot, or drag and flick it at the hoop.`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                engine.current?.autoShoot()
              }
            }}
            className={`absolute top-0 left-0 cursor-grab rounded-full opacity-0 outline-offset-4 will-change-transform focus-visible:outline-2 focus-visible:outline-blue-500 active:cursor-grabbing ${
              inNet ? 'z-10' : 'z-30'
            }`}
            style={{ width: BALL_W, height: BALL_H }}
          >
            <FileGlyph name={file.name} />
          </button>

          {geo && (
            <svg
              aria-hidden
              className="pointer-events-none absolute z-20 overflow-visible"
              style={{
                left: geo.cx - geo.rimW / 2,
                top: geo.rimY,
                width: geo.rimW,
                height: geo.netH,
              }}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect ref={fillRef} x={-10} y={geo.netH} width={geo.rimW + 20} height={0} />
                </clipPath>
              </defs>
              <g ref={netRef} style={{ transformOrigin: '50% 0', transformBox: 'fill-box' }}>
                <path d={net} fill="none" strokeWidth={1.6} className="stroke-zinc-300 dark:stroke-zinc-600" />
                <path d={net} fill="none" strokeWidth={2} clipPath={`url(#${clipId})`} className={`transition-[stroke] duration-300 ${netTone}`} />
              </g>
              <rect x={geo.rimW / 2 - 9} y={-14} width={18} height={10} rx={2} className={`transition-[fill] duration-300 ${phase === 'done' ? 'fill-emerald-500' : 'fill-blue-600'}`} />
              <ellipse cx={geo.rimW / 2} cy={0} rx={geo.rimW / 2} ry={7} fill="none" strokeWidth={5} className={`transition-[stroke] duration-300 ${rimTone}`} />
            </svg>
          )}

          {geo && (
            <div
              className={`pointer-events-none absolute z-0 -translate-x-1/2 text-center text-xs text-zinc-500 transition-opacity duration-200 ${atHome && !inNet ? 'opacity-100' : 'opacity-0'}`}
              style={{ left: geo.homeX, top: geo.floorY + BALL_H / 2 + 16 }}
            >
              <span className="block max-w-36 truncate">{file.name}</span>
            </div>
          )}

          <div className="absolute inset-x-4 bottom-4 z-40 flex items-end justify-between gap-3 text-xs text-zinc-500">
            <p className={`transition-opacity ${hint ? 'opacity-100' : 'opacity-0'}`}>Grab the file and shoot it at the hoop.</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={inNet}
              className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              Choose file
            </button>
          </div>

          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <p className="sr-only" aria-live="polite">
            {phase === 'missed' ? `${rimMiss ? 'Off the rim' : 'Airball'}. Shoot again.` : phase === 'done' ? `Swish. ${flow.fileName} uploaded.` : ''}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1 text-sm text-zinc-500">
          <StatsLine stats={stats} />
          {notice && <p className="text-red-600 dark:text-red-400">{notice}</p>}
        </div>
      </div>

      <FlowPanel flow={flow} percent={percent} session={session} />
    </div>
  )
}
