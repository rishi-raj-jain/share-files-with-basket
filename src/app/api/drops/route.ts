import { ipHash } from '@/lib/client-ip'
import { sql } from '@/lib/db'
import { BUCKET, CLAIM_WINDOW_SECONDS, MAX_BYTES, MAX_FILES_PER_PROJECT, REGION, storedType } from '@/lib/limits'
import { createProject, createPublicBucket, createTransferRequest, deleteProject, NeonApiError, presignUpload, waitForStorage } from '@/lib/neon-api'
import { findActiveProject, ownerHash, readSessionToken, sessionCookie } from '@/lib/session'
import { randomBytes } from 'node:crypto'

export const maxDuration = 60

const PER_IP_PER_DAY = Number(process.env.DROPS_PER_IP_PER_DAY ?? 3)
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_DROPS ?? 25)

function safeKey(name: string) {
  const clean = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${randomBytes(6).toString('hex')}/${clean || 'file'}`
}

const publicUrlFor = (endpoint: string, key: string) => `${endpoint}/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`

function ndjson(run: (send: (event: object) => void) => Promise<void>, cookie: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      await run((event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      'set-cookie': cookie,
    },
  })
}

export async function POST(request: Request) {
  let body: { name?: unknown; type?: unknown; size?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.slice(0, 160) : ''
  const type = storedType(typeof body.type === 'string' ? body.type : '')
  const size = typeof body.size === 'number' ? body.size : -1
  if (!name || size <= 0) return Response.json({ error: 'Pick a file first.' }, { status: 400 })
  if (size > MAX_BYTES) return Response.json({ error: 'Files are capped at 10 MB.' }, { status: 413 })

  const token = readSessionToken(request) ?? randomBytes(24).toString('base64url')
  const key = safeKey(name)

  // Same browser, project still on the clock: skip straight to the upload.
  const active = await findActiveProject(token)
  if (active) {
    if (active.files.length >= MAX_FILES_PER_PROJECT)
      return Response.json(
        {
          error: `Your project already holds ${MAX_FILES_PER_PROJECT} files. Claim it or wait for the buzzer.`,
        },
        { status: 409 },
      )
    try {
      const presign = await presignUpload(active.projectId, active.branchId, key, type)
      const publicUrl = publicUrlFor(active.endpoint, key)
      await sql`
        insert into uploads (project_id, file_name, file_type, file_size, public_url)
        values (${active.projectId}, ${name}, ${type}, ${size}, ${publicUrl})
      `
      const secondsLeft = Math.floor((new Date(active.expiresAt).getTime() - Date.now()) / 1000)
      return ndjson(
        async (send) => {
          send({
            step: 'project',
            reused: true,
            projectId: active.projectId,
            region: REGION,
            ms: 0,
          })
          send({ step: 'bucket', reused: true, ms: 0 })
          send({
            step: 'ready',
            reused: true,
            projectId: active.projectId,
            region: REGION,
            upload: {
              url: presign.url,
              method: presign.method,
              headers: presign.headers,
            },
            publicUrl,
            claimUrl: active.claimUrl,
            expiresAt: active.expiresAt,
          })
        },
        sessionCookie(token, secondsLeft),
      )
    } catch (err) {
      // Claimed (it left our org) or already gone. Close it out and start fresh.
      if (!(err instanceof NeonApiError) || err.status >= 500) throw err
      await sql`update drops set deleted_at = now() where project_id = ${active.projectId}`
    }
  }

  const ip = ipHash(request)
  const [{ mine, open }] = (await sql`
    select
      count(*) filter (where ip_hash = ${ip} and created_at > now() - interval '1 day')::int as mine,
      count(*) filter (where deleted_at is null and created_at > now() - interval '2 hours')::int as open
    from drops
  `) as { mine: number; open: number }[]
  if (mine >= PER_IP_PER_DAY)
    return Response.json(
      {
        error: `That's ${PER_IP_PER_DAY} new projects today, the daily limit. Come back tomorrow.`,
      },
      { status: 429 },
    )
  if (open >= MAX_ACTIVE) return Response.json({ error: 'Every court is taken. Shoot again in a few minutes.' }, { status: 503 })

  const origin = new URL(request.url).origin

  return ndjson(
    async (send) => {
      let projectId: string | null = null
      try {
        let t = Date.now()
        const created = await createProject(randomBytes(3).toString('hex'))
        projectId = created.projectId
        const { branchId } = created
        await sql`
        insert into drops (project_id, branch_id, ip_hash, owner_hash, file_name, file_type, file_size, expires_at)
        values (${projectId}, ${branchId}, ${ip}, ${ownerHash(token)}, ${name}, ${type}, ${size},
                now() + make_interval(secs => ${CLAIM_WINDOW_SECONDS}))
      `
        send({
          step: 'project',
          projectId,
          region: REGION,
          ms: Date.now() - t,
        })

        t = Date.now()
        const endpoint = await waitForStorage(projectId, branchId)
        await createPublicBucket(projectId, branchId)
        send({ step: 'bucket', ms: Date.now() - t })

        const [presign, transfer] = await Promise.all([presignUpload(projectId, branchId, key, type), createTransferRequest(projectId, CLAIM_WINDOW_SECONDS)])
        const publicUrl = publicUrlFor(endpoint, key)
        const claimUrl = `https://console.neon.tech/app/claim?p=${projectId}&tr=${transfer.id}&ru=${encodeURIComponent(origin)}`
        await sql`
        update drops set s3_endpoint = ${endpoint}, claim_url = ${claimUrl}, public_url = ${publicUrl},
          expires_at = ${transfer.expires_at}
        where project_id = ${projectId}
      `
        await sql`
        insert into uploads (project_id, file_name, file_type, file_size, public_url)
        values (${projectId}, ${name}, ${type}, ${size}, ${publicUrl})
      `
        send({
          step: 'ready',
          reused: false,
          projectId,
          region: REGION,
          upload: {
            url: presign.url,
            method: presign.method,
            headers: presign.headers,
          },
          publicUrl,
          claimUrl,
          expiresAt: transfer.expires_at,
        })
      } catch (err) {
        console.error('drop failed', err)
        send({
          step: 'error',
          message: 'Neon blocked that one. Take another shot.',
        })
        if (projectId) {
          // Drop the row too, so a shot Neon blocked doesn't use up one of today's projects.
          // If the delete above failed, the cron still finds the project by its name prefix.
          await deleteProject(projectId).catch(() => {})
          await sql`delete from drops where project_id = ${projectId}`.catch(() => {})
        }
      }
    },
    sessionCookie(token, CLAIM_WINDOW_SECONDS),
  )
}
