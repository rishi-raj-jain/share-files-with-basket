# Nothing But Neon

Temporary file sharing with a shot clock. Grab the file, shoot it at the hoop, and your first basket:

1. Spins up a fresh Neon project in AWS us-east-2.
2. Adds a public Neon Object Storage bucket to it.
3. Uploads your file straight from the browser to that bucket through a presigned URL.
4. Gives you a public link to share and a claim link for the project.

Every basket after that, from the same browser, lands in the same project and bucket (an httpOnly session cookie remembers it). Links work for an hour. Claim the project in that hour to keep the files, otherwise a cron that runs every 10 minutes deletes projects once they pass the one-hour mark.

Misses count too: off the rim or airball. Inspired by [An agent provisions a Neon backend, a human claims it later](https://neon.com/blog/an-agent-provisions-a-neon-backend-a-human-claims-it-later).

## Stack

- Next.js on Vercel, functions pinned to `cle1` (Cleveland), next to the database
- Neon Postgres in `aws-us-east-2` for sessions and rate limits (shot stats stay in the browser)
- Neon API (org key) for per-basket projects, buckets, presigned uploads and transfer requests

## Run it

```bash
npm install
npm run db:migrate
npm run dev
```

`.env.local` needs `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_API_KEY` (org key), `NEON_ORG_ID`, `CRON_SECRET` and `IP_SALT`. Optional caps: `DROPS_PER_IP_PER_DAY` (default 3) and `MAX_ACTIVE_DROPS` (default 25).

Built by [Rishi](https://x.com/rishi_raj_jain_).
