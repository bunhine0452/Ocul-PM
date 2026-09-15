// 브레드크럼 오른쪽 액션 — 일지 칩 · 판(로컬 히스토리) 칩 · svg 미리보기 · HEAD 비교.
// 창의 상태라 창이 만들어 `CodeCrumbs` 에 넣는다. `CodePane.tsx` 에서 그대로 들어냈다.
import type React from "react";

import { t } from "@/i18n";
import { GitCompareArrows, History, ImageFileIcon, NotebookText } from "@/components/Icons";

import { isSvgPath } from "../previewKind";
import type { DiffMode } from "./types";

interface Props {
  activePath: string;
  /** `fileView.kind === "editor"` — svg 토글과 HEAD 비교는 편집기가 떠 있을 때만. */
  editorShown: boolean;
  entriesCount: number;
  entriesOpen: boolean;
  setEntriesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  historyCount: number;
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshHistory: () => Promise<void>;
  svgOpen: boolean;
  setSvgOpen: React.Dispatch<React.SetStateAction<boolean>>;
  diffMode: DiffMode | null;
  exitDiff: () => void;
  enterHeadDiff: () => Promise<void>;
}

export function CrumbActions({
  activePath,
  editorShown,
  entriesCount,
  entriesOpen,
  setEntriesOpen,
  historyCount,
  historyOpen,
  setHistoryOpen,
  refreshHistory,
  svgOpen,
  setSvgOpen,
  diffMode,
  exitDiff,
  enterHeadDiff,
}: Props) {
  return (
    <>
      {/* 이 파일을 만진 일지 — 에이전트가 여기에 무슨 일을 했는지. */}
      {entriesCount > 0 ? (
        <button
          type="button"
          className={"code-crumb-act" + (entriesOpen ? " on" : "")}
          onClick={() => {
            setEntriesOpen((v) => !v);
            setHistoryOpen(false);
          }}
          title={t("code.jrnl.chipTitle", { count: entriesCount })}
          aria-label={t("code.jrnl.chipTitle", { count: entriesCount })}
          aria-expanded={entriesOpen}
        >
          <NotebookText size={13} />
          <span className="code-crumb-act-n">{entriesCount}</span>
        </button>
      ) : null}
      {/* 이 파일의 판 — 커밋 사이의 시간을 여는 유일한 문. */}
      {historyCount > 0 ? (
        <button
          type="button"
          className={"code-crumb-act" + (historyOpen ? " on" : "")}
          onClick={() => {
            setHistoryOpen((v) => {
              if (!v) void refreshHistory();
              return !v;
            });
            setEntriesOpen(false);
          }}
          title={t("code.hist.chipTitle", { count: historyCount })}
          aria-label={t("code.hist.chipTitle", { count: historyCount })}
          aria-expanded={historyOpen}
        >
          <History size={13} />
          <span className="code-crumb-act-n">{historyCount}</span>
        </button>
      ) : null}
      {/* svg — 코드로 열되 그림도 옆에 띄운다 (VS Code 의 Open Preview 자리). */}
      {editorShown && activePath && isSvgPath(activePath) ? (
        <button
          type="button"
          className={"code-crumb-act" + (svgOpen ? " on" : "")}
          onClick={() => setSvgOpen((v) => !v)}
          title={t("code.svg.toggle")}
          aria-label={t("code.svg.toggle")}
          aria-pressed={svgOpen}
        >
          <ImageFileIcon size={13} />
        </button>
      ) : null}
      {editorShown ? (
        <button
          type="button"
          className={"code-crumb-act" + (diffMode?.kind === "head" ? " on" : "")}
          onClick={() => (diffMode ? exitDiff() : void enterHeadDiff())}
          title={t("code.diff.head")}
          aria-label={t("code.diff.head")}
        >
          <GitCompareArrows size={13} />
        </button>
      ) : null}
    </>
  );
}
