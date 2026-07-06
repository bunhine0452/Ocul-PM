import { useRef, type ReactNode } from "react";
import { useModalBehavior } from "@/hooks/useModalBehavior";

/**
 * AppDialog — 공유 모달 셸 (v2 U13, docs/20260706_v2/01-ux-spec.md §5).
 *
 * 포커스 트랩/복원·Esc·스크롤락은 `useModalBehavior` 훅이 담당한다 — 자기
 * 마크업(CSS)을 가진 기존 모달(set-modal, disc-modal, …)은 훅만 채택하고,
 * 새 모달은 이 셸을 쓴다. 백드롭 클릭 닫기 포함.
 */

interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  /** aria-label 로 쓰일 접근명 (시각 타이틀은 children 이 소유). */
  label: string;
  /** max-width px (기본 560). */
  width?: number;
  /** 열릴 때 포커스할 요소 (기본: 내부 첫 포커서블). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function AppDialog({
  open,
  onClose,
  label,
  width = 560,
  initialFocusRef,
  children,
}: AppDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior({ open, onClose, panelRef, initialFocusRef });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-background/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}
