// 코드 화면 좌측 파일 트리 — docs 트리와 같은 패턴에 미저장(dirty) 배지를 얹었다.
// 부모가 필터·펼침을 소유하고, 여기는 그리기만 한다. React.memo — 에디터
// 타이핑마다 화면이 리렌더돼도 트리 prop 이 같으면 건너뛴다.
import { memo } from "react";
import type { CodeTreeNode } from "@/lib/bindings";
import { ChevronRight, Folder, FileCode2 } from "@/components/Icons";
import { t, useT } from "@/i18n";

interface CodeTreeProps {
  nodes: CodeTreeNode[];
  selected: string | null;
  expanded: Set<string>;
  /** 미저장 편집이 있는 파일 경로들 — 점 배지. */
  dirtyPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

export const CodeTree = memo(function CodeTree({
  nodes,
  selected,
  expanded,
  dirtyPaths,
  onToggle,
  onSelect,
}: CodeTreeProps) {
  useT();
  return (
    <div className="code-tree" role="tree" aria-label={t("code.treeAria")}>
      <TreeLevel
        nodes={nodes}
        depth={0}
        selected={selected}
        expanded={expanded}
        dirtyPaths={dirtyPaths}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    </div>
  );
});

function TreeLevel({
  nodes,
  depth,
  selected,
  expanded,
  dirtyPaths,
  onToggle,
  onSelect,
}: CodeTreeProps & { depth: number }) {
  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: 8 + depth * 14 };
        if (node.is_dir) {
          const open = expanded.has(node.relative_path);
          return (
            <div key={node.relative_path} role="treeitem" aria-expanded={open}>
              <button
                type="button"
                className="code-tree-row code-tree-dir"
                style={indent}
                onClick={() => onToggle(node.relative_path)}
              >
                <ChevronRight size={13} className={"code-tree-caret" + (open ? " open" : "")} />
                <Folder size={14} className="code-tree-ico" />
                <span className="code-tree-label">{node.name}</span>
              </button>
              {open ? (
                <TreeLevel
                  nodes={node.children}
                  depth={depth + 1}
                  selected={selected}
                  expanded={expanded}
                  dirtyPaths={dirtyPaths}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ) : null}
            </div>
          );
        }
        const isSel = selected === node.relative_path;
        const isDirty = dirtyPaths.has(node.relative_path);
        return (
          <button
            key={node.relative_path}
            type="button"
            role="treeitem"
            aria-selected={isSel}
            className={"code-tree-row code-tree-file" + (isSel ? " on" : "")}
            style={indent}
            onClick={() => onSelect(node.relative_path)}
          >
            <FileCode2 size={14} className="code-tree-ico" />
            <span className="code-tree-label">{node.name}</span>
            {isDirty ? (
              <span className="code-tree-dirty" title={t("code.dirty")} aria-label={t("code.dirty")} />
            ) : null}
          </button>
        );
      })}
    </>
  );
}
