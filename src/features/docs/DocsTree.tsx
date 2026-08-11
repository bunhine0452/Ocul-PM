// 문서(docs) 좌측 파일 트리. 백엔드 docs_tree 가 정렬해 보낸 노드를 그대로 그린다.
import type { DocsTreeNode } from "@/lib/bindings";
import { ChevronRight, Folder, File } from "@/components/Icons";
import { displayName } from "./resolveDocsPath";
import { t, useT } from "@/i18n";

interface DocsTreeProps {
  nodes: DocsTreeNode[];
  selected: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

export function DocsTree({ nodes, selected, expanded, onToggle, onSelect }: DocsTreeProps) {
  useT();
  return (
    <div className="docs-tree" role="tree" aria-label={t("docs.treeAria")}>
      <TreeLevel
        nodes={nodes}
        depth={0}
        selected={selected}
        expanded={expanded}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    </div>
  );
}

function TreeLevel({
  nodes,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: DocsTreeProps & { depth: number }) {
  useT();
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
                className="docs-tree-row docs-tree-dir"
                style={indent}
                onClick={() => onToggle(node.relative_path)}
              >
                <ChevronRight
                  size={13}
                  className={"docs-tree-caret" + (open ? " open" : "")}
                />
                <Folder size={14} className="docs-tree-ico" />
                <span className="docs-tree-label">{node.name}</span>
              </button>
              {open ? (
                <TreeLevel
                  nodes={node.children}
                  depth={depth + 1}
                  selected={selected}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ) : null}
            </div>
          );
        }
        const isSel = selected === node.relative_path;
        return (
          <button
            key={node.relative_path}
            type="button"
            role="treeitem"
            aria-selected={isSel}
            className={"docs-tree-row docs-tree-file" + (isSel ? " on" : "")}
            style={indent}
            onClick={() => onSelect(node.relative_path)}
          >
            <File size={14} className="docs-tree-ico" />
            <span className="docs-tree-label">{displayName(node.name)}</span>
          </button>
        );
      })}
    </>
  );
}
