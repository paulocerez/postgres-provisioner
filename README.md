# Postgres Provisioner

A small internal web app for creating and inspecting PostgreSQL databases on a
self-hosted Coolify instance. One admin, one form, ~10 project databases on one
Hetzner server.

It is a thin wrapper around the Coolify REST API. Coolify remains the source of
truth for the state of every database; this app's own SQLite holds only sessions,
create-job progress, an audit log, and per-database notes Coolify has nowhere to
put.

What it does that clicking through Coolify does not:

- picks the lowest free host port in the configured range,
- enables SSL **before** the first start (Coolify only applies SSL and the
  initial password when the data directory is first created),
- schedules the daily S3 backup,
- and hands you a working `psql` connection string at the end.

## Stack

npm workspaces: `shared/` (zod schemas used by both sides), `backend/`
(Express 4 + Drizzle/SQLite), `frontend/` (React 18 + Vite, TanStack
Router/Query/Form/Table, Tailwind). One Docker image; in production Express
serves the built SPA.

## Local development

```bash
npm install
cp .env.example .env          # fill in COOLIFY_TOKEN and the admin credentials
npm run hash-password -- 'a long admin password'   # → ADMIN_PASSWORD_HASH=...
npm run build -w shared       # backend and frontend compile against its types
npm run dev                   # Express on :3000, Vite on :5173 proxying /api
```

For local development set `DATA_DIR=./data`, `APP_ORIGIN=http://localhost:5173`
and `NODE_ENV=development` (the session cookie is only `Secure` in production, so
it would not survive plain HTTP otherwise).

Other scripts:

```bash
npm run build       # shared → frontend → backend
npm test            # port-allocation unit tests
npm run typecheck   # all three workspaces
npm run db:generate # regenerate drizzle/ after editing backend/src/db/schema.ts
```

Migrations in `backend/drizzle/` are committed and applied automatically on every
server start, so a deploy never runs drizzle-kit.

## Environment variables

See `.env.example`. All of them are validated with zod at startup — a missing or
malformed value fails immediately with a list of what is wrong, rather than
surfacing as an `undefined` later.

`COOLIFY_TOKEN` and `ADMIN_PASSWORD_HASH` exist only on the server. Nothing
secret is prefixed with `VITE_`, which would inline it into the browser bundle.
To confirm after a build:

```bash
grep -rE 'COOLIFY_TOKEN|ADMIN_PASSWORD_HASH|SESSION_SECRET' frontend/dist   # no hits
```

## Deploying on Coolify

1. Push this repo to GitHub.
2. Coolify → your project → **New Resource → Application → GitHub**. A public
   repo URL is enough; otherwise install the Coolify GitHub app.
3. **Build pack: Dockerfile.** Port: `3000`.
4. Add the environment variables from `.env.example`. Mark `COOLIFY_TOKEN`,
   `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` as secret.
5. Under **Persistent Storage**, add a volume mounted at `/data`. Without it the
   SQLite file is lost on every redeploy, taking sessions, jobs and the audit log
   with it.
6. Set the domain to `https://db.<your-domain>` and make `APP_ORIGIN` match it
   exactly — the CSRF check rejects mutations from any other origin.
7. Deploy, then visit `/login`.

### Pointing `COOLIFY_URL` at the internal network

The app and Coolify run on the same Docker host, so `COOLIFY_URL` can be an
internal address (e.g. `http://coolify:8080` on the `coolify` Docker network)
instead of routing out to the public IP and back. Verify the internal hostname
and port for your installed version, and attach the app to that network in
Coolify's settings. If that is awkward, the public URL works fine — it is just an
extra hop.

`PUBLIC_HOST` is separate on purpose: it is the host that goes into connection
strings handed to applications, and it is never derived from `COOLIFY_URL`.

## Verifying the Coolify API contract

**Coolify renames API fields between releases.** Every version-dependent name in
this app lives in one marked block at the top of `backend/src/coolify.ts`:

```
// --- COOLIFY FIELD MAP ---
```

Before trusting it against a new installation:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/version"
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/databases" | jq '.[0]'
```

Diff the returned keys against `RawDatabase` and the payload builders. If they
disagree, that block is the only thing to edit — nothing else in the codebase
references a Coolify field name.

Backup scheduling is the likeliest gap between versions. The app probes for it at
startup: when the endpoint is missing, the create job marks the backup step
*skipped* (never *failed*) and the UI shows a link to configure it in Coolify.

## How create works

`POST /api/databases` validates the form, checks the name against Coolify,
allocates a port, and returns a job id. The job runs in-process but persists
every step transition, and the client polls `GET /api/jobs/:jobId` every 2s.

```
create → configure (SSL + public access) → start → await-healthy → backup → done
```

Two things worth knowing:

- **Order matters.** The database is created with `instant_deploy: false` and is
  not started until SSL and public access are patched, because Coolify applies
  both only on first data-directory creation.
- **Nothing is auto-deleted.** If a step after `create` fails, the resource stays
  and the job is marked failed with the step name; the UI says "created but not
  fully configured" and links into Coolify. Cleaning up is a deliberate act.

If the server restarts mid-create, `resumeRunningJobs()` re-checks the job against
Coolify on boot and either resumes from the first unfinished step or fails it with
a clear message. A job is never left stuck in `running`.

## Security

- Every `/api` route except `POST /api/auth/login` and `GET /healthz` requires a
  session; the client hiding a button is not the control.
- Session ids are random 32-byte tokens; only their SHA-256 is stored, and the
  cookie is signed with `SESSION_SECRET`, `HttpOnly`, `SameSite=Lax`, and `Secure`
  in production. Logout deletes the row, so revocation is real.
- Login is rate-limited to 5 attempts per 15 minutes per IP, and wrong email and
  wrong password return the same message after the same work.
- CSRF: `SameSite=Lax` plus an `Origin`/`Referer` check against `APP_ORIGIN` and a
  required `Content-Type: application/json` on every mutation.
- `helmet` with a self-only CSP; `Cache-Control: no-store` on all `/api`
  responses (several contain passwords).
- Passwords and connection strings are redacted before anything is logged or
  written to the audit log.
- Delete requires typing the database name; deleting the data volume is a
  separate, unchecked-by-default opt-in.

## Adding a non-superuser role

Out of scope for the app. Do it by hand once the database is running:

```bash
docker exec -it <container> psql -U postgres -d <db> \
  -c "CREATE ROLE app LOGIN PASSWORD '<password>';" \
  -c "GRANT ALL ON DATABASE <db> TO app;"
```
