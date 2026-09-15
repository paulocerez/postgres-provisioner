import { loginSchema } from '@app/shared';
import { useForm } from '@tanstack/react-form';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ApiError } from '../api/client';
import { useLogin } from '../api/queries';
import { ErrorBanner } from '../components/ErrorBanner';

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
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Postgres Provisioner</h1>
          <p className="text-sm text-slate-500">Sign in to manage databases.</p>
        </div>

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

        <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-xs text-slate-400">
          <Link to="/">Back to the app</Link>
        </p>
      </form>
    </main>
  );
}
