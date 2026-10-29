import React, { useContext } from "react";
import { createPortal } from "react-dom";
import { dragRegion } from "@/lib/platform";
import { useT } from "@/i18n";
import { SearchIcon } from "@/components/Icons";
import { kbd } from "@/lib/kbd";
import { requestOpenPalette } from "@/lib/paletteNav";
import { ToolbarSlotContext } from "./toolbarSlot";

// 화면 머리 (`--toolbar-h` 44px). 셸 안에서는 **셸 윗줄에 합쳐진다** (4.0 — 사이드바 안에
// 사이드바가 서는 두 겹을 걷었다): 제목은 윗줄의 탭이 대신하고, `leading`·동작만
// 윗줄의 「화면 동작」 자리(`ToolbarSlotContext`)로 포털된다. 찾기 ⌘K 는 윗줄이 늘 갖고
// 있다. 셸 밖(테스트·단독 렌더)에서는 예전처럼 제자리에 한 줄로 선다.

interface ToolbarProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Optional element rendered before the title (e.g. a back button). */
  leading?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * 보류 등급 화면(docs/PROMISE.md) — 제목 옆에 「베타 · 결함 수정만」 알약. 랜딩·README 가
   * 말하는 것과 앱이 말하는 것이 같아야 한다 (UI 밀도 라운드 3).
   */
  beta?: boolean;
  /** 오른쪽 끝에 「찾기 ⌘K」 — 팔레트를 연다 (셸 밖 렌더에서만; 셸 윗줄은 늘 갖고 있다). */
  find?: boolean;
}

export function Toolbar({ title, sub, leading, children, beta = false, find = false }: ToolbarProps) {
  const { t } = useT();
  const slot = useContext(ToolbarSlotContext);
  if (slot) {
    return createPortal(
      <>
        {leading}
        {children}
      </>,
      slot,
    );
  }
  // Window drag (Dogfooding 2026-06-15): the whole top bar should move the
  // window, not just the window edges. Tauri starts a drag only when the
  // clicked element ITSELF carries data-tauri-drag-region (it inspects
  // e.target, not ancestors), so the attribute goes on the container AND each
  // non-interactive child (title/sub/spacer). `leading` and action `children`
  // are buttons — they intentionally omit it so they stay clickable.
  // macOS 에서만 — Windows·Linux 는 네이티브 제목줄이 있다 (`dragRegion`).
  const drag = dragRegion();
  return (
    <div className="toolbar" {...drag}>
      {leading}
      <div className="toolbar-title" {...drag}>{title}</div>
      {beta ? <span className="toolbar-beta" {...drag}>{t("toolbar.beta")}</span> : null}
      {sub ? <span className="toolbar-sub" {...drag}>{sub}</span> : null}
      <div className="toolbar-spacer" {...drag} />
      {/* 좁은 창 방어 (2026-07-20): 액션 묶음은 압착 대신 가로 스크롤로
          도망간다 — 없으면 flex 압착이 CJK 라벨을 한 글자씩 세로로 꺾는다. */}
      <div className="toolbar-actions">
        {children}
        {find ? <FindButton /> : null}
      </div>
    </div>
  );
}

/** 「찾기 ⌘K」 — 팔레트를 연다. 셸 윗줄과 셸 밖 툴바가 같은 단추를 쓴다. */
export function FindButton() {
  const { t } = useT();
  return (
    <button type="button" className="btn sm" onClick={requestOpenPalette}>
      <SearchIcon size={13} aria-hidden="true" />
      {t("toolbar.find")}
      <kbd className="kbd">{kbd("⌘K")}</kbd>
    </button>
  );
}
