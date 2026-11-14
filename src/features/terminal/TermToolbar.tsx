/**
 * 터미널 화면의 윗줄 동작 — 테두리 단추는 「새 세션 ⌘T ▾」 하나 (영수증 규칙 3 · 화면 검사 VS-17).
 *
 * 예전엔 같은 무게의 테두리 단추 셋 · 이름 없는 아이콘 둘 · 「여럿에서」가 「찾기 ⌘K」(실은 팔레트) 옆에 줄을 서고,
 * 정작 출력 찾기 ⌘F 는 화면에 없었다. 나누기 · 나누기 풀기 · 나란히 돌리기는 ▾ 메뉴로, 그 옆에 글자 단추
 * 「출력에서 찾기 ⌘F」(테두리 없음), 칸이 둘 이상이면 크게 보기 아이콘. 출력 찾기를 돋보기 아이콘으로 두면 바로 옆
 * 팔레트 단추(「🔍 찾기 ⌘K」)와 모양이 같은데 뜻이 달랐고(영수증 규칙 4), 좁은 윗줄의 ⋯ 안에서는 이름 없는 돋보기만
 * 남았다. 못 누르는 항목은 누른 뒤 알림이 아니라 미리 이유를 단다(`blocked`).
 *
 * 메뉴는 `document.body` 로 띄운다 — 윗줄의 동작 칸은 가로 스크롤 칸이라(`overflow-x: auto`) 안에 두면 잘린다.
 */
import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { ChevronDown, Maximize2, Minimize2, Plus } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { kbd } from "@/lib/kbd";
import { useMenuKeys } from "./menuKeys";
import type { PaneDir } from "./paneLayout";

export interface TermToolbarProps {
  hasSessions: boolean;
  /** 칸 수 — 둘 이상이면 크게 보기 · 나누기 풀기. */
  count: number;
  zoomed: boolean;
  /** 고른 칸을 그 방향으로 나눌 자리가 있는가 — 없으면 메뉴 항목에 미리 이유를 단다. */
  roomFor: (dir: PaneDir) => boolean;
  onNew: () => void;
  onSplit: (dir: PaneDir) => void;
  onUnsplit: () => void;
  onRace: () => void;
  onFind: () => void;
  onZoom: () => void;
}

export function TermToolbar(props: TermToolbarProps) {
  const { t } = useT();
  const { hasSessions, count, zoomed, onNew, onFind, onZoom } = props;
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const toggle = () => {
    if (menu) return setMenu(null);
    const r = moreRef.current?.getBoundingClientRect();
    setMenu({ top: (r?.bottom ?? 0) + 4, right: Math.max(8, window.innerWidth - (r?.right ?? 0)) });
  };
  const zoomLabel = t(zoomed ? "terminal.unzoom" : "terminal.zoom");
  return (
    <Toolbar title={t("nav.terminal")}>
      <div className="tm-new" role="group" aria-label={t("terminal.new")}>
        <button type="button" className="tm-new-main" onClick={onNew}>
          <Plus size={13} aria-hidden="true" />
          {t("terminal.new")}
          <kbd className="kbd">{kbd("⌘T", "terminal")}</kbd>
        </button>
        <button
          ref={moreRef}
          type="button"
          className="tm-new-more"
          aria-haspopup="menu"
          aria-expanded={menu != null}
          aria-label={t("terminal.newMenu")}
          title={t("terminal.newMenu")}
          onClick={toggle}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="btn ghost sm"
        aria-keyshortcuts="Meta+F Control+Shift+F"
        {...blocked(hasSessions ? null : t("terminal.needSession"))}
        onClick={onFind}
      >
        {t("terminal.find.placeholder")}
        <kbd className="kbd" aria-hidden="true">
          {kbd("⌘F", "terminal")}
        </kbd>
      </button>
      {count > 1 ? (
        <button
          type="button"
          className="iconbtn sm"
          aria-pressed={zoomed}
          aria-label={zoomLabel}
          title={`${zoomLabel} (${kbd("⇧⌘↩", "terminal")})`}
          onClick={onZoom}
        >
          {zoomed ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
        </button>
      ) : null}
      {menu ? createPortal(<NewMenu {...props} at={menu} opener={moreRef} onDone={() => setMenu(null)} />, document.body) : null}
    </Toolbar>
  );
}

function NewMenu({
  hasSessions,
  count,
  roomFor,
  onSplit,
  onUnsplit,
  onRace,
  at,
  opener,
  onDone,
}: TermToolbarProps & {
  at: { top: number; right: number };
  opener: RefObject<HTMLButtonElement | null>;
  onDone: () => void;
}) {
  const { t } = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const close = (refocus: boolean) => {
    onDone();
    if (refocus) opener.current?.focus();
  };
  useMenuKeys(true, boxRef, close, opener);
  const splitBlock = (dir: PaneDir) =>
    !hasSessions ? t("terminal.needSession") : roomFor(dir) ? null : t("terminal.splitNoRoom");
  // `keys` 는 이미 이 OS 의 표기다(부르는 쪽이 `kbd()` 를 지난다). `title` 은 막히지 않았을 때의 설명.
  // 고르면 포커스를 ▾ 로 돌려준 뒤 실행한다 — 메뉴가 사라지며 포커스가 body 로 떨어졌다(나누기 풀기). 새 칸 ·
  // 대화상자가 서면 그쪽이 포커스를 가져간다.
  const item = (label: string, keys: string | null, reason: string | null, run: () => void, title?: string) => (
    <button
      type="button"
      role="menuitem"
      className="tm-menu-item"
      {...blocked(reason, title)}
      onClick={() => {
        close(true);
        run();
      }}
    >
      <span className="tm-menu-label">{label}</span>
      {keys ? <kbd className="kbd">{keys}</kbd> : null}
    </button>
  );
  return (
    <div
      ref={boxRef}
      className="tm-menu"
      role="menu"
      aria-label={t("terminal.newMenu")}
      style={{ top: at.top, right: at.right }}
    >
      {item(t("terminal.splitRight"), kbd("⌘D", "terminal"), splitBlock("row"), () => onSplit("row"))}
      {item(t("terminal.splitDown"), kbd("⇧⌘D", "terminal"), splitBlock("col"), () => onSplit("col"))}
      {item(
        t("terminal.unsplit"),
        null,
        count > 1 ? null : t("terminal.unsplitNone"),
        onUnsplit,
        t("terminal.unsplitTitle"),
      )}
      {item(t("race.button"), null, null, onRace, t("race.buttonTitle"))}
    </div>
  );
}
