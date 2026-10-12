import { sql } from '@/lib/db'
import { CLAIM_WINDOW_SECONDS } from '@/lib/limits'
import { deleteProject, listDropProjects, NeonApiError } from '@/lib/neon-api'

export const maxDuration = 300

// Runs every 10 minutes (vercel.json) and only deletes projects older than the
// one-hour window, so nothing goes before its buzzer. A claimed project has
// already moved to the claimer's org, so it no longer shows up in the listing.
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) 
    return new Response('Unauthorized', { status: 401 })
  const cutoff = Date.now() - CLAIM_WINDOW_SECONDS * 1000
  const projects = await listDropProjects()
  const expired = projects.filter((p) => new Date(p.created_at).getTime() < cutoff)
  const deleted: string[] = []
  for (const p of expired) {
    try {
      await deleteProject(p.id)
      deleted.push(p.id)
    } catch (err) {
      if (err instanceof NeonApiError && err.status === 404) deleted.push(p.id)
      else console.error('cleanup failed', p.id, err)
    }
  }
  // Close out every past-expiry row: deleted here, claimed, or already gone.
  const stillOurs = projects.filter((p) => !deleted.includes(p.id)).map((p) => p.id)
  await sql`
    update drops set deleted_at = now()
    where deleted_at is null and expires_at < now() and not (project_id = any(${stillOurs}))
  `
  return Response.json({ checked: projects.length, deleted })
}
