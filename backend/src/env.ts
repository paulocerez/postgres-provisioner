import { z } from 'zod';

/**
 * The only place in the backend that reads `process.env`. Everything else
 * imports the frozen `env` object below, so a missing variable is a startup
 * failure with a readable message rather than an `undefined` at 3am.
 */

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

    ADMIN_EMAIL: z.string().email('must be a valid email address'),
    ADMIN_PASSWORD_HASH: z
      .string()
      .min(1, 'bcrypt hash — generate one with `npm run hash-password -- <password>`'),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

    APP_ORIGIN: z.string().url('full origin of the deployed app, used for the CSRF check'),
    DATA_DIR: z.string().default('/data'),
  })
  .refine((v) => v.PORT_RANGE_START <= v.PORT_RANGE_END, {
    message: 'PORT_RANGE_START must be less than or equal to PORT_RANGE_END',
    path: ['PORT_RANGE_START'],
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
