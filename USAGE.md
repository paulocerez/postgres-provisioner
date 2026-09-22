# Connecting a project to a database

You have an application that needs Postgres. This is how you give it one.

For hosting this app, see [SETUP.md](SETUP.md); for how it works internally, see
[README.md](README.md). You need neither to follow this.

The expected shape of things: several projects — frontends and backends on
Vercel, Render or similar — each holding a connection string to a database on
this box. This document is how you get one of those strings and make it work
from where your code actually runs.

Today that last step is yours to take: you copy the string into whatever holds
your project's secrets, and — if you take the public route — allow its IP through
the firewall. The "Project / owner" fields on the create form record which
project a database belongs to; they are stored in this app's own SQLite and do
not reach Coolify or configure anything on their own.

---

## 1. Decide how your application will reach it

This is the only decision that is hard to change later, so make it first.

| | **Internal** | **Over TLS** | **Public** |
|---|---|---|---|
| Use when | your app runs on this same server, as a Coolify resource | your app runs anywhere, especially on rotating addresses | your app has a fixed address and an old driver |
| Host | the database's container uuid, port `5432` | `PG_GATEWAY_HOST`, port `443` | `PUBLIC_HOST`, a port from `PORT_RANGE` |
| Traffic | stays on the Coolify Docker network | crosses the public internet | crosses the public internet |
| Firewall | not involved | not involved — no port is opened | must allow your app's address |
| Encryption | unnecessary — nothing leaves the host | `verify-full`, against a real certificate | `require` at best, see step 2 |
| Needs | nothing | PostgreSQL 17+ and a driver that does `sslnegotiation=direct` | a fixed egress address |

Prefer internal whenever it is possible. It needs no firewall rule, no TLS, and
no address that changes.

You choose internal or public on the create form as **Access: internal /
public**. The app deliberately has no toggle afterwards: Coolify binds the host
port only when the data directory is first created, so switching later is a
Coolify operation, not a one-click change here. Pick correctly now.

**The TLS route is not one of those choices** — it is not a property of the
database at all. If this deployment has a gateway configured, every database gets
that connection string, internal ones included, because the gateway reaches them
over the Docker network rather than through a published port. If the string is
not on the detail page, no gateway is configured here; see
[SETUP.md](SETUP.md) step 14.

> **Serverless platforms** (Vercel, Lambda, most CI) connect from rotating
> addresses you cannot enumerate. An IP allowlist cannot express that, and
> widening one until it does means `0.0.0.0/0`, which is not a restriction — the
> app asks you to confirm that in as many words, and refuses it outright on a
> database without SSL.
>
> **Use the TLS route instead.** It authenticates the server with a real
> certificate rather than trusting where the client connects from, so it needs no
> allowlist entry at all. Its one requirement is the driver: `pg` (node-postgres)
> supports `sslnegotiation=direct`; several others do not yet. Check yours before
> you commit to it.
>
> The alternative, if your driver cannot: Vercel's Static IPs (Pro and
> Enterprise, billed per project) give you a fixed egress pair to allow. Be aware
> that the pair is a NAT gateway shared with other customers in that region, so
> allowing it narrows the internet to one gateway — it is not an authentication
> boundary.

---

## 2. Create the database

**New database**, then:

- **Name** — lowercase, gets a `-db` suffix. `demo` becomes `demo-db`, and the
  Postgres database inside it is `demo_db` (hyphens are not legal in a database
  name). The role is always `postgres`.
- **Version**, **Access** (step 1), **Backups**.
- **Notes** — project and owner. Worth filling in: for now this is the only
  record of which application uses this database.

The job then **pauses before starting** and asks you to enable SSL in Coolify.
This is not optional ceremony. Coolify creates databases through its API with SSL
off, exposes no way to change it, and applies SSL only when the data directory is
first created — so this pause is the last moment it can be turned on at all.
Follow the link, enable SSL, come back, press continue.

If you skip it, the database works, but every public connection crosses the
network unencrypted **and there is no way to fix it afterwards short of
recreating the database**. For an internal-only database it matters much less.

---

## 3. Copy the connection string

The detail page shows each available form, masked. Take the one you chose in
step 1:

```
postgres://…@2.28.117.37:5433/demo_db?sslmode=require                    ← Public
postgres://…@kso8w0k...:5432/demo_db                                     ← Internal
postgres://…@pg.example.com:443/demo_db?sslmode=verify-full&sslnegotiation=direct
                                                                         ← Over TLS
```

The third appears only when this deployment has a gateway configured.

The **`.env`** button next to it copies a ready line:

```
DATABASE_URL=postgres://postgres:REAL_PASSWORD@2.28.117.37:5433/demo_db?sslmode=require
```

**Read the `sslmode` before you use it.** The string describes the database as it
actually is, not as it should be — `sslmode=disable` means SSL was never enabled
(step 2) and the string is honest about it, because `sslmode=require` against a
server without SSL simply fails to connect. On a public database, `disable` means
the password you just copied will cross the internet in clear text.

The TLS string is the exception: its `verify-full` describes the gateway's
certificate, not the container's, so it reads the same whether or not step 2 was
done. Nothing is being glossed over — on that route the unencrypted hop never
leaves the host.

