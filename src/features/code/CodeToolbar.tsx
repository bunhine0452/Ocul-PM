// 코드 화면의 툴바 액션 — 파일 트리 접기 · 외부에서 열기 · 디버그 · 실행 ·
// 포맷 · 저장 · 새로고침.
//
// 2026-09-11 IDE 라운드에서 `CodeScreenV2` 에서 떼어냈다. 버튼 일곱 개는 상태를
// 하나도 갖지 않는 그리기라, 화면이 판단(무엇이 눌릴 수 있는가)만 넘기면 된다.
import { memo } from "react";

import {
  AlignLeft,
  Bug,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Save,
} from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { t, useT } from "@/i18n";
import { blocked } from "@/lib/blocked";

interface CodeToolbarProps {
  /** 보고 있는 파일 (부제). null 이면 파일 단위 액션이 숨는다. */
  selected: string | null;
  focusedDirty: boolean;
  /** 프로젝트 루트가 없으면 외부에서 열 수 없다. */
  canOpenExternal: boolean;
  sidebarHidden: boolean;
  debugOpen: boolean;
  onToggleSidebar: () => void;
  onOpenExternal: () => void;
  onToggleDebug: () => void;
  onRun: () => void;
  onFormat: () => void;
  onSave: () => void;
  onRefresh: () => void;
}

export const CodeToolbar = memo(function CodeToolbar({
  selected,
  focusedDirty,
  canOpenExternal,
  sidebarHidden,
  debugOpen,
  onToggleSidebar,
  onOpenExternal,
  onToggleDebug,
  onRun,
  onFormat,
  onSave,
  onRefresh,
}: CodeToolbarProps) {
  useT();
  return (
    <Toolbar title={t("nav.code")} sub={selected ? selected + (focusedDirty ? " ●" : "") : undefined}>
      <button
        type="button"
        className={"code-tool-btn" + (sidebarHidden ? "" : " on")}
        onClick={onToggleSidebar}
        aria-pressed={!sidebarHidden}
        title={t(sidebarHidden ? "code.sidebar.show" : "code.sidebar.hide")}
        aria-label={t(sidebarHidden ? "code.sidebar.show" : "code.sidebar.hide")}
      >
        {sidebarHidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      {selected && canOpenExternal ? (
        <button
          type="button"
          className="code-tool-btn"
          onClick={onOpenExternal}
          title={t("code.openExternal")}
          aria-label={t("code.openExternal")}
        >
          <ExternalLink size={15} />
        </button>
      ) : null}
      <button
        type="button"
        className={"code-tool-btn" + (debugOpen ? " on" : "")}
        onClick={onToggleDebug}
        title={t("code.debug.open")}
        aria-label={t("code.debug.open")}
      >
        <Bug size={15} />
      </button>
      <button
        type="button"
        className="code-tool-btn"
        onClick={onRun}
        title={t("code.debug.run")}
        aria-label={t("code.debug.run")}
      >
        <Play size={15} />
      </button>
      {selected ? (
        <button
          type="button"
          className="code-tool-btn"
          onClick={onFormat}
          title={t("code.format") + " (⇧⌥F)"}
          aria-label={t("code.format")}
        >
          <AlignLeft size={15} />
        </button>
      ) : null}
      {selected ? (
        <button
          type="button"
          className={"code-tool-btn code-save-btn" + (focusedDirty ? " on" : "")}
          onClick={onSave}
          aria-label={t("code.save")}
          {...blocked(focusedDirty ? null : t("code.blockedNoChanges"), t("code.save") + " (⌘S)")}
        >
          <Save size={15} />
        </button>
      ) : null}
      <button
        type="button"
        className="code-tool-btn"
        onClick={onRefresh}
        title={t("code.refresh")}
        aria-label={t("code.refresh")}
      >
        <RefreshCw size={15} />
      </button>
    </Toolbar>
  );
});
