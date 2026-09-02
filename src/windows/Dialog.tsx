import type { ReactNode } from "react";

/** 런처의 이름 변경 / 제거 확인 다이얼로그 껍데기. */
export function Dialog({
  title,
  titleClass,
  onClose,
  children,
}: {
  title: string;
  titleClass?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    // `data-app-dialog` — 프로젝트 관리 시트(z-80)의 Esc 핸들러가 "내 위에 이
    // 다이얼로그가 떠 있다"를 판별하는 신호. 없으면 이름 변경 중 누른 Esc 가
    // 다이얼로그와 관리 화면을 **동시에** 닫는다. z 는 그 시트보다 위여야 한다.
    <div
      data-app-dialog
      className="scrim z-[110] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border/80 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <h3 className={`text-lg font-bold ${titleClass ?? "text-foreground"}`}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
