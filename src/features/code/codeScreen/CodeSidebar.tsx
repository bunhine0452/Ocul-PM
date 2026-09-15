// 코드 화면 사이드바 — 파일 트리(머리·루트 행·트리·아웃라인) 또는 전역 검색 패널.
// 상태는 전부 화면이 들고, 여기는 **그리기만** 한다 — 좌/우 어느 자리에 놓이든 같다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import type { WorkspaceState } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import type { LspSymbol } from "@/lib/bindings";

import { CodeOutline } from "../CodeOutline";
import { CodeSearchPanel } from "../CodeSearchPanel";
import { CodeSidebarHead, CodeTreeRoot } from "../CodeSidebarHead";
import { CodeTree, type TreeDraft } from "../CodeTree";
import type { GitMarks } from "../gitDecor";
import type { CodeEntry } from "../treeUtils";
import type { Marks } from "../treeSelection";
import type { UseTreeDragResult } from "../useTreeDrag";

interface CodeSidebarProps {
  projectId: number;
  sidebarOnRight: boolean;
  /** 트리 ↔ 전역 검색. 검색 모드에서는 같은 자리를 검색 패널이 통째로 가져간다. */
  sidebarMode: "files" | "search";
  onCloseSearch: () => void;
  searchOpts: WorkspaceState["codeSearchOpts"];
  onSearchOptsChange: (next: WorkspaceState["codeSearchOpts"]) => void;
  searchFocusSeq: number;
  dirtyPaths: Set<string>;
  openPath: (
    path: string,
    line: number | null,
    pane?: number,
    sel?: { ch?: number; len?: number; preview?: boolean },
  ) => void;
  // ── 머리 ──
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenSearch: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onToggleSide: () => void;
  // ── 루트 행 ──
  rootName: string;
  canCollapse: boolean;
  onCollapseAll: () => void;
  // ── 트리 ──
  truncated: boolean;
  treeIsEmpty: boolean;
  filtering: boolean;
  childrenOf: (dirPath: string) => CodeEntry[] | undefined;
  loadingDirs: Set<string>;
  selected: string | null;
  expandedForRender: Set<string>;
  openPaths: Set<string>;
  gitMarks: GitMarks;
  problemMarks: ReadonlyMap<string, "error" | "warning">;
  draft: TreeDraft | null;
  marks: Marks;
  treeFocusPath: string | null;
  cut: ReadonlySet<string>;
  onTreeKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onClickRow: (path: string, isDir: boolean, e: React.MouseEvent) => void;
  onPin: (path: string) => void;
  onDraftSubmit: (name: string) => void;
  onDraftCancel: () => void;
  onContextMenu: (e: React.MouseEvent, entry: { path: string; isDir: boolean } | null) => void;
  treeDrag: UseTreeDragResult;
  /** Finder 드롭이 밝히는 폴더 — 트리 안 이동(`treeDrag.dropDir`)보다 우선. */
  dropDir: string | null;
  // ── 아웃라인 ──
  symbols: LspSymbol[] | null;
  symbolsLoading: boolean;
  outlineOpen: boolean;
  cursorLine: number;
  onToggleOutline: () => void;
}

export function CodeSidebar({
  projectId,
  sidebarOnRight,
  sidebarMode,
  onCloseSearch,
  searchOpts,
  onSearchOptsChange,
  searchFocusSeq,
  dirtyPaths,
  openPath,
  filter,
  onFilterChange,
  onOpenSearch,
  onNewFile,
  onNewFolder,
  onToggleSide,
  rootName,
  canCollapse,
  onCollapseAll,
  truncated,
  treeIsEmpty,
  filtering,
  childrenOf,
  loadingDirs,
  selected,
  expandedForRender,
  openPaths,
  gitMarks,
  problemMarks,
  draft,
  marks,
  treeFocusPath,
  cut,
  onTreeKeyDown,
  onClickRow,
  onPin,
  onDraftSubmit,
  onDraftCancel,
  onContextMenu,
  treeDrag,
  dropDir,
  symbols,
  symbolsLoading,
  outlineOpen,
  cursorLine,
  onToggleOutline,
}: CodeSidebarProps) {
  return (
    <aside className={"code-sidebar" + (sidebarOnRight ? " on-right" : "")}>
      {sidebarMode === "search" ? (
        <CodeSearchPanel
          projectId={projectId}
          opts={searchOpts}
          onOptsChange={onSearchOptsChange}
          dirtyPaths={dirtyPaths}
          onOpenHit={(path, line, ch, len) => openPath(path, line, undefined, { ch, len })}
          onClose={onCloseSearch}
          focusSeq={searchFocusSeq}
        />
      ) : (
        <>
      <CodeSidebarHead
        filter={filter}
        onFilterChange={onFilterChange}
        onOpenSearch={onOpenSearch}
        onNewFile={onNewFile}
        onNewFolder={onNewFolder}
        sidebarOnRight={sidebarOnRight}
        onToggleSide={onToggleSide}
      />
      <CodeTreeRoot
        name={rootName}
        canCollapse={canCollapse}
        onCollapseAll={onCollapseAll}
      />
      {truncated ? <div className="code-truncated">{t("code.truncated")}</div> : null}
      {treeIsEmpty ? (
        <div className="code-tree-empty">
          {filtering ? t("code.noMatch") : t("code.tree.empty")}
        </div>
      ) : (
        <CodeTree
          childrenOf={childrenOf}
          loadingDirs={loadingDirs}
          selected={selected}
          expanded={expandedForRender}
          dirtyPaths={dirtyPaths}
          openPaths={openPaths}
          gitMarks={gitMarks}
          problemMarks={problemMarks}
          draft={draft}
          marks={marks}
          // 트리 안에서 tabindex 를 가진 자리는 언제나 하나여야 한다.
          focusPath={treeFocusPath}
          cutPaths={cut}
          onKeyDown={onTreeKeyDown}
          onClickRow={onClickRow}
          // 더블클릭은 고정 — 첫 클릭이 이미 열었으므로 승격만 하면 된다.
          onPin={onPin}
          onDraftSubmit={onDraftSubmit}
          onDraftCancel={onDraftCancel}
          onContextMenu={onContextMenu}
          rowDrag={treeDrag.rowDrag}
          draggingPaths={treeDrag.draggingPaths}
          // Finder 드롭과 트리 안 이동이 같은 자리를 밝힌다 — 둘이 동시에
          // 일어날 수는 없다.
          dropDir={dropDir ?? treeDrag.dropDir}
        />
      )}
      {treeDrag.ghost}
      <CodeOutline
        symbols={symbols}
        loading={symbolsLoading}
        open={outlineOpen}
        cursorLine={cursorLine}
        onToggleOpen={onToggleOutline}
        onJump={(line) => selected && openPath(selected, line + 1)}
      />
        </>
      )}
    </aside>
  );
}
