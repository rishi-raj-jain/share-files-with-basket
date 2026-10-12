// Shared by the client (pre-checks) and the server (enforcement).
export const MAX_BYTES = 10 * 1024 * 1024
export const CLAIM_WINDOW_SECONDS = 60 * 60
export const MAX_FILES_PER_PROJECT = 20
export const PROJECT_PREFIX = 'hoop-drop-'
export const BUCKET = 'uploads'
export const REGION = 'aws-us-east-2'

// Types the public bucket may serve with their real Content-Type. SVG and HTML
// are left out on purpose: anything scriptable would render on a neon.tech
// origin. Every other file is stored as application/octet-stream, so browsers
// download it instead of rendering it.
export const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv']

export const DOWNLOAD_TYPE = 'application/octet-stream'

export function storedType(type: string) {
  return INLINE_TYPES.includes(type) ? type : DOWNLOAD_TYPE
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
