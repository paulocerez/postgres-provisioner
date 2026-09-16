import { loginSchema } from '@app/shared';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ApiError } from '../api/client';
import { useLogin } from '../api/queries';
import { ErrorBanner } from '../components/error-banner';
import { ThemeToggle } from '../components/theme-toggle';

export const Route = createFileRoute('/login')({
  // `_auth` sends the attempted URL along so a 401 can return you where you were.
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const login = useLogin();

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      await login.mutateAsync(value);
      await navigate({ to: redirect ?? '/' });
    },
  });

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      {/* A single soft accent wash keeps the page from reading as a blank
          sheet without adding chrome the sign-in form does not need. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-accent/[0.07] to-transparent"
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <form
        className="relative w-full max-w-[20rem] space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-col items-center gap-2.5 pb-1 text-center">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg shadow-sm"
          >
            P
          </span>
          <div>
            <h1 className="text-lg font-semibold text-fg">Postgres Provisioner</h1>
            <p className="mt-0.5 text-sm text-muted">Sign in to manage databases.</p>
          </div>
        </div>

        <div className="card">
          <div className="card-body space-y-3.5">
            {/* The server answers wrong-email and wrong-password identically. */}
            <ErrorBanner
              error={login.error && login.error instanceof ApiError ? login.error : null}
              title="Could not sign in"
            />

            <form.Field name="email">
              {(field) => (
                <div>
                  <label className="label" htmlFor={field.name}>
                    Email
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type="email"
                    autoComplete="username"
                    autoFocus
                    className="input"
                    placeholder="you@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="field-error">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div>
                  <label className="label" htmlFor={field.name}>
                    Password
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
                    className="input"
                    placeholder="••••••••"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="field-error">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <button type="submit" className="btn-primary btn-lg w-full" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
