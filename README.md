# Postgres Provisioner

A small internal web app for creating and inspecting PostgreSQL databases on a
self-hosted Coolify instance. One admin, one form, ~10 project databases on one
Hetzner server.

It is a thin wrapper around the Coolify REST API. Coolify remains the source of
truth for the state of every database; this app's own SQLite holds only sessions,
create-job progress, an audit log, per-database notes Coolify has nowhere to put,
and the firewall allowlists described below.

What it does that clicking through Coolify does not:

- picks the lowest free host port in the configured range,
- stops before the first start if Coolify made the database without SSL, which is
  the last moment enabling it still takes effect,
- schedules the daily S3 backup,
- optionally manages who may reach each database, as real Hetzner firewall rules,
- and hands you a working `psql` connection string at the end.

Three documents, by audience: **[USAGE.md](USAGE.md)** if you have a project that
needs a database, **[SETUP.md](SETUP.md)** if you are hosting this app on your own
Coolify instance, and the rest of this file if you are changing its code.

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
and `NODE_ENV=development` (which makes Vite serve the client instead of Express).

`NODE_ENV` controls only that: which process serves the SPA. Everything that
depends on the *scheme* — the `Secure` cookie flag, HSTS,
`upgrade-insecure-requests` — follows `APP_ORIGIN` instead. So a production image
served over an `http://` domain, which is what Coolify's generated sslip.io
domains are, works correctly without pretending to be a development build.

Other scripts:

```bash
npm run build       # shared → frontend → backend
npm test            # port allocation, CIDR parsing, firewall rule ownership
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

Setting this up on a fresh Coolify instance? **[SETUP.md](SETUP.md)** is the
full walkthrough, with the reasoning behind each step and a troubleshooting table
covering every failure hit during the first real deployment. The summary below
assumes you already know the platform.

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

## The Coolify API contract

**Coolify renames API fields between releases.** Every version-dependent name in
this app lives in one marked block at the top of `backend/src/coolify.ts`:

```
// --- COOLIFY FIELD MAP ---
```

It is currently verified against **Coolify 4.3.21** — a live `GET /databases` on
the Hetzner box plus `openapi.json` at tag `v4.3.21`. Three properties of that
version shape the design, and are the first things to re-check after a Coolify
upgrade:

1. **SSL is not in the API at all.** No `enable_ssl` or `ssl_mode` on create or
   PATCH — the fields appear on the resource but in no request body. Worse,
   databases created through the API come out with SSL **off**; one created in
   the Coolify UI has it on only because there is a toggle there. The app reads
   the flag back, pauses the create before the first start when it is off, and
   warns wherever a database is running without it. It cannot turn SSL on — that
   has to be done in the Coolify UI.
2. **Passwords are never disclosed.** No read endpoint returns one, including
   `/envs`. But `postgres_password` *is* accepted on create, so the app
   generates one, sends it, and stores it — see the security section.
3. **Lifecycle is POST**, not GET, and create requires `environment_uuid` in
   addition to `environment_name`.

To re-verify after an upgrade:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/version"
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/databases" | jq '.[0]'
curl -sL "https://raw.githubusercontent.com/coollabsio/coolify/v<version>/openapi.json" \
  | jq '.paths["/databases/postgresql"].post.requestBody.content["application/json"].schema.properties | keys'
```

Diff against `RawDatabase` and the payload builders. If they disagree, that block
is the only thing to edit — nothing else in the codebase names a Coolify field.

Backups exist in 4.3.21 (`/databases/{uuid}/backups`). The app still probes at
startup, and if a version ever lacks the endpoint the create job marks the backup
step *skipped* — never *failed* — and the UI links out to Coolify.

## How create works

`POST /api/databases` validates the form, checks the name against Coolify,
allocates a port, and returns a job id. The job runs in-process but persists
every step transition, and the client polls `GET /api/jobs/:jobId` every 2s.

```
create → configure (public access) → [SSL checkpoint] → start → await-healthy → backup → done
```

Two things worth knowing:

- **Order matters.** The database is created with `instant_deploy: false` and is
  not started until public access is patched, because Coolify applies the port
  binding only on first data-directory creation. (SSL would belong in this step
  too, but 4.3.21 does not expose it — see the API contract section.)
- **The job stops before the first start if SSL is off.** Coolify 4.3.21 creates
  databases with SSL disabled and exposes no way to turn it on through the API,
  and it only applies SSL when the data directory is first created. So the job
  pauses at that exact point and waits: enable SSL on the database in Coolify,
  then press continue (which re-checks) — or continue without SSL deliberately.
  Pausing here is the difference between a one-click fix and recreating the
  database later.
- **Nothing is auto-deleted.** If a step after `create` fails, the resource stays
  and the job is marked failed with the step name; the UI says "created but not
  fully configured" and links into Coolify. Cleaning up is a deliberate act.

If the server restarts mid-create, `resumeRunningJobs()` re-checks the job against
Coolify on boot and either resumes from the first unfinished step or fails it with
a clear message. A job is never left stuck in `running`.

## Firewall allowlists

Optional, and off unless `HCLOUD_TOKEN` and `HCLOUD_FIREWALL_ID` are both set —
without them nothing here runs and no Hetzner call is ever made. With them, each
public database gets a list of allowed CIDRs which `backend/src/firewall.ts`
reconciles into inbound rules on one Hetzner Cloud firewall.

The design is dominated by one property of the API: `set_rules` replaces the
firewall's *entire* rule set. There is no add-one-rule endpoint and no
compare-and-swap, so every write is a read-modify-write. Hence:

- **Narrow ownership.** A rule belongs to this app only if it is inbound TCP,
  its port is a single port inside `PORT_RANGE`, *and* its description is
  `pgp:<database-uuid>`. Everything else — SSH, HTTP, anything added by hand — is
  copied through untouched. Getting this wrong locks you out of your own server.
- **The corollary, which the UI states on the affected database.** A hand-written
  rule that opens the port range carries no `pgp:` description, so it survives,
  and it keeps the port open to whoever it allows. Until it is deleted in the
  console an allowlist can only widen access, never restrict it.
- **Reconciles are serialised** behind an in-flight promise, and skipped entirely
  when the desired rules already match — no pointless writes.
- **SQLite never claims access the firewall does not grant.** The rows are
  written first (the desired rules are derived from them), and restored if
  Hetzner then refuses the change.
- An empty list produces no rule at all: the port is shut, not open.

The desired port for each rule comes from Coolify, not from SQLite, so applying
an allowlist needs Coolify reachable as well.

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
- **Database passwords are stored in SQLite, in plaintext, in `database_meta`.**
  This is deliberate and it is the one real secret in that file. Coolify 4.3.21
  accepts a password on create but never discloses one afterwards, so storing the
  generated password is the only way the details page can show a connection
  string that works. The consequence: **treat `$DATA_DIR/app.db` as a secret** —
  anyone who can read it can reach every database this app created. Keep the
  volume off backups that are less protected than the databases themselves.
  Databases created outside this app have no stored password, and the UI says so
  rather than showing a string that would not connect.
- Delete requires typing the database name; deleting the data volume is a
  separate, unchecked-by-default opt-in.

## Adding a non-superuser role

Out of scope for the app. Do it by hand once the database is running:

```bash
docker exec -it <container> psql -U postgres -d <db> \
  -c "CREATE ROLE app LOGIN PASSWORD '<password>';" \
  -c "GRANT ALL ON DATABASE <db> TO app;"
```
