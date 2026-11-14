/**
 * Toaster — 알림 기둥 하나 (11-15). `useSyncExternalStore` 로 토스트를 그리고, 맨 아래에는 업데이트 배너의
 * 고정 줄이 선다.
 *
 * Mounted once at the App root so any module that calls `toast.info(...)`
 * surfaces a notification without further wiring. See `src/lib/toast.ts`.
 *
 * 예전엔 토스트(bottom 16 · right 16)와 업데이트 배너(bottom · right 18)가 같은 모서리에 따로 떠 서로를
 * 가렸다. 배너는 창마다 하나 떠 있는 `UpdateBanner` 가 내용과 동작을 갖고, **자리는 여기**다 — 배너가
 * `toasterPinnedSlot` 으로 이 기둥의 고정 줄에 그린다. 모양은 primitives.css 「알림 기둥」.
 */

import { useSyncExternalStore } from "react";
import { createStore } from "@/lib/createStore";
import {
  dismissToast,
  getToasts,
  pauseToast,
  resumeToast,
  subscribeToasts,
  type Toast,
} from "@/lib/toast";
import { AlertTriangle, X } from "@/components/Icons";
import { useT } from "@/i18n";

/** 업데이트 배너가 그릴 자리 — 기둥이 붙으면 그 요소, 없으면(시험 · 기둥 없는 표면) `null`. */
export const toasterPinnedSlot = createStore<HTMLElement | null>(null);
/** 모듈 하나의 ref 콜백 — 렌더마다 새 함수면 React 가 null → 요소를 매번 다시 불러 배너가 깜빡인다. */
const pinSlot = (el: HTMLDivElement | null) => toasterPinnedSlot.set(el);

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
    <div className="toaster" data-toaster="">
      <div role="alert" aria-live="assertive" className="toaster-region">
        {alerts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="toaster-region">
        {infos.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
      {/* 업데이트 배너의 고정 줄 — 기둥의 맨 아래(모서리에 가장 가까운 자리). */}
      <div className="toaster-pinned" ref={pinSlot} />
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useT();
  // 색은 예외에만 (영수증 규칙 1) — 경고 · 실패만 표식과 테가 물든다. 알림(info)은 표식이 없다: 늘
  // 초록 ✓ 이던 때는 하지 못한 일을 알리는 토스트도 해낸 것처럼 읽혔다.
  const exception = toast.kind !== "info";
  return (
    <div
      className={`toast ${toast.kind} animate-in fade-in slide-in-from-bottom-2 pointer-events-auto duration-(--dur-2)`}
      // 읽는 동안·누르려는 동안 시계를 멈춘다. 액션이 달린 토스트에서는
      // 이게 없으면 [되돌리기] 를 누르러 가는 도중에 사라진다.
      onMouseEnter={() => pauseToast(toast.id)}
      onMouseLeave={() => resumeToast(toast.id)}
      onFocusCapture={() => pauseToast(toast.id)}
      onBlurCapture={() => resumeToast(toast.id)}
    >
      {exception ? (
        <span className="toast-ico" aria-hidden="true">
          <AlertTriangle size={15} />
        </span>
      ) : null}
      <div className="toast-main">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        <div className="toast-msg">
          {toast.message}
          {toast.count > 1 ? (
            <span className="toast-count" aria-label={t("toast.repeat", { n: toast.count })}>
              {toast.count}
            </span>
          ) : null}
        </div>
        {toast.actions && toast.actions.length > 0 && (
          <div className="toast-actions">
            {toast.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="btn sm"
                onClick={() => {
                  a.onClick();
                  dismissToast(toast.id);
                }}
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
        className="iconbtn sm"
      >
        <X size={13} />
      </button>
    </div>
  );
}
