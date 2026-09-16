import { useRef, useState } from 'react';
import type { DatabaseDetail } from '@app/shared';
import { useCopy } from '../hooks/use-copy';
import { CopyIcon, EyeIcon, EyeOffIcon } from './icons';
import { maskUrl } from './connection-string';

/**
 * Ready-to-paste client setup for one database.
 *
 * The connection string above this panel is only half the job: Coolify's
 * Postgres serves a self-signed certificate, so a driver left on its defaults
 * fails verification, and the usual reflex — turning SSL off — is the wrong
 * answer for a database on a public port. These snippets carry the right `ssl`
 * option for *this* database, so that decision is never made from memory.
 */

const PLACEHOLDER_PASSWORD = 'PASSWORD';

type Tab = 'env' | 'postgres-js' | 'node-postgres';

const TABS: { id: Tab; label: string }[] = [
  { id: 'env', label: '.env' },
  { id: 'postgres-js', label: 'postgres.js' },
  { id: 'node-postgres', label: 'node-postgres' },
];

export function ConnectSnippets({
  database,
  publicHost,
}: {
  database: DatabaseDetail;
  publicHost?: string;
}) {
  const [tab, setTab] = useState<Tab>('env');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const url = connectionUrl(database, publicHost);
  if (!url) return null;

  // Only the .env tab ever renders the password; both db.ts snippets read it
  // from the environment, which is also the habit worth encouraging.
  const hasRealPassword = Boolean(database.postgresPassword);

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = TABS.findIndex((candidate) => candidate.id === tab);
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    if (!next) return;
    setTab(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Connect from an app</h2>
      </div>

      <div className="border-b border-line px-2">
        <div role="tablist" aria-label="Client snippets" className="flex gap-1">
          {TABS.map((candidate, index) => (
            <button
              key={candidate.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`connect-tab-${candidate.id}`}
              aria-controls={`connect-panel-${candidate.id}`}
              aria-selected={tab === candidate.id}
              tabIndex={tab === candidate.id ? 0 : -1}
              className={tab === candidate.id ? 'tab-active' : 'tab'}
              onClick={() => setTab(candidate.id)}
              onKeyDown={onTabKeyDown}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`connect-panel-${tab}`}
        aria-labelledby={`connect-tab-${tab}`}
        className="card-body space-y-4"
      >
        {tab === 'env' && (
          <>
            <CodeBlock label=".env" code={`DATABASE_URL=${url}`} secret={hasRealPassword} />
            <CodeBlock label="drizzle.config.ts" code={drizzleConfig()} />
          </>
        )}
        {tab === 'postgres-js' && (
          <>
            <CodeBlock label="Install" code="npm i drizzle-orm postgres" />
            <CodeBlock label="src/db.ts" code={postgresJsSnippet(database.sslEnabled)} />
          </>
        )}
        {tab === 'node-postgres' && (
          <>
            <CodeBlock label="Install" code="npm i drizzle-orm pg && npm i -D @types/pg" />
            <CodeBlock label="src/db.ts" code={nodePostgresSnippet(database.sslEnabled)} />
          </>
        )}

        {!hasRealPassword && (
          <p className="hint">
            This app has no password for this database, so{' '}
            <code className="font-mono text-xs">{PLACEHOLDER_PASSWORD}</code> is a placeholder —
            substitute the one you hold.
          </p>
        )}
      </div>
    </section>
  );
}

/** A labelled, copyable block. `secret` adds the reveal toggle. */
function CodeBlock({ label, code, secret }: { label: string; code: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const copy = useCopy();
  const shown = secret && !revealed ? maskUrl(code) : code;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-fg">{label}</p>
        <div className="flex items-center gap-1">
          {secret && (
            <button
              type="button"
              className="btn-ghost btn-icon"
              onClick={() => setRevealed((value) => !value)}
              title={revealed ? 'Hide the password' : 'Reveal the password'}
              aria-label={revealed ? 'Hide the password' : 'Reveal the password'}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={() => void copy(code, label)}
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <CopyIcon />
          </button>
        </div>
      </div>
      <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2.5 font-mono text-xs leading-relaxed text-fg">
        {shown}
      </pre>
    </div>
  );
}

/**
 * Prefer the public URL, fall back to the internal one, and compose a
 * placeholder string for databases this app did not create — those have no
 * recoverable password, but everything else about the connection is known and
 * the snippets are still worth having.
 */
function connectionUrl(database: DatabaseDetail, publicHost?: string) {
  if (database.publicUrl) return database.publicUrl;
  if (database.internalUrl) return database.internalUrl;

  const user = database.postgresUser ?? 'postgres';
  const name = database.postgresDb;
  const sslMode = database.sslEnabled ? 'require' : 'disable';
  if (name && database.publicPort && publicHost) {
    return `postgres://${user}:${PLACEHOLDER_PASSWORD}@${publicHost}:${database.publicPort}/${name}?sslmode=${sslMode}`;
  }
  if (name) {
    return `postgres://${user}:${PLACEHOLDER_PASSWORD}@${database.uuid}:5432/${name}`;
  }
  return null;
}

function drizzleConfig() {
  return `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
});`;
}

/**
 * postgres.js reads `sslmode` from the URL, but spelling the option out means
 * the file still says what it does when the URL moves into a secret store.
 */
function postgresJsSnippet(sslEnabled: boolean) {
  return `import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

${sslComment(sslEnabled)}
const client = postgres(process.env.DATABASE_URL!, { ssl: ${sslEnabled ? "'require'" : 'false'} });

export const db = drizzle(client, { schema });`;
}

function nodePostgresSnippet(sslEnabled: boolean) {
  return `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

${sslComment(sslEnabled)}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ${sslEnabled ? '{ rejectUnauthorized: false }' : 'false'},
});

export const db = drizzle(pool, { schema });`;
}

function sslComment(sslEnabled: boolean) {
  return sslEnabled
    ? `// The certificate is self-signed, so verification is off — the connection is
// still encrypted. Point the driver at a CA if you later issue a real cert.`
    : `// This database has SSL disabled, so the connection is NOT encrypted.
// Enable SSL on it in Coolify, then change this to require the connection.`;
}
