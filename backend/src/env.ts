import { z } from 'zod';

/**
 * The only place in the backend that reads `process.env`. Everything else
 * imports the frozen `env` object below, so a missing variable is a startup
 * failure with a readable message rather than an `undefined` at 3am.
 */

/**
 * An optional variable that a host left blank is unset, not invalid. Coolify's
 * environment editor writes an empty string for a variable you create and never
 * fill in, and failing to boot over one is an unhelpful way to find out.
 */
function blankAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    COOLIFY_URL: z.string().url('must be a full URL, e.g. http://1.2.3.4:8000'),
    COOLIFY_TOKEN: z.string().min(1, 'required: Coolify → Keys & Tokens → API tokens'),
    COOLIFY_SERVER_UUID: z.string().optional(),
    COOLIFY_PROJECT_UUID: z.string().optional(),
    COOLIFY_ENVIRONMENT: z.string().default('production'),
    COOLIFY_S3_STORAGE_UUID: z.string().optional(),

    PUBLIC_HOST: z.string().min(1, 'host used in public connection strings'),
    PORT_RANGE_START: z.coerce.number().int().min(1).max(65535).default(5432),
    PORT_RANGE_END: z.coerce.number().int().min(1).max(65535).default(5441),
    DEFAULT_PG_IMAGE: z.string().default('postgres:18-alpine'),

    /**
     * Both optional, and only useful together: without them the per-database
     * allowlist is hidden and no Hetzner call is ever made. The token needs
     * read *and* write, because applying an allowlist rewrites firewall rules.
     */
    HCLOUD_TOKEN: blankAsUnset(z.string().min(1)),
    HCLOUD_FIREWALL_ID: blankAsUnset(
      z.coerce
        .number()
        .int()
        .positive('the numeric id of the firewall, from its URL in the Hetzner console'),
    ),

    /**
     * The SNI hostname Traefik routes to the Postgres gateway, and the port the
     * gateway listens on. Setting the host turns the gateway on; leaving it
     * blank leaves the listener unstarted and the connection string hidden.
     */
    PG_GATEWAY_HOST: blankAsUnset(z.string().min(1)),
    PGPROXY_PORT: z.coerce.number().int().min(1).max(65535).default(5433),

    ADMIN_EMAIL: z.string().email('must be a valid email address'),
    /**
     * Checked for shape, not just presence. A bcrypt hash is full of `$`, and
     * platforms that interpolate environment variables (Coolify's default, for
     * one) silently expand `$2a`/`$12` into nothing. The result still looks like
     * a populated variable but can never match a password, which surfaces as an
     * unexplained "Invalid email or password" at the login screen. Fail at boot
     * with a message that names the cause instead.
     */
    ADMIN_PASSWORD_HASH: z
      .string()
      .regex(
        /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/,
        'must be a bcrypt hash of the form $2a$12$… (60 characters). Generate one with `npm run hash-password -- <password>`. If it looks truncated, your host interpolated the $ signs — disable variable interpolation for this variable.',
      ),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

    APP_ORIGIN: z.string().url('full origin of the deployed app, used for the CSRF check'),
    DATA_DIR: z.string().default('/data'),
  })
  .refine((v) => v.PORT_RANGE_START <= v.PORT_RANGE_END, {
    message: 'PORT_RANGE_START must be less than or equal to PORT_RANGE_END',
    path: ['PORT_RANGE_START'],
  })
  .refine((v) => Boolean(v.HCLOUD_TOKEN) === Boolean(v.HCLOUD_FIREWALL_ID), {
    message:
      'set both HCLOUD_TOKEN and HCLOUD_FIREWALL_ID, or neither. Half-configured, the allowlist would look available and never apply.',
    path: ['HCLOUD_FIREWALL_ID'],
  });

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return Object.freeze(parsed.data);

  const lines = parsed.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });
  console.error(
    ['Invalid environment configuration:', ...lines, '', 'See .env.example for the full list.'].join(
      '\n',
    ),
  );
  process.exit(1);
}

export const env = load();
export const isProduction = env.NODE_ENV === 'production';

/**
 * Whether this deployment manages the Hetzner firewall. Everything to do with
 * per-database allowlists keys off this: the card is hidden, the detail payload
 * says so, and no outbound call is made when it is false.
 */
export const firewallManaged = Boolean(env.HCLOUD_TOKEN && env.HCLOUD_FIREWALL_ID);

/**
 * Whether databases are reachable through the TLS gateway on 443 as well as (or
 * instead of) a published host port. Off unless `PG_GATEWAY_HOST` is set, so an
 * existing deployment gains nothing it did not ask for.
 */
export const pgGatewayEnabled = Boolean(env.PG_GATEWAY_HOST);

/**
 * Whether the app is actually reachable over TLS, which is a different question
 * from whether it is a production build. Coolify's generated domains are
 * http://, so a production image can legitimately be served without TLS.
 *
 * Anything that breaks when the scheme is wrong — the `Secure` cookie flag,
 * HSTS, upgrade-insecure-requests — keys off this, not off NODE_ENV. Tying the
 * cookie to NODE_ENV means a production image on an http:// host sets `Secure`,
 * the browser silently drops the cookie, and every request after login is
 * anonymous with nothing in the UI to explain it.
 */
export const servedOverHttps = env.APP_ORIGIN.startsWith('https://');
