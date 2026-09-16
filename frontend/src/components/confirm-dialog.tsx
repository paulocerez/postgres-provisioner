import { type ReactNode, useEffect, useRef } from 'react';
import { Kbd } from './kbd';

/**
 * Every destructive action goes through this. Rendered as a native <dialog> so
 * Escape, focus trapping and the backdrop come for free.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDisabled,
  busy,
  onConfirm,
  onCancel,
  destructive = true,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md animate-slide-up-fade rounded-xl border border-line bg-surface p-0 text-fg shadow-popover backdrop:bg-canvas/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-4">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <div className="mt-2.5 space-y-3 text-sm text-muted">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto hidden items-center gap-1.5 text-2xs text-subtle sm:flex">
            <Kbd>Esc</Kbd> to cancel
          </span>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={confirmDisabled || busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
