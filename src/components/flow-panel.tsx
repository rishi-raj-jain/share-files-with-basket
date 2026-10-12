'use client'

import { formatBytes } from '@/lib/limits'
import { useEffect, useState } from 'react'

export type StepState = 'idle' | 'active' | 'done' | 'error'

export type Flow = {
  project: StepState
  bucket: StepState
  upload: StepState
  reused?: boolean
  projectId?: string
  region?: string
  projectMs?: number
  bucketMs?: number
  uploadMs?: number
  fileName?: string
  fileType?: string
  fileSize?: number
  error?: string
}

export const emptyFlow: Flow = {
  project: 'idle',
  bucket: 'idle',
  upload: 'idle',
}

export type SharedFile = {
  name: string
  type: string
  size: number
  publicUrl: string
}

// The project this browser shares from. Every basket until the buzzer lands here.
export type Session = {
  projectId: string
  region: string
  claimUrl: string
  expiresAt: string
  files: SharedFile[]
}

const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

const secs = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)}s`)

function Dot({ state, n }: { state: StepState; n: number }) {
  const tone = {
    idle: 'border-zinc-300 text-zinc-400 dark:border-zinc-700',
    active: 'border-blue-500 text-blue-600 dark:text-blue-400',
    done: 'border-emerald-500 bg-emerald-500 text-white',
    error: 'border-red-500 bg-red-500 text-white',
  }[state]
  return (
    <span className={`relative grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold transition-colors ${tone}`}>
      {state === 'done' ? (
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : state === 'error' ? (
        '!'
      ) : (
        n
      )}
      {state === 'active' && <span className="absolute -inset-1 animate-spin rounded-full border-2 border-transparent border-t-blue-500" />}
    </span>
  )
}

function Step({ n, state, title, last, children }: { n: number; state: StepState; title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span className={`absolute top-8 bottom-1 left-[13px] w-0.5 rounded-full transition-colors ${state === 'done' ? 'bg-emerald-400' : 'bg-zinc-200 dark:bg-zinc-800'}`} />}
      <Dot state={state} n={n} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={`text-sm font-medium ${state === 'idle' ? 'text-zinc-500' : ''}`}>{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{children}</div>
      </div>
    </li>
  )
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, new Date(until).getTime() - now)
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return (
    <span className="font-mono text-zinc-900 tabular-nums dark:text-zinc-100">
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{children}</code>
}

function ShareList({ session }: { session: Session }) {
  const [copied, setCopied] = useState<string | null>(null)
  const latest = session.files[0]

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  return (
    <div className="space-y-3">
      {latest && PREVIEWABLE.includes(latest.type) && (
        // Served from the project's own bucket, so next/image would only add a hop.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={latest.publicUrl} alt={latest.name} className="max-h-36 w-full rounded-xl border border-zinc-200 object-cover dark:border-zinc-800" />
      )}
      <ul className="max-h-52 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {session.files.map((f) => (
          <li key={f.publicUrl} className="flex items-center gap-2 px-3 py-2">
            <a href={f.publicUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[13px] font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
              {f.name}
            </a>
            <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatBytes(f.size)}</span>
            <button
              type="button"
              onClick={() => copy(f.publicUrl)}
              className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {copied === f.publicUrl ? 'Copied' : 'Copy link'}
            </button>
          </li>
        ))}
      </ul>
      <p>
        Anyone with a link can open the file until the buzzer in <Countdown until={session.expiresAt} />. Keep shooting to add more files to <Code>{session.projectId}</Code>.
      </p>
      <a
        href={session.claimUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Claim the project to keep these files
      </a>
      <p className="text-xs">Unclaimed projects and their files are deleted after the buzzer.</p>
    </div>
  )
}

export function FlowPanel({ flow, percent, session }: { flow: Flow; percent: number; session: Session | null }) {
  const started = flow.project !== 'idle'
  const shareState: StepState = flow.error && !session ? 'error' : session ? 'done' : 'idle'

  return (
    <section aria-label="What happens on a basket" className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{started ? 'This possession' : session ? 'Your project' : 'What a basket does'}</p>

      <ol className="mt-5">
        <Step n={1} state={flow.project} title="Spin up a Neon project">
          {flow.projectId && flow.reused ? (
            <>
              Reused <Code>{flow.projectId}</Code> from your last basket
            </>
          ) : flow.projectId ? (
            <>
              <Code>{flow.projectId}</Code> in {flow.region} · {secs(flow.projectMs)}
            </>
          ) : session ? (
            <>
              Your next basket reuses <Code>{session.projectId}</Code>, no new project needed.
            </>
          ) : (
            'A fresh project in AWS us-east-2, created for you the moment the file drops through the rim.'
          )}
        </Step>

        <Step n={2} state={flow.bucket} title="Add a public storage bucket">
          {flow.bucket === 'done' && flow.reused ? (
            <>
              <Code>uploads</Code> · public_read · already in place
            </>
          ) : flow.bucket === 'done' ? (
            <>
              <Code>uploads</Code> · public_read · {secs(flow.bucketMs)}
            </>
          ) : (
            "Neon Object Storage on the project's main branch, readable by anyone with the link."
          )}
        </Step>

        <Step n={3} state={flow.upload} title="Upload straight into it">
          {flow.upload === 'active' && flow.fileName ? (
            <>
              <span className="font-mono tabular-nums">{percent}%</span> of {flow.fileName}
            </>
          ) : flow.upload === 'done' && flow.fileName ? (
            <>
              {flow.fileName} · {formatBytes(flow.fileSize ?? 0)} · {secs(flow.uploadMs)}
            </>
          ) : (
            'Your browser sends the file to a presigned URL, so it never passes through this site.'
          )}
        </Step>

        <Step n={4} state={shareState} title="Share it before the buzzer" last>
          {session ? (
            <ShareList session={session} />
          ) : flow.error ? (
            <span className="text-red-600 dark:text-red-400">{flow.error}</span>
          ) : (
            'Every basket gives you a public link that works for an hour. Claim the project to keep the files after that.'
          )}
        </Step>
      </ol>
    </section>
  )
}
