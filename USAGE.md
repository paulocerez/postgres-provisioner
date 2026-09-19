# Connecting a project to a database

You have an application that needs Postgres. This is how you give it one.

For hosting this app, see [SETUP.md](SETUP.md); for how it works internally, see
[README.md](README.md). You need neither to follow this.

One thing to get out of the way first: **this app does not wire anything to
anything.** The "Project / owner" fields on the create form are a label stored in
its own SQLite so you can tell later which database belongs to what — they never
reach Coolify, and they do not configure your application. Connecting means
copying a connection string into your app's configuration, and, if the app lives
off this server, allowing its IP through the firewall.

---

## 1. Decide how your application will reach it

This is the only decision that is hard to change later, so make it first.

| | **Internal** | **Public** |
|---|---|---|
| Use when | your app runs on this same server, as a Coolify resource | your app runs anywhere else |
| Host | the database's container uuid, port `5432` | `PUBLIC_HOST`, a port from `PORT_RANGE` |
| Traffic | stays on the Coolify Docker network | crosses the public internet |
| Firewall | not involved | must allow your app's address |
| Encryption | unnecessary — nothing leaves the host | **you want SSL**, see step 2 |

Prefer internal whenever it is possible. It needs no firewall rule, no TLS, and
no address that changes.

You choose this on the create form as **Access: internal / public**. The app
deliberately has no toggle afterwards: Coolify binds the host port only when the
data directory is first created, so switching later is a Coolify operation, not a
one-click change here. Pick correctly now.

> **Serverless platforms** (Vercel, Lambda, most CI) connect from rotating
> addresses you cannot enumerate, so the public route fits them badly — you would
> have to allow a wide range, which is barely a restriction. Either run the app on
> this server, or put a connection proxy in front. This app will not pretend
> otherwise.

---

## 2. Create the database

**New database**, then:

- **Name** — lowercase, gets a `-db` suffix. `demo` becomes `demo-db`, and the
  Postgres database inside it is `demo_db` (hyphens are not legal in a database
  name). The role is always `postgres`.
- **Version**, **Access** (step 1), **Backups**.
- **Notes** — project and owner. Worth filling in: in six months this is the only
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

The detail page shows both forms, masked. Take the one you chose in step 1:

```
postgres://postgres:••••••••@2.28.117.37:5433/demo_db?sslmode=require   ← Public
postgres://postgres:••••••••@kso8w0k...:5432/demo_db                    ← Internal
```

The **`.env`** button next to it copies a ready line:

```
DATABASE_URL=postgres://postgres:REAL_PASSWORD@2.28.117.37:5433/demo_db?sslmode=require
```

**Read the `sslmode` before you use it.** The string describes the database as it
actually is, not as it should be — `sslmode=disable` means SSL was never enabled
(step 2) and the string is honest about it, because `sslmode=require` against a
server without SSL simply fails to connect. On a public database, `disable` means
the password you just copied will cross the internet in clear text.

Two smaller things:

- Copying needs a secure context. On a plain-`http://` deployment of this app the
  clipboard may be blocked; the UI tells you rather than silently doing nothing.
- If the page says the password is not recoverable, the database was created
  outside this app. Coolify never discloses passwords, so use the credentials you
  already hold.

---

## 4. Allow your application through the firewall

Public databases only; skip this for internal ones.

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

**An app running on this server (Coolify):** open your application in Coolify →
**Environment Variables** → paste the `.env` line using the **internal** URL. It
resolves over the Coolify Docker network, so no firewall rule and no TLS are
needed. Redeploy.

**An app anywhere else:** paste the **public** line into whatever holds your
secrets, and make sure step 4 includes that host's address.

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
- **Keep the Notes field honest.** It is the only link between a database and the
  project that depends on it.

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
