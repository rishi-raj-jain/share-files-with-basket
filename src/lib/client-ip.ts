import { createHash } from 'node:crypto'
import { isIPv6 } from 'node:net'

// Vercel's edge sets x-real-ip and overwrites x-forwarded-for, so neither can be spoofed there.
export function clientIp(request: Request) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

// An IPv6 connection usually gets a whole /64, so the limit counts that /64 as one visitor.
// Without this, rotating through the block would hand out fresh projects every time.
export function rateLimitKey(ip: string) {
  if (!isIPv6(ip)) return ip
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return mapped[1]
  const [head, tail = ''] = ip.split('%')[0].split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`
}

export function ipHash(request: Request) {
  return createHash('sha256')
    .update(`${process.env.IP_SALT ?? ''}:${rateLimitKey(clientIp(request))}`)
    .digest('hex')
}
