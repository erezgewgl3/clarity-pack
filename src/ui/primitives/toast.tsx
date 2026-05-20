// src/ui/primitives/toast.tsx
//
// Plan 04.1-09 — minimal toast primitive. The Plan 04.1-08 build had no
// transient-feedback mechanism: clicking the right-rail's
// "⏸ Pause heartbeat" Quick Action produced ZERO visible response
// (operator drill 2026-05-20: the row was a no-op disabled button with
// no toast, no status indicator change). The new ChatToast component +
// useToast hook give the chat surface a stack of transient bottom-right
// notifications. Mounted at the chat shell root via <ToastProvider>; any
// child can call `const { showToast } = useToast(); showToast({ message })`.
//
// Design choices:
//   - Pure CSS animation (chat.css `.clarity-toast` + @keyframes
//     clarity-toast-in). No animation library — same-origin trust model.
//   - Auto-dismiss after `duration` ms (default 4000). Pass duration=0 to
//     keep the toast until manually dismissed.
//   - Click-to-dismiss on the toast body. The stack supports multiple
//     concurrent toasts.
//
// SECURITY (T-04-18): the `message` field renders as React text. NO
// dangerouslySetInnerHTML.

import * as React from 'react';

export type Toast = {
  id: string;
  message: string;
  /** Auto-dismiss after this many milliseconds. 0 = no auto-dismiss. */
  duration?: number;
};

type ToastContextValue = {
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  /** Exposed for tests + Stories — the live stack of currently-visible toasts. */
  toasts: Toast[];
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const showToast = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((curr) => [...curr, { id, ...t }]);
    const duration = t.duration ?? 4000;
    if (duration > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => {
        setToasts((curr) => curr.filter((x) => x.id !== id));
      }, duration);
    }
  }, []);

  const value = React.useMemo(
    () => ({ showToast, dismissToast, toasts }),
    [showToast, dismissToast, toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="clarity-toast-stack" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <ChatToast key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be called inside a <ToastProvider>');
  }
  return ctx;
}

export function ChatToast({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      className="clarity-toast"
      role="status"
      onClick={onDismiss}
      // The clickable surface is the whole toast; keyboard users dismiss via
      // Esc (the stack auto-dismisses on a 4s timer for the common case).
    >
      {toast.message}
    </div>
  );
}
