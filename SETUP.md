# Self-hosting this on your own Coolify instance

A step-by-step walkthrough for someone who has a Coolify server and wants this
app running against it. It assumes no prior knowledge of the codebase.

Roughly 30–45 minutes, most of which is waiting for Docker builds.

Every step says **why** it exists, because several of them look optional and are
not. The [Troubleshooting](#troubleshooting) table at the end lists every failure
we actually hit during the first deployment — if something goes wrong, look there
first; the odds are good it is already described.

---

## 0. What you need first

- **A Coolify instance** you administer (this was built against **4.3.21**), with
  at least one server and one project.
- **SSH access to that server.** You will need it once, and Coolify's in-browser
  terminal is unreliable on plain-HTTP instances.
- **A Postgres client** (`psql`) somewhere you can reach the server from, to
  prove the whole thing works at the end.
- Optional but recommended: **a domain** you can point at the server. Without it
  you get an `http://` sslip.io domain, which works but is unencrypted.

A note on what this app is, because it affects how you should treat it: it holds
an API token with **read+write+deploy on your entire Coolify instance**, and it
stores the passwords of every database it creates. It is infrastructure, not a
toy. Give it the same care you would give a CI runner.

---

## 1. Verify the Coolify API contract for *your* version

**Do this first. Everything else depends on it.**

Coolify renames and moves API fields between releases. This app concentrates
every version-dependent name in a single marked block at the top of
`backend/src/coolify.ts`:

```
// --- COOLIFY FIELD MAP ---
```

If your Coolify differs from 4.3.21, that block is the only thing you edit.
Nothing else in the codebase mentions a Coolify field name. Find your version
and compare:

```bash
export COOLIFY_URL=http://YOUR_SERVER:8000
export COOLIFY_TOKEN=...      # create this in step 2 first, then come back

curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/version"
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/databases" | jq '.[0]'
```

Then pull the exact OpenAPI spec for that version and check the request bodies:

```bash
curl -sL "https://raw.githubusercontent.com/coollabsio/coolify/v4.3.21/openapi.json" -o /tmp/openapi.json

# what POST /databases/postgresql accepts
jq '.paths["/databases/postgresql"].post.requestBody.content["application/json"].schema | {required, props: (.properties|keys)}' /tmp/openapi.json

# whether lifecycle is GET or POST
jq '.paths | to_entries[] | select(.key|test("databases/.*/(start|stop|restart)")) | {path: .key, methods: (.value|keys)}' /tmp/openapi.json
```

Three properties of 4.3.21 drive the design. Check each against your version:

| Property | In 4.3.21 | Why it matters |
|---|---|---|
| SSL fields | **Absent from the API entirely**, and API-created databases default to SSL **off** | The app cannot enable SSL. It pauses the create and asks you to do it in the UI. |
| Passwords | **Never returned** by any endpoint, but `postgres_password` is accepted on create | The app generates the password and stores it — otherwise connection strings would be unusable |
| Lifecycle verbs | **POST**, and create needs `environment_uuid` *and* `environment_name` | A GET answers 405; a create without the uuid answers 422 |

If your version differs, edit the field map and re-run the checks. Getting this
wrong produces confusing errors much later, which is exactly why it is step 1.

---

## 2. Create the API token — with `deploy`

Coolify → **Keys & Tokens** → **API tokens** → new token.

**The token must include the `deploy` permission**, not just read and write.
Creating and configuring a database uses write; *starting* it uses deploy. A
token without it gets you most of the way through a create and then fails with
`403 {"message":"Missing required permissions: deploy"}` at the Starting step —
leaving a created-but-never-started database behind.

Copy the token now; Coolify shows it once.

---

## 3. Allow the app's IP to use the API

This one is unintuitive and cost us the most time.

Coolify → **Settings** → **Advanced** → **API and MCP** → **Allowed API IPs**.

If that field is non-empty, only those addresses may call the API — and your app
will be calling it **from inside a Docker container**, not from your laptop. A
valid token from a non-allowed address gets:

```
403 {"success":true,"message":"You are not allowed to access the API."}
```

Find the subnet your containers actually use. Do not assume `172.16.0.0/12`;
Coolify installations vary and ours turned out to be `10.0.1.0/24`:

```bash
ssh root@YOUR_SERVER
docker network inspect coolify -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Add that subnet to the allowlist, keeping your own IP too:

```
YOUR.HOME.IP.ADDR,YOUR.SERVER.IP.ADDR,10.0.1.0/24
```

Use the **subnet**, not the container's current address — containers get a new
address on every deploy, and pinning one means re-editing this field forever.

Leaving the field empty also works; the bearer token still protects the API. The
allowlist is defence in depth, and worth keeping.

---

## 4. Connect the repository

**Public repo:** Coolify → New Resource → Application → Public Repository. Done.

**Private repo:** you need a GitHub App. Coolify → **Sources** → **New GitHub
App**:

- **Name** — must be globally unique on GitHub; keep the random suffix Coolify
  suggests.
- **Organization** — leave empty for a personal account.
- **Self-hosted / Enterprise GitHub** — leave the defaults
  (`https://github.com`, `https://api.github.com`, `git`, `22`). That section is
  only for GitHub Enterprise.
- **Preview deployment access** — set to read-only if offered. The write scope
  exists so Coolify can comment preview URLs on pull requests, which you will not
  use for an internal admin tool.

Register with GitHub, then when GitHub asks which repositories, choose **only
this one**. The App gets read access to code and webhook rights; there is no
reason to hand it your whole account.

---

## 5. Create the application

**New Resource → Application → Private Repository (with GitHub App)** → your
source → the repo → branch `main`.

Then:

| Setting | Value | Why |
|---|---|---|
| Build pack | **Dockerfile** | Nixpacks cannot build this npm-workspaces monorepo. It usually defaults to Nixpacks — change it. |
| Base directory | `/` | The Dockerfile is at the repo root |
| Port | `3000` | What the container listens on |
| Health check path | `/healthz` | Unauthenticated by design, so Coolify can poll it |

Do **not** deploy yet.

---

## 6. Add the persistent volume — before the first deploy

**Persistent Storage → Add Mount → Volume mount**

| Field | Value |
|---|---|
| Name | `pp-data` |
| Destination path | `/data` |
| Source path | *(leave empty — this makes it a named volume)* |

Pick **Volume mount**, not Directory mount: a named volume is managed by Docker
and needs no permissions work on the host. The container runs as a non-root user,
so a host directory owned by `root` would leave the app unable to open its
database file.

`/data` holds `app.db`, which contains your sessions, the create-job history, the
audit log, **and the passwords of every database this app creates**. Without this
volume all of that is destroyed on each redeploy, and the database passwords are
not recoverable from anywhere else.

Two consequences worth internalising:

- **Back this volume up.**
- **Treat `app.db` as a secret.** Anyone who can read it can connect to every
  database the app created.

---

## 7. Environment variables

Generate the two secrets first:

```bash
npm run hash-password -- 'a long admin password'   # → ADMIN_PASSWORD_HASH=$2a$12$...
openssl rand -hex 32                               # → SESSION_SECRET
```

`hash-password` prints only the hash — the plaintext is never stored anywhere, so
put it in your password manager as you go.

Then set these in Coolify → Environment Variables:

| Variable | Example | Notes |
|---|---|---|
| `COOLIFY_URL` | `http://10.0.1.5:8000` | Where the app reaches Coolify. Start with the public IP; see step 11. |
| `COOLIFY_TOKEN` | `1\|abc…` | From step 2. Mark secret. |
| `COOLIFY_SERVER_UUID` | `zeifr6b…` | Optional; resolved by the name `localhost` if empty |
| `COOLIFY_PROJECT_UUID` | `zzlafvh…` | Optional; first project if empty |
| `COOLIFY_ENVIRONMENT` | `production` | Must match an environment name in that project |
| `COOLIFY_S3_STORAGE_UUID` | *(empty)* | Needed for backups. See step 12. |
| `PUBLIC_HOST` | `1.2.3.4` | Host used in connection strings handed to applications. Deliberately **not** derived from `COOLIFY_URL`. |
| `PORT_RANGE_START` / `_END` | `5432` / `5441` | Host ports the app may allocate. **Your firewall must already allow this range.** |
| `DEFAULT_PG_IMAGE` | `postgres:18-alpine` | |
| `HCLOUD_TOKEN` | `abc…` | Optional; enables per-database IP allowlists. Mark secret. See step 13. |
| `HCLOUD_FIREWALL_ID` | `1234567` | Optional; required with `HCLOUD_TOKEN`. |
| `ADMIN_EMAIL` | `you@example.com` | The only account |
| `ADMIN_PASSWORD_HASH` | `$2a$12$…` | Mark secret. **See the warning below.** |
| `SESSION_SECRET` | 64 hex chars | Signs the session cookie. Mark secret. |
| `APP_ORIGIN` | `https://db.example.com` | Must match your domain exactly |
| `PORT` | `3000` | |
| `DATA_DIR` | `/data` | Must match the volume mount |

### The `$` trap

A bcrypt hash looks like `$2a$12$iaD3…`. **Coolify interpolates `$VARIABLES` in
environment values by default**, so it expands `$2a` and `$12` into nothing and
hands the container a truncated string. The variable looks populated, the app
starts, and every login fails with "Invalid email or password" — pointing you at
the password rather than the config.

Open `ADMIN_PASSWORD_HASH` and set **Interpolation** to the literal option. The
app now validates the hash's shape at boot and refuses to start with a clear
message if it was mangled, so you will not be left guessing — but it is easier to
set correctly the first time.

The same applies to any value containing `$`.

### `NODE_ENV`

Leave it unset. The Dockerfile sets `NODE_ENV=production`, which is correct.

It controls exactly one thing: whether Express serves the built client. It does
**not** control cookie security — that follows `APP_ORIGIN`'s scheme, so a
production build on an `http://` domain works correctly. Do not set
`NODE_ENV=development` to "fix" a cookie problem; that stops the client being
served at all.

---

## 8. Domain and `APP_ORIGIN`

Your application's **Domains** field holds the URL the app is served at. Coolify
pre-fills a generated `http://…sslip.io` domain if you set none.

`APP_ORIGIN` must equal that value exactly:

- same scheme (`http://` or `https://`)
- same host and port
- **no trailing slash, no path**

The CSRF check compares the browser's `Origin` header against this string, and
browsers send scheme+host+port only. A trailing slash makes every non-GET request
return `403 Cross-origin request rejected` — login works, then nothing else does.

**Getting HTTPS:** open Manage Domains and change `http://` to `https://` on the
sslip.io domain; Coolify will request a Let's Encrypt certificate. This usually
works, though sslip.io subdomains share rate limits. If it succeeds, update
`APP_ORIGIN` to match. A real domain you control is better.

Running over plain HTTP is workable for a trusted network, but your login
credentials and session cookie cross the network in the clear. Do not leave a
production instance there.

---

## 9. Deploy and verify

Hit **Deploy**. The first build takes a few minutes — three workspaces plus a
native `better-sqlite3` build.

Healthy startup logs look like exactly this:

```
[coolify] http://… version=4.3.21 project=My first project backups=supported
[server] listening on :3000 (production)
```

Then check from outside, before touching the UI:

```bash
APP=https://db.example.com

curl -s $APP/healthz                 # {"ok":true}
curl -s $APP/api/databases           # {"error":{"message":"Not authenticated."}}
curl -sI $APP/api/databases | grep -i cache-control   # no-store
curl -so /dev/null -w '%{http_code}\n' $APP/          # 200, the SPA
curl -so /dev/null -w '%{http_code}\n' $APP/audit     # 200, SPA fallback works
```

The 401 matters: it proves the API is not reachable without a session. If any
`/api/*` route answers with data here, stop and investigate.

Confirm no secret reached the browser bundle:

```bash
npm run build
grep -rE 'COOLIFY_TOKEN|ADMIN_PASSWORD_HASH|SESSION_SECRET' frontend/dist   # expect no hits
```

---

## 10. First login, first database

Log in, then **refresh the page**. If you are still logged in, sessions work. If
you are bounced to the login screen, see [Troubleshooting](#troubleshooting).

The footer should show your Coolify version and project. If it says "version
unknown", the app could not reach Coolify — the list will show an error banner
explaining why.

Now create a database. Expect the job to **pause before "Starting"** with:

> **Waiting for you: SSL is disabled**

This is the design, not a bug. Coolify creates API databases with SSL off, has no
API to change it, and only applies SSL when the data directory is first created.
The job stops at the last moment where enabling SSL still takes effect.

Do this:

1. Follow the "Open this database in Coolify" link.
2. Configuration → enable SSL.
3. Back in the app, press **"I've enabled SSL — continue"**. It re-reads the flag
   from Coolify and refuses if it is still off.

The job then starts the database, waits for healthy, and lands on the details
page. Prove it end to end from a machine your firewall allows:

```bash
psql "postgres://postgres:PASSWORD@YOUR_HOST:5433/yourname_db?sslmode=require"
```

If that connects over TLS, you are done.

---

## 11. Hardening, once it works

**Point `COOLIFY_URL` at the internal network.** The app sits on the `coolify`
Docker network, so it can reach Coolify without going out to the public
interface — which means the API token stops traversing it:

```
COOLIFY_URL=http://coolify:8080
```

Verify the internal hostname and port for your version first
(`docker network inspect coolify`). This also gives the app a stable source
address, which makes the step-3 allowlist behave predictably.

**Rotate the token** if it was ever pasted somewhere it should not have been —
chat, a ticket, a screenshot. New token, update the variable, redeploy.

**Get a real certificate**, as in step 8.

---

## 12. Backups

Backups need an S3 storage configured in Coolify. Check whether you have one:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" "$COOLIFY_URL/api/v1/s3-storages"
```

If that returns `[]`, add one in Coolify → Storages, then set
`COOLIFY_S3_STORAGE_UUID` and redeploy. Until then, creates still succeed and the
backup step reports **skipped** with an explanation — deliberately, so a missing
backup target never blocks provisioning a database.

Once configured, each created database gets a daily 03:00 backup, 14 retained,
plus one immediate run so a broken backup config surfaces now rather than at 03:00
on the day you need it.

---

## 13. Per-database IP allowlists (optional)

Without this, the ports in `PORT_RANGE` are opened once in the Hetzner console
and every provisioned database is reachable by whoever that rule allows. Set the
two variables below and each database instead gets its own **Allowed sources**
card: a list of CIDRs, applied to a real firewall rule when you save.

1. Hetzner Cloud console → **Firewalls** → create one (or use an existing one)
   and **attach it to the server**. Keep your SSH and HTTP rules; this app
   preserves every rule it does not own.
2. Copy the numeric id out of the firewall's URL →  `HCLOUD_FIREWALL_ID`.
3. Security → **API tokens** → generate one with **Read & Write** →
   `HCLOUD_TOKEN`. Mark it secret. Read-only is not enough: applying an
   allowlist rewrites rules.
4. Redeploy. The card appears on every public database's page.

**Then delete the broad `5432-5441` rule.** This is the step that matters. The
app only owns inbound TCP rules that sit inside `PORT_RANGE` *and* carry a
`pgp:<uuid>` description, so your hand-written range rule is left alone — and
keeps every port open to whatever it allows. Until it is gone, an allowlist can
only widen access, never restrict it. The UI says so on any database whose port
is covered by a rule it does not own.

A few properties worth knowing:

- An empty list means **no rule at all** — the port is shut, not open. The UI
  confirms before saving that.
- Internal-only databases have no card: they never pass through the firewall.
- Hetzner's API replaces the whole rule set on every write, and has no
  compare-and-swap. If you edit rules in the console while a save is in flight,
  last write wins. Edits from this app are serialised among themselves.
- If Hetzner refuses a change, the app restores its own rows — the list you see
  never claims access the firewall does not grant.

---

## Troubleshooting

Every one of these was hit during the first real deployment.

| Symptom | Cause | Fix |
|---|---|---|
| Login says "Invalid email or password" with the right password | Coolify interpolated the `$` in the bcrypt hash | Set `ADMIN_PASSWORD_HASH` interpolation to literal. The app now refuses to boot on a mangled hash and says so. |
| Login succeeds, then every request is 401 and you are logged out on refresh | Session cookie marked `Secure` on an `http://` origin, so the browser drops it | Make `APP_ORIGIN` match your actual scheme. Do **not** set `NODE_ENV=development`. |
| `403 "You are not allowed to access the API"` | Coolify's API IP allowlist does not include the container's subnet | Step 3. Note the subnet may not be `172.16.x`. |
| `403 "Missing required permissions: deploy"` at the Starting step | Token lacks the deploy scope | New token with deploy; the half-created database can then just be started |
| Backups checkbox disabled although your Coolify has the API | Startup probe ran while Coolify was unreachable | Fixed — resolution now retries on demand. On older builds, restart the app. |
| Blank white page, no error | CSP `upgrade-insecure-requests` rewriting assets to `https://` on an `http://` deployment | Fixed — the directive now follows `APP_ORIGIN`. |
| Build fails immediately | Build pack defaulted to Nixpacks | Set it to Dockerfile |
| `Invalid environment configuration:` on boot | A variable is missing or malformed | The message names each one. This is intentional: fail at boot, not at 3am. |
| Coolify's browser terminal hangs at "connecting…" | Its websocket relay does not work on a plain-HTTP instance | Use SSH and `docker exec` |
| Database list shows an error banner instead of databases | Coolify unreachable or rejecting the token | The banner quotes Coolify's own message and status code — read it. |
| Everything works but a database shows "password not recoverable" | It was created outside this app | Expected. Coolify never discloses passwords; only databases this app created have a stored one. |
| Allowed sources saved, but anyone can still connect | A hand-written firewall rule still covers the port | Step 13 — delete the broad `5432-5441` rule. The card warns when it finds one. |
| No **Allowed sources** card on a public database | `HCLOUD_TOKEN`/`HCLOUD_FIREWALL_ID` unset, or the database is internal-only | Step 13. The app refuses to boot if only one of the two is set. |
| Saving an allowlist returns 502 | Token lacks write permission, wrong firewall id, or Hetzner rate limit | The message names which. Nothing was changed on either side. |

---

## How it behaves under stress

Worth knowing before you rely on it:

- **Server restarts mid-create.** On boot, any in-flight job is re-checked
  against Coolify and either resumed from the first unfinished step or failed
  with a clear message. A job is never left stuck in "running".
- **A step fails after the database exists.** The resource is kept and the job is
  marked failed with the failing step named; the UI says "created but not fully
  configured" and links into Coolify. Nothing is ever auto-deleted.
- **Port allocation is stateless.** In-use ports are read from Coolify on every
  create, so a database deleted elsewhere frees its port immediately, and the
  lowest free port is reused rather than drifting upward.
- **Two creates at once.** Ports are re-checked after creation and patched if a
  collision happened in the gap.
- **Coolify goes down.** The app still starts and serves the UI — you need it
  reachable in order to *see* that Coolify is unreachable.
