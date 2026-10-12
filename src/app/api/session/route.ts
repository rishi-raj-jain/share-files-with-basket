import { REGION } from '@/lib/limits'
import { findActiveProject, readSessionToken } from '@/lib/session'

// Lets a reloaded page pick up the project this browser is already sharing from.
export async function GET(request: Request) {
  const active = await findActiveProject(readSessionToken(request))
  const session = active && {
    projectId: active.projectId,
    region: REGION,
    claimUrl: active.claimUrl,
    expiresAt: active.expiresAt,
    files: active.files,
  }
  return Response.json({ session }, { headers: { 'cache-control': 'no-store' } })
}
