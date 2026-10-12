import { BUCKET, PROJECT_PREFIX, REGION } from './limits'

const API = 'https://console.neon.tech/api/v2'

export class NeonApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  // 423 means another operation still holds the project lock, so wait and retry.
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(API + path, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${process.env.NEON_API_KEY}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    })
    if (res.status === 423) {
      await new Promise((r) => setTimeout(r, 250))
      continue
    }
    const text = await res.text()
    if (!res.ok) {
      let message = `Neon API ${res.status}`
      try {
        message = JSON.parse(text).message ?? message
      } catch {}
      throw new NeonApiError(res.status, message)
    }
    return (text ? JSON.parse(text) : null) as T
  }
  throw new NeonApiError(423, 'Neon project stayed locked for too long')
}

export async function createProject(suffix: string) {
  const data = await call<{ project: { id: string }; branch: { id: string } }>('/projects', {
    method: 'POST',
    body: {
      project: {
        name: `${PROJECT_PREFIX}${suffix}`,
        region_id: REGION,
        org_id: process.env.NEON_ORG_ID,
        default_endpoint_settings: { suspend_timeout_seconds: 60 },
      },
    },
  })
  return { projectId: data.project.id, branchId: data.branch.id }
}

export async function waitForStorage(projectId: string, branchId: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const s = await call<{ enabled: boolean; s3_endpoint?: string }>(`/projects/${projectId}/branches/${branchId}/storage`)
      if (s.enabled && s.s3_endpoint) return s.s3_endpoint
    } catch (err) {
      if (!(err instanceof NeonApiError) || err.status !== 404) throw err
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Object storage did not come up in time')
}

export function createPublicBucket(projectId: string, branchId: string) {
  return call(`/projects/${projectId}/branches/${branchId}/buckets`, {
    method: 'POST',
    body: { name: BUCKET, access_level: 'public_read' },
  })
}

export function presignUpload(projectId: string, branchId: string, key: string, contentType: string) {
  return call<{
    url: string
    method: string
    headers: Record<string, string>
    expires_at: string
  }>(`/projects/${projectId}/branches/${branchId}/buckets/${BUCKET}/objects/${encodeURIComponent(key)}/presign`, {
    method: 'POST',
    body: {
      operation: 'upload',
      content_type: contentType,
      expires_in_seconds: 600,
    },
  })
}

export function createTransferRequest(projectId: string, ttlSeconds: number) {
  return call<{ id: string; expires_at: string }>(`/projects/${projectId}/transfer_requests`, {
    method: 'POST',
    body: { ttl_seconds: ttlSeconds },
  })
}

export function listDropProjects() {
  return call<{ projects: { id: string; name: string; created_at: string }[] }>(`/projects?org_id=${process.env.NEON_ORG_ID}&search=${PROJECT_PREFIX}&limit=400`).then((d) =>
    d.projects.filter((p) => p.name.startsWith(PROJECT_PREFIX)),
  )
}

export function deleteProject(projectId: string) {
  return call(`/projects/${projectId}`, { method: 'DELETE' })
}
