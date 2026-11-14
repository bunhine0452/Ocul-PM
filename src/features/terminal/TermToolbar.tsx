/**
 * 터미널 화면의 윗줄 동작 — 테두리 단추는 「새 세션 ⌘T ▾」 하나 (영수증 규칙 3 · 화면 검사 VS-17).
 *
 * 예전엔 같은 무게의 테두리 단추 셋 · 이름 없는 아이콘 둘 · 「여럿에서」가 「찾기 ⌘K」(실은 팔레트) 옆에 줄을 서고,
 * 정작 출력 찾기 ⌘F 는 화면에 없었다. 나누기 · 나누기 풀기 · 나란히 돌리기는 ▾ 메뉴로, 그 옆에 출력 찾기 아이콘,
 * 칸이 둘 이상이면 크게 보기 아이콘. 못 누르는 항목은 누른 뒤 알림이 아니라 미리 이유를 단다(`blocked`).
 *
 * 메뉴는 `document.body` 로 띄운다 — 윗줄의 동작 칸은 가로 스크롤 칸이라(`overflow-x: auto`) 안에 두면 잘린다.
 */
import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";

import { ChevronDown, Plus, SearchIcon } from "@/components/Icons";
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
        className="iconbtn sm"
        aria-label={t("terminal.find.placeholder")}
        {...blocked(
          hasSessions ? null : t("terminal.needSession"),
          `${t("terminal.find.placeholder")} (${kbd("⌘F", "terminal")})`,
        )}
        onClick={onFind}
      >
        <SearchIcon size={13} aria-hidden="true" />
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
  useMenuKeys(
    true,
    boxRef,
    (refocus) => {
      onDone();
      if (refocus) opener.current?.focus();
    },
    opener,
  );
  const splitBlock = (dir: PaneDir) =>
    !hasSessions ? t("terminal.needSession") : roomFor(dir) ? null : t("terminal.splitNoRoom");
  // `keys` 는 이미 이 OS 의 표기다(부르는 쪽이 `kbd()` 를 지난다).
  const item = (label: string, keys: string | null, reason: string | null, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="tm-menu-item"
      {...blocked(reason)}
      onClick={() => {
        onDone();
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
      {item(t("terminal.unsplit"), null, count > 1 ? null : t("terminal.unsplitNone"), onUnsplit)}
      {item(t("race.button"), null, null, onRace)}
    </div>
  );
}
