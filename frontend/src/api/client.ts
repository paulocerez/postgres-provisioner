/**
 * The single fetch wrapper. Every call to the backend goes through here so the
 * 401 → /login redirect and the `{ error: { message } }` envelope are handled
 * in exactly one place.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly coolifyStatus: number | undefined;
  readonly step: string | undefined;

  constructor(status: number, message: string, extra?: { step?: string; coolifyStatus?: number }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.step = extra?.step;
    this.coolifyStatus = extra?.coolifyStatus;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status}).`;
  let step: string | undefined;
  let coolifyStatus: number | undefined;
  try {
    const body = (await response.json()) as {
      error?: { message?: string; step?: string; coolifyStatus?: number };
    };
    if (body.error?.message) message = body.error.message;
    step = body.error?.step;
    coolifyStatus = body.error?.coolifyStatus;
  } catch {
    // Non-JSON error (a proxy error page, say) — keep the generic message.
  }
  return new ApiError(response.status, message, { step, coolifyStatus });
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers:
      method === 'GET'
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) throw await parseError(response);

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
