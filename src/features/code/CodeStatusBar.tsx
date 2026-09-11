// 편집 창의 상태줄 — 왼쪽은 **이 버퍼의 상태**(저장·커서·선택), 오른쪽은
// **이 파일의 성질**(문제·언어 서버·줄바꿈·언어·크기).
//
// 2026-09-11 IDE 라운드에서 `CodePane` 에서 떼어냈다. 상태줄은 그리기뿐인데
// 창 컴포넌트 안에 있으면 항목 하나를 더할 때마다 1,600줄짜리 파일이 자란다.
// 이 라운드가 더한 것 셋: 커서 조각을 누르면 줄 이동(⌃G), 선택이 있으면 줄·글자
// 수, 줄바꿈 토글(⌥Z 와 같은 값).
import type { ReactNode } from "react";

import { CircleX, TriangleAlert, WrapText } from "@/components/Icons";
import { t, useT } from "@/i18n";

import type { SeverityCounts } from "./problemsModel";

export interface CodeStatusBarProps {
  dirty: boolean;
  saving: boolean;
  autoSaveOn: boolean;
  cursor: { line: number; col: number };
  /** 선택이 있을 때만. */
  selection: { lines: number; chars: number } | null;
  problemTotals: SeverityCounts;
  /** 언어 서버 상태 (`ready` · `indexing` …). 라벨이 없으면 칩을 안 그린다. */
  lspState: string | null;
  lspLabel: string | null;
  lspDetail: string | null;
  eolLabel: string;
  langLabel: string;
  bytesLabel: string;
  wordWrap: boolean;
  /** ⌘K 귀속 칩 — 창이 만든 것을 그대로 받는다. */
  aiChip: ReactNode;
  onGoToLine: () => void;
  onToggleWordWrap: () => void;
  onOpenProblems: () => void;
}

export function CodeStatusBar({
  dirty,
  saving,
  autoSaveOn,
  cursor,
  selection,
  problemTotals,
  lspState,
  lspLabel,
  lspDetail,
  eolLabel,
  langLabel,
  bytesLabel,
  wordWrap,
  aiChip,
  onGoToLine,
  onToggleWordWrap,
  onOpenProblems,
}: CodeStatusBarProps) {
  useT();
  return (
    <div className="code-statusbar">
      {/* 자동 저장을 켰으면 그 사실이 여기 있어야 한다 — ⌘S 습관을 버려도
          되는지 사용자가 알 방법이 이것뿐이다. */}
      <span className={"code-status-item code-status-dirty" + (dirty ? " on" : "")}>
        <span aria-hidden>{dirty ? "●" : "○"}</span>
        <span>
          {saving
            ? t("code.savingState")
            : dirty
              ? t("code.dirty")
              : autoSaveOn
                ? t("code.autoSaveOn")
                : t("code.savedState")}
        </span>
      </span>
      {/* 커서 조각은 버튼이다 — 누르면 줄 이동 (VS Code 와 같은 관례). */}
      <button
        type="button"
        className="code-status-item code-status-btn"
        onClick={onGoToLine}
        title={t("code.status.gotoLine")}
      >
        Ln {cursor.line}, Col {cursor.col}
      </button>
      {selection ? (
        <span className="code-status-item code-status-sel">
          {t("code.status.selection", { lines: selection.lines, chars: selection.chars })}
        </span>
      ) : null}
      <span className="code-status-right">
        {/* 문제 패널이 있다는 것을 알리는 **유일한 신호**다. 0 일 때도
            남긴다 — 감추면 빈 상태(= "아직 아는 문제 없음")를 읽을 길이
            없어진다. */}
        <button
          type="button"
          className={
            "code-status-item code-status-problems" +
            (problemTotals.error > 0 ? " has-error" : problemTotals.warning > 0 ? " has-warn" : "")
          }
          onClick={onOpenProblems}
          title={t("code.problems.badge", { errors: problemTotals.error, warnings: problemTotals.warning })}
          aria-label={t("code.problems.badge", { errors: problemTotals.error, warnings: problemTotals.warning })}
        >
          <CircleX size={11} aria-hidden />
          <span>{problemTotals.error}</span>
          <TriangleAlert size={11} aria-hidden />
          <span>{problemTotals.warning}</span>
        </button>
        {lspLabel ? (
          <span className={"code-status-item code-status-lsp " + (lspState ?? "")} title={lspDetail ?? undefined}>
            {/* 상태를 색점으로 — 낱말을 읽기 전에 색이 먼저 답한다. */}
            <span className="code-status-led" aria-hidden />
            {lspLabel}
          </span>
        ) : null}
        {/* 줄바꿈 — 켜져 있으면 면을 갖는다. 산문에서는 기본으로 켜지므로 그 사실이
            보여야 "왜 코드 파일은 잘리지" 가 설명된다. */}
        <button
          type="button"
          className={"code-status-item code-status-btn code-status-wrap" + (wordWrap ? " on" : "")}
          onClick={onToggleWordWrap}
          aria-pressed={wordWrap}
          title={t(wordWrap ? "code.status.wrapOn" : "code.status.wrapOff")}
        >
          <WrapText size={11} aria-hidden />
          <span>{t("code.status.wrap")}</span>
        </button>
        {/* 줄바꿈 종류 — CRLF 파일을 모르고 고치면 diff 가 전체 줄로 물든다. */}
        <span className="code-status-item">{eolLabel}</span>
        <span className="code-status-item">{langLabel}</span>
        {/* ⌘K 로 고친 자리 — 누르면 일지 초안이 된다 (귀속 #agent-attribution). */}
        {aiChip}
        <span className="code-status-item">{bytesLabel}</span>
      </span>
    </div>
  );
}
