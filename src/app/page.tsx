import HoopUploader from '@/components/hoop-uploader'
import { NeonMark } from '@/components/neon-logo'

const BLOG = 'https://neon.com/blog/an-agent-provisions-a-neon-backend-a-human-claims-it-later'
const RISHI = 'https://x.com/rishi_raj_jain_'

export default function Home() {
  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        <div className="mt-6 mb-8 sm:mt-10">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1 pr-3 pl-2 text-xs font-medium text-emerald-800 shadow-[0_1px_2px_rgba(16,185,129,0.12)] dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            <NeonMark className="size-3.5 text-neon" />
            <span>
              Powered by <span className="font-semibold">Neon Object Storage</span>
            </span>
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Share files with a 🏀 Basket</h1>
          <p className="mt-3 text-lg text-pretty text-zinc-600 dark:text-zinc-400">
            Think of it as file sharing with a shot clock. Every link works for an hour, and{' '}
            <a
              href="https://neon.com/claimable-neon"
              className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-zinc-900 dark:text-zinc-100 dark:decoration-zinc-600 dark:hover:decoration-zinc-100"
            >
              claiming the project
            </a>{' '}
            keeps your files after the buzzer.
          </p>
        </div>
        <HoopUploader />
      </main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2">
            <NeonMark className="size-4 text-neon" />
            <span>
              Built by{' '}
              <a href={RISHI} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                Rishi
              </a>{' '}
              with Next.js, Neon and Vercel.
            </span>
          </p>
          <p>
            Inspired by{' '}
            <a href={BLOG} className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
              An agent provisions a Neon backend, a human claims it later
            </a>
          </p>
        </div>
      </footer>
    </>
  )
}
