import type {
  AuditEntry,
  CreateDatabaseInput,
  DatabaseDetail,
  DatabaseList,
  Job,
  MetaPatchInput,
  MetaResponse,
  Session,
} from '@app/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

/**
 * Every query and mutation is defined once here as a factory, so route loaders
 * (`ensureQueryData`) and components share the same key and fetcher.
 */

export const queryKeys = {
  session: ['session'] as const,
  meta: ['meta'] as const,
  databases: ['databases'] as const,
  database: (uuid: string) => ['databases', uuid] as const,
  job: (id: string) => ['jobs', id] as const,
  audit: (limit: number) => ['audit', limit] as const,
};

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: () => apiFetch<Session>('/auth/me'),
  retry: false,
  staleTime: 30_000,
});

export const metaQuery = queryOptions({
  queryKey: queryKeys.meta,
  queryFn: () => apiFetch<MetaResponse>('/meta'),
  staleTime: 5 * 60_000,
});

export const databasesQuery = queryOptions({
  queryKey: queryKeys.databases,
  queryFn: () => apiFetch<DatabaseList>('/databases'),
  // The list is a live view of Coolify, so it refreshes on a timer — but not
  // while the tab is in the background.
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  retry: false,
});

export const databaseQuery = (uuid: string) =>
  queryOptions({
    queryKey: queryKeys.database(uuid),
    queryFn: () => apiFetch<DatabaseDetail>(`/databases/${uuid}`),
    retry: false,
  });

export const auditQuery = (limit = 100) =>
  queryOptions({
    queryKey: queryKeys.audit(limit),
    queryFn: () => apiFetch<AuditEntry[]>(`/audit?limit=${limit}`),
  });

export const jobQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.job(id),
    queryFn: () => apiFetch<Job>(`/jobs/${id}`),
    // Stop polling once the job reaches a terminal state.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 2_000;
    },
  });

// --- mutations --------------------------------------------------------------

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<Session>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.session, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useCreateDatabase() {
  return useMutation({
    mutationFn: (input: CreateDatabaseInput) =>
      apiFetch<{ jobId: string }>('/databases', { method: 'POST', body: input }),
  });
}

export function useLifecycleAction(uuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      apiFetch<{ ok: true }>(`/databases/${uuid}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databases });
      void queryClient.invalidateQueries({ queryKey: queryKeys.database(uuid) });
    },
  });
}

export function useDeleteDatabase(uuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { confirmName: string; deleteVolume: boolean }) =>
      apiFetch<{ ok: true }>(`/databases/${uuid}`, { method: 'DELETE', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

export function useUpdateMeta(uuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MetaPatchInput) =>
      apiFetch<{ ok: true }>(`/databases/${uuid}/meta`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.database(uuid) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

/** Clears an orphaned meta row. Never touches Coolify. */
export function useForgetMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) =>
      apiFetch<{ ok: true }>(`/databases/${uuid}/meta`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}
