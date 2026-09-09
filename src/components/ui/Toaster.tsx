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
  pauseToast,
  resumeToast,
  subscribeToasts,
  type Toast,
} from "@/lib/toast";
import { AlertTriangle, Check, X } from "@/components/Icons";
import { useT } from "@/i18n";

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  // 라이브 리전 둘 다 **항상** 마운트한다 (2026-09-09).
  //
  // 전에는 `toasts.length === 0` 이면 null 을 돌려주고 role 은 개별 토스트에
  // 붙어 있었다. 그러면 리전이 내용과 **동시에** DOM 에 삽입되는데, 그건
  // 스크린리더가 자주 놓치는 고전적 패턴이다 — 특히 `role="status"`(polite).
  // 빈 리전을 먼저 심어 두고 그 안에 자식을 더해야 읽는다.
  //
  // 둘로 가른 이유는 다급함이 다르기 때문이다: 경고·오류는 assertive 로
  // 끼어들고 info 는 polite 로 기다린다. 시각적으로도 경고가 위에 선다.
  const alerts = toasts.filter((t) => t.kind !== "info");
  const infos = toasts.filter((t) => t.kind === "info");
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-top flex w-full max-w-sm flex-col">
      <div role="alert" aria-live="assertive" className="mb-2 flex flex-col-reverse gap-2">
        {alerts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col-reverse gap-2">
        {infos.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useT();
  // v2 U2 — 다크 하드코딩(zinc 계열 등) 제거: 카드 표면 토큰 + 종류별 틴트
  // 보더/아이콘으로 라이트·다크·프리셋 전 테마에서 주변 UI 와 일관되게.
  const tone =
    toast.kind === "info"
      ? "border-border bg-card text-foreground"
      : toast.kind === "warning"
        ? "border-(--warn)/40 bg-card text-foreground"
        : "border-(--danger)/40 bg-card text-foreground";
  const iconTone =
    toast.kind === "info"
      ? "text-(--ok-text)"
      : toast.kind === "warning"
        ? "text-(--warn-text)"
        : "text-(--danger-text)";
  const Icon = toast.kind === "info" ? Check : AlertTriangle;
  return (
    <div
      className={`animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg duration-(--dur-2) ${tone}`}
      // 읽는 동안·누르려는 동안 시계를 멈춘다. 액션이 달린 토스트에서는
      // 이게 없으면 [되돌리기] 를 누르러 가는 도중에 사라진다.
      onMouseEnter={() => pauseToast(toast.id)}
      onMouseLeave={() => resumeToast(toast.id)}
      onFocusCapture={() => pauseToast(toast.id)}
      onBlurCapture={() => resumeToast(toast.id)}
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
                className="rounded border border-current/40 px-2 py-0.5 text-fs-2 hover:bg-current/10"
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
