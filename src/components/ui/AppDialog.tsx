import { useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { X } from "@/components/Icons";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useT } from "@/i18n";

/**
 * AppDialog — 공유 모달 셸 (v2 U13, docs/20260706_v2/01-ux-spec.md §5).
 *
 * 포커스 트랩/복원·Esc·스크롤락은 `useModalBehavior` 훅이 담당한다 — 자기
 * 마크업(CSS)을 가진 기존 모달(set-modal, disc-modal, …)은 훅만 채택하고,
 * 새 모달은 이 셸을 쓴다. 백드롭 클릭 닫기 포함.
 *
 * 안쪽은 `DialogHead` · `DialogBody` · `DialogFoot` 한 벌이다 (11-15). 확인 · 딥링크 · 처음 쓰는 법 ·
 * 단축키 표가 머리 · 발 · 단추를 저마다 들고 있었다. 판은 위쪽(18vh)에 서고, 넘치는 것은 본문만
 * 스크롤한다 — 모양은 primitives.css 의 `.dlg-*` 가 갖는다.
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
  /** 패널 층의 키 — 포커스가 버튼이 아니라 패널 자체에 앉았을 때도 듣는다 (useConfirm 의 Enter). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function AppDialog({
  open,
  onClose,
  label,
  width = 560,
  initialFocusRef,
  onKeyDown,
  children,
}: AppDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior({ open, onClose, panelRef, initialFocusRef });

  if (!open) return null;

  return (
    <div
      className="scrim dlg-scrim animate-in fade-in duration-(--dur-2)"
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
        onKeyDown={onKeyDown}
        className="dlg-panel animate-in fade-in zoom-in-95 slide-in-from-bottom-1 duration-(--dur-2)"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 머리 — 14/600 제목 한 줄(+ 보조 줄). 오른쪽에는 `aside`(쪽수처럼 기계가 세는 것) 또는 `onClose` 의 ×.
 * 발에 「취소」 가 있는 대화상자는 ×를 두지 않는다 — 닫는 길이 둘이면 어느 쪽이 기본인지 흐려진다.
 */
export function DialogHead({
  title,
  sub,
  mark,
  aside,
  onClose,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** 제목 앞의 표식(아이콘) — 장식이라 읽지 않는다. */
  mark?: ReactNode;
  aside?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <div className={"dlg-head" + (className ? ` ${className}` : "")}>
      {mark ? (
        <span className="dlg-mark" aria-hidden="true">
          {mark}
        </span>
      ) : null}
      <div className="dlg-titles">
        <h2 className="dlg-title">{title}</h2>
        {sub ? <div className="dlg-sub">{sub}</div> : null}
      </div>
      {aside ? <span className="dlg-aside">{aside}</span> : null}
      {onClose ? (
        <button
          type="button"
          className="iconbtn sm dlg-x"
          onClick={onClose}
          aria-label={t("common.close")}
          title={`${t("common.close")} (Esc)`}
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * 본문 — 판 안의 유일한 스크롤 칸. 넘치면 머리 · 발은 그대로 두고 여기만 흐른다.
 *
 * 읽기만 하는 대화상자(단축키 표)는 `focusable` 로 본문을 Tab 자리로 두고 `ref` 로 첫 포커스를 여기 준다. 안에
 * 포커스할 것이 없는 스크롤 칸은 키보드로 닿아야 내린다 — tabIndex -1 이던 때는 × 로 한 번 나가면 다시 못
 * 들어왔다. 열자마자 첫 포커스로 앉은 동안(`data-quiet`)은 테를 그리지 않는다: 표 전체를 두르는 테는 × 에 먼저
 * 서던 테와 같은 소음이다. 한 번 떠났다가 Tab 으로 돌아오면 다른 Tab 자리와 같은 테다(primitives.css).
 */
export function DialogBody({
  children,
  className,
  ref,
  focusable = false,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  focusable?: boolean;
}) {
  // 판이 열릴 때마다 새로 마운트된다(AppDialog 는 닫히면 아무것도 그리지 않는다) — 조용함도 열 때마다 처음부터.
  const [quiet, setQuiet] = useState(true);
  return (
    <div
      ref={ref}
      tabIndex={focusable ? 0 : undefined}
      data-quiet={focusable && quiet ? "" : undefined}
      onBlur={(e) => {
        if (e.target === e.currentTarget) setQuiet(false);
      }}
      className={"dlg-body" + (className ? ` ${className}` : "")}
    >
      {children}
    </div>
  );
}

/** 발 — 오른쪽 정렬, 채운 단추는 하나(영수증 규칙 3). 왼쪽으로 밀 단추 뒤에는 `<span className="dlg-spacer" />`. */
export function DialogFoot({ children }: { children: ReactNode }) {
  return <div className="dlg-foot">{children}</div>;
}

/**
 * 단추 안의 키 표기 — 그 키가 **정말로** 그 단추를 누를 때만 붙인다(Esc · ↩ · ⌘↩). 단축키 표 · × 툴팁과 같은
 * 「Esc」 로 적는다(영수증 규칙 4). 단추의 접근명에는 섞지 않는다 — 「취소 Esc」 로 읽히면 이름이 아니다.
 */
export function DialogKey({ children }: { children: ReactNode }) {
  return (
    <kbd className="kbd dlg-key" aria-hidden="true">
      {children}
    </kbd>
  );
}
