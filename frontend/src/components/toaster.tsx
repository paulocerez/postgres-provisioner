import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon } from './icons';

type ToastVariant = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

type Notify = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<Notify | null>(null);

const DISMISS_AFTER_MS = 3_000;

/**
 * Confirmation for actions whose result is otherwise invisible — a copied
 * connection string, a saved note. Errors that need to persist still go through
 * <ErrorBanner>; these are transient by design.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (message, variant = 'success') => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, variant }]);
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className="pointer-events-auto flex animate-toast-in items-start gap-2 rounded-lg border border-line bg-surface p-2.5 text-left text-sm text-fg shadow-popover"
          >
            <span className={toast.variant === 'error' ? 'mt-0.5 text-danger' : 'mt-0.5 text-success'}>
              {toast.variant === 'error' ? <AlertIcon /> : <CheckIcon />}
            </span>
            <span className="flex-1">{toast.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a `notify(message, variant?)` function. No-ops outside the provider. */
export function useToast(): Notify {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
