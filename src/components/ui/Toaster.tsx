/**
 * Toaster — render `useSyncExternalStore`-driven toasts in a fixed corner.
 *
 * Mounted once at the App root so any module that calls `toast.info(...)`
 * surfaces a notification without further wiring. See `src/lib/toast.ts`.
 */

import { useSyncExternalStore } from "react";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type Toast,
} from "@/lib/toast";
import { AlertTriangle, Check, X } from "@/components/Icons";

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-full max-w-sm flex-col-reverse gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const tone =
    toast.kind === "info"
      ? "border-zinc-700 bg-zinc-900 text-zinc-100"
      : toast.kind === "warning"
        ? "border-amber-700 bg-amber-950/80 text-amber-100"
        : "border-red-700 bg-red-950/80 text-red-100";
  const Icon = toast.kind === "info" ? Check : AlertTriangle;
  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg ${tone}`}
      role={toast.kind === "info" ? "status" : "alert"}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 space-y-1">
        {toast.title && <div className="font-semibold">{toast.title}</div>}
        <div className="whitespace-pre-wrap leading-snug">{toast.message}</div>
        {toast.actions && toast.actions.length > 0 && (
          <div className="flex gap-2 pt-1">
            {toast.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onClick();
                  dismissToast(toast.id);
                }}
                className="rounded border border-current/40 px-2 py-0.5 text-[11px] hover:bg-current/10"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="닫기"
        className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
