import { createHash } from 'node:crypto'
import { sql } from './db'

// An httpOnly cookie ties a browser to the project its first basket created,
// so later baskets reuse that project and bucket until the buzzer.
export const SESSION_COOKIE = 'nbn_session'

export type SharedFile = {
  name: string
  type: string
  size: number
  publicUrl: string
}

export type ActiveProject = {
  projectId: string
  branchId: string
  endpoint: string
  claimUrl: string
  expiresAt: string
  files: SharedFile[]
}

export function readSessionToken(request: Request) {
  const match = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([\\w-]+)`))
  return match?.[1] ?? null
}

export const ownerHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
}

// Leaves a two-minute margin so a reused project never expires mid-upload.
export async function findActiveProject(token: string | null): Promise<ActiveProject | null> {
  if (!token) return null
  const [row] = (await sql`
    select project_id, branch_id, s3_endpoint, claim_url, expires_at
    from drops
    where owner_hash = ${ownerHash(token)}
      and deleted_at is null
      and claim_url is not null
      and expires_at > now() + interval '2 minutes'
    order by created_at desc
    limit 1
  `) as {
    project_id: string
    branch_id: string
    s3_endpoint: string
    claim_url: string
    expires_at: string
  }[]
  if (!row) return null
  const files = (await sql`
    select file_name as name, file_type as type, file_size::int as size, public_url as "publicUrl"
    from uploads where project_id = ${row.project_id}
    order by created_at desc
  `) as SharedFile[]
  return {
    projectId: row.project_id,
    branchId: row.branch_id,
    endpoint: row.s3_endpoint,
    claimUrl: row.claim_url,
    expiresAt: new Date(row.expires_at).toISOString(),
    files,
  }
}
