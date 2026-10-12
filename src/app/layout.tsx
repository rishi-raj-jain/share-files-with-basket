import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Self-hosted variable fonts (latin subset from Google Fonts). next/font/google
// has no fallback metrics for Google Sans, so it warns on every build. Local
// fonts get their metrics from the file itself.
const sans = localFont({
  src: './fonts/GoogleSans-latin.woff2',
  variable: '--font-google-sans',
  weight: '400 700',
  display: 'swap',
})
const mono = localFont({
  src: './fonts/GoogleSansCode-latin.woff2',
  variable: '--font-google-sans-code',
  weight: '300 800',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nothing But Neon',
  description:
    'Temporary file sharing with a shot clock. Shoot a file at the hoop and every basket lands in your own Neon project with a public storage bucket. Links work for an hour, or claim the project to keep the files.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-white font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  )
}
