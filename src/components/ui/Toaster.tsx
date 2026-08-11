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
import { useT } from "@/i18n";

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
  const { t } = useT();
  // v2 U2 — 다크 하드코딩(bg-zinc-900 등) 제거: 카드 표면 토큰 + 종류별 틴트
  // 보더/아이콘으로 라이트·다크·프리셋 전 테마에서 주변 UI 와 일관되게.
  const tone =
    toast.kind === "info"
      ? "border-border bg-card text-foreground"
      : toast.kind === "warning"
        ? "border-amber-500/50 bg-card text-foreground"
        : "border-red-500/60 bg-card text-foreground";
  const iconTone =
    toast.kind === "info"
      ? "text-emerald-500"
      : toast.kind === "warning"
        ? "text-amber-500"
        : "text-red-500";
  const Icon = toast.kind === "info" ? Check : AlertTriangle;
  return (
    <div
      className={`animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg duration-200 ${tone}`}
      role={toast.kind === "info" ? "status" : "alert"}
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconTone}`} />
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
        aria-label={t("common.close")}
        className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
