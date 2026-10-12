import { Client } from '@neondatabase/serverless'

const client = new Client(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
await client.connect()

await client.query(`
  create table if not exists drops (
    id uuid primary key default gen_random_uuid(),
    project_id text not null unique,
    ip_hash text not null,
    file_name text not null,
    file_type text not null,
    file_size bigint not null,
    public_url text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    deleted_at timestamptz
  );
  create index if not exists drops_ip_created on drops (ip_hash, created_at desc);
  create index if not exists drops_open on drops (created_at) where deleted_at is null;

  alter table drops add column if not exists branch_id text;
  alter table drops add column if not exists s3_endpoint text;
  alter table drops add column if not exists claim_url text;
  alter table drops add column if not exists owner_hash text;
  create index if not exists drops_owner on drops (owner_hash) where deleted_at is null;

  -- One row per file. A browser session keeps adding files to the same project.
  create table if not exists uploads (
    id bigint generated always as identity primary key,
    project_id text not null,
    file_name text not null,
    file_type text not null,
    file_size bigint not null,
    public_url text not null,
    created_at timestamptz not null default now()
  );
  create index if not exists uploads_project on uploads (project_id, created_at desc);
  insert into uploads (project_id, file_name, file_type, file_size, public_url, created_at)
  select project_id, file_name, file_type, file_size, public_url, created_at
  from drops
  where public_url is not null and not exists (select 1 from uploads);
`)

await client.end()
console.log('migrated')