Two smaller things:

- Copying needs a secure context. On a plain-`http://` deployment of this app the
  clipboard may be blocked; the UI tells you rather than silently doing nothing.
- If the page says the password is not recoverable, the database was created
  outside this app. Coolify never discloses passwords, so use the credentials you
  already hold.

---

## 4. Allow your application through the firewall

**Public databases only** — skip this entirely for internal ones, and for the TLS
route, which opens no port and so has nothing to allow.

On the detail page, **Allowed sources** → add the address your application
connects *from*, in CIDR form, with a label saying which project it is. A single
address is `/32` (IPv4) or `/128` (IPv6):

```
203.0.113.4/32   vetpal-api production
```

Find it from the machine itself — not from your laptop, unless your laptop is the
client:

```bash
curl -s https://ifconfig.me
```

Press **Apply to firewall**. That writes a real rule on the Hetzner firewall,
scoped to this database's port and these sources.

Two properties worth knowing:

- **An empty list means the port is shut**, not open. Removing the last entry
  removes the rule entirely; the UI confirms before it does.
- **A firewall rule this app does not own can keep the port open anyway.** It
  only manages rules it created, so a hand-written rule covering the port range
  survives and keeps letting everyone in. The card warns you when it finds one —
  delete it in the Hetzner console and the allowlist becomes real.

If the card is not there at all, this deployment has no `HCLOUD_TOKEN` /
`HCLOUD_FIREWALL_ID` configured and the firewall is managed by hand; see
[SETUP.md](SETUP.md) step 13.

---

## 5. Put it in your application

**A Vercel project:** use **Connected projects** on the detail page. Pick the
project, confirm the variable name and which environments to write, press
**Connect** — the app sets the variable through Vercel's API, marked sensitive,
and records what it sent where. Then redeploy on Vercel: setting a variable does
not affect deployments that are already running.

Two things it deliberately does not do. It will not write an unencrypted
connection string to a **production** environment — on a database with SSL off
the public string reads `sslmode=disable`, and that is a disclosure rather than
a preference, so it answers 409 and asks you to use the TLS route or target
preview and development instead. And disconnecting forgets the record here
without deleting the variable from Vercel, because breaking that project's next
deploy is not a reasonable thing for a row-deletion button to do.

If the card is not there, this deployment has no `VERCEL_TOKEN`; see
[SETUP.md](SETUP.md) step 15.

**An app running on this server (Coolify):** open your application in Coolify →
**Environment Variables** → paste the `.env` line using the **internal** URL. It
resolves over the Coolify Docker network, so no firewall rule and no TLS are
needed. Redeploy.

**An app anywhere else:** paste the **Over TLS** line into whatever holds your
secrets — there is no step 4 for it. If you are using the **public** line
instead, make sure step 4 includes that host's address.

**On Vercel:** use the TLS line, and confirm your `pg` version supports
`sslnegotiation=direct` first. Set `max: 1` on the pool — each concurrent
invocation opens its own connection, and Postgres defaults to 100 of them.

Then prove it from the application's own environment, not from your laptop —
"works on my machine" is exactly the failure mode the firewall introduces:

```bash
psql "$DATABASE_URL" -c "select version();"
```

A hang that eventually times out means the firewall is blocking you. An immediate
"connection refused" means the database is not running or the port is wrong. An
SSL error means `sslmode` disagrees with step 2.

---

## 6. Afterwards

- **Do not hand your application the `postgres` superuser** if it matters to you.
  The app creates only that role; making a restricted one is a manual step,
  documented at the end of [README.md](README.md).
- **Rotating the password is not supported here.** Change it in Postgres and the
  string this app shows becomes wrong — it stores the password it generated at
  create time and has no way to learn a new one.
- **Deleting a database frees its port for the next one**, and clears its
  allowlist rule with it. Nothing from the old database's access survives.
- **Keep the Project / owner fields honest.** Together with Connected projects
  they are the record of which project depends on which database, and in six
  months that is the question you will be asking.

---

## If it does not connect

| Symptom | Likely cause |
|---|---|
| Hangs, then times out | Firewall. The app's address is not in **Allowed sources**, or it connects from a different address than you think. |
| Connection refused, immediately | Database stopped, or the wrong port. Check the status badge and the port on the detail page. |
| `SSL is not enabled on the server` | The string says `require` but SSL was never enabled. See step 2 — this is not fixable after creation. |
| `no pg_hba.conf entry … no encryption` | The opposite: the server wants SSL and your client asked for none. Use the string as given. |
| Authentication failed | The password was changed outside this app, or the database was not created by it. |
| Works from your laptop, not from the app | You allowed your own IP, not the application's egress address. |
| TLS string hangs, or resets after the handshake | The gateway's SNI route is not matching. Check it with `openssl s_client -connect <host>:443 -servername <host> -alpn postgresql`. |
| `unsupported startup parameter` or a driver error on `sslnegotiation` | Your driver does not do direct TLS negotiation. Use the public route, or change driver. |
| `No database named "…" is managed by this gateway` | The gateway routes by the *Postgres* database name (`demo_db`), not the Coolify resource name (`demo-db`). |
