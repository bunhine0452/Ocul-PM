// 트리 사이드바의 머리 — 필터 + 새 파일/폴더/검색/좌우 이동, 그리고 그 아래
// **루트 행**(저장소 이름 + 모두 접기).
//
// 2026-09-11 편집기 디자인 라운드에서 `CodeScreenV2` 에서 떼어냈다. 화면은
// 이미 1,500줄이라 루트 행 하나를 더 얹을 자리가 없었고, 머리띠는 상태를
// 하나도 갖지 않는 순수한 그리기라 떼어내도 잃는 것이 없다.
import { memo } from "react";

import {
  ChevronsDownUp,
  FilePlus,
  FolderCode,
  FolderPlus,
  PanelLeft,
  PanelRight,
  Search,
  TextSearch,
} from "@/components/Icons";
import { t, useT } from "@/i18n";
import { blocked } from "@/lib/blocked";

interface CodeSidebarHeadProps {
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenSearch: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  sidebarOnRight: boolean;
  onToggleSide: () => void;
}

export const CodeSidebarHead = memo(function CodeSidebarHead({
  filter,
  onFilterChange,
  onOpenSearch,
  onNewFile,
  onNewFolder,
  sidebarOnRight,
  onToggleSide,
}: CodeSidebarHeadProps) {
  useT();
  return (
    <div className="code-sidebar-head">
      <div className="search-box sm code-filter">
        <Search size={13} className="code-filter-ico" />
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t("code.filter")}
          aria-label={t("code.filter")}
          spellCheck={false}
        />
        {filter ? (
          <button
            type="button"
            className="code-filter-clear"
            onClick={() => onFilterChange("")}
            aria-label={t("code.filter.clear")}
            title={t("code.filter.clear")}
          >
            ×
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="code-tool-btn sm"
        onClick={onOpenSearch}
        title={t("code.search.open")}
        aria-label={t("code.search.open")}
      >
        <TextSearch size={15} />
      </button>
      <button
        type="button"
        className="code-tool-btn sm"
        onClick={onNewFile}
        title={t("code.ops.newFile")}
        aria-label={t("code.ops.newFile")}
      >
        <FilePlus size={15} />
      </button>
      <button
        type="button"
        className="code-tool-btn sm"
        onClick={onNewFolder}
        title={t("code.ops.newFolder")}
        aria-label={t("code.ops.newFolder")}
      >
        <FolderPlus size={15} />
      </button>
      <button
        type="button"
        className="code-tool-btn sm"
        onClick={onToggleSide}
        title={t(sidebarOnRight ? "code.sidebar.toLeft" : "code.sidebar.toRight")}
        aria-label={t(sidebarOnRight ? "code.sidebar.toLeft" : "code.sidebar.toRight")}
      >
        {sidebarOnRight ? <PanelLeft size={15} /> : <PanelRight size={15} />}
      </button>
    </div>
  );
});

interface CodeTreeRootProps {
  /** 저장소 이름 — 트리가 어느 저장소의 것인지 트리 스스로 말한다. */
  name: string;
  /** 펼쳐진 폴더가 하나도 없으면 「모두 접기」는 할 일이 없다. */
  canCollapse: boolean;
  onCollapseAll: () => void;
}

/**
 * 루트 행 — VS Code 의 루트 폴더 행과 같은 자리. 스크롤 밖에 고정된다 (깊이
 * 들어가도 뿌리가 보인다). 「모두 접기」는 올렸을 때만 드러난다 — 늘 보이면
 * 이름과 같은 무게로 읽혀 행이 버튼처럼 보인다.
 */
export const CodeTreeRoot = memo(function CodeTreeRoot({ name, canCollapse, onCollapseAll }: CodeTreeRootProps) {
  useT();
  return (
    <div className="code-tree-root" title={name}>
      <FolderCode size={13} className="code-tree-root-ico" aria-hidden />
      <span className="code-tree-root-name">{name}</span>
      <button
        type="button"
        className="code-tool-btn sm"
        onClick={onCollapseAll}
        aria-label={t("code.tree.collapseAll")}
        {...blocked(canCollapse ? null : t("code.tree.collapseAll.blocked"), t("code.tree.collapseAll"))}
      >
        <ChevronsDownUp size={13} />
      </button>
    </div>
  );
});
