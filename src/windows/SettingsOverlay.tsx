import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OculSpinner } from "@/components/OculSpinner";
import { useT } from "@/i18n";

// 설정 패널은 탭 12개짜리 큰 청크다 — ⌘, 를 누르기 전엔 필요 없다. 정적 import
// 는 이 오버레이를 드는 모든 창(런처·프로젝트)의 진입 청크에 패널을 얹고
// 있었다 (완성도 감사 2026-08-30 #lazy-restore). ShellV2 와 같은 lazy 로.
const SettingsPanel = lazy(() =>
  import("@/features/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);

/**
 * ⌘, 설정 오버레이. 런처 창과 프로젝트 창 양쪽에서 각각 마운트한다 —
 * 설정은 SQLite(`settings_*`)에 있어 창 격리와 무관하게 전 창이 같은 값을
 * 본다 (D4).
 */
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  // Esc to close — feels native for an overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-home-overlay
      className="scrim z-[90] flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={t("settings.closeEsc")}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        {/* `embedded` 는 **호스트가 좌우 여백을 준다**는 전제로 만들어졌다
            (ShellV2 는 `.page` 로 감싼다 — ShellV2.tsx). 이 모달은 그동안
            패딩 없는 div 로 감싸고 있어서 탭·입력·카드가 전부 카드 가장자리에
            붙어 있었다. 헤더의 px-6 과 같은 좌우 여백을 준다. */}
        {/* 설정 탭 하나가 던져도 창 전체가 죽지 않게 — 시작 탭에서 ocul-pm
            탭이 예외를 올려 창이 통째로 빈 화면이 된 적이 있다 (2026-08-16).
            원인은 고쳤지만, 이 패널은 탭이 12개라 같은 실패의 표면이 넓다. */}
        <div className="overflow-y-auto scrollbar-thin px-6 pt-5">
          <ErrorBoundary label="settings">
            <Suspense fallback={<OculSpinner size={22} label={t("common.loading")} />}>
              <SettingsPanel embedded />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
