// 코드 화면 좌측 파일 트리 — **지연 로딩**이다. 자식을 노드가 들고 있지 않고
// `childrenOf(경로)` 로 조회한다 (`undefined` = 아직 안 읽음). 덕분에 폴더를
// 펼칠 때 그 한 단계만 읽으면 되고, 필터 결과처럼 이미 전량이 있는 소스도
// 같은 렌더러를 그대로 쓴다 (treeUtils 의 flattenToDirMap).
//
// 부모가 필터·펼침을 소유하고, 여기는 그리기만 한다. React.memo — 에디터
// 타이핑마다 화면이 리렌더돼도 prop 이 같으면 건너뛴다.
import { memo } from "react";
import type { CodeEntry } from "./treeUtils";
import { ChevronRight, Folder, FileCode2 } from "@/components/Icons";
import { t, useT } from "@/i18n";

interface CodeTreeProps {
  /** 부모 경로 → 자식들. `undefined` 면 아직 안 읽은 가지다. 루트 키는 `""`. */
  childrenOf: (dirPath: string) => CodeEntry[] | undefined;
  /** 지금 읽는 중인 폴더들 — 펼침 자리에 한 줄을 그린다. */
  loadingDirs: Set<string>;
  selected: string | null;
  expanded: Set<string>;
  /** 미저장 편집이 있는 파일 경로들 — 점 배지. */
  dirtyPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

export const CodeTree = memo(function CodeTree(props: CodeTreeProps) {
  useT();
  return (
    <div className="code-tree" role="tree" aria-label={t("code.treeAria")}>
      <TreeLevel {...props} dirPath="" depth={0} />
    </div>
  );
});

function TreeLevel({ dirPath, depth, ...props }: CodeTreeProps & { dirPath: string; depth: number }) {
  const { childrenOf, loadingDirs, selected, expanded, dirtyPaths, onToggle, onSelect } = props;
  const nodes = childrenOf(dirPath);

  if (nodes === undefined) {
    // 아직 안 읽은 가지. 펼쳤는데 아무 것도 안 나오는 것과 "읽는 중"은 반드시
    // 구별돼야 한다 — 안 그러면 빈 폴더로 읽힌다.
    return <div className="code-tree-loading" style={{ paddingLeft: 8 + depth * 14 }}>{t("code.tree.loading")}</div>;
  }
  if (nodes.length === 0 && depth > 0) {
    return <div className="code-tree-loading" style={{ paddingLeft: 8 + depth * 14 }}>{t("code.tree.emptyDir")}</div>;
  }

  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: 8 + depth * 14 };
        // 저장소가 무시하도록 정한 것은 **숨기지 않고 흐리게** — 디스크에 있는
        // 것은 보이되, 왜 검색·인덱싱에 안 걸리는지가 눈으로 설명된다.
        const dim = node.ignored ? " ignored" : "";
        if (node.is_dir) {
          const open = expanded.has(node.relative_path);
          return (
            <div key={node.relative_path} role="treeitem" aria-expanded={open}>
              <button
                type="button"
                className={"code-tree-row code-tree-dir" + dim}
                style={indent}
                onClick={() => onToggle(node.relative_path)}
                title={node.ignored ? t("code.tree.ignoredHint") : undefined}
              >
                <ChevronRight size={13} className={"code-tree-caret" + (open ? " open" : "")} />
                <Folder size={14} className="code-tree-ico" />
                <span className="code-tree-label">{node.name}</span>
                {loadingDirs.has(node.relative_path) ? <span className="code-tree-spin" aria-hidden /> : null}
              </button>
              {open ? <TreeLevel {...props} dirPath={node.relative_path} depth={depth + 1} /> : null}
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
            className={"code-tree-row code-tree-file" + dim + (isSel ? " on" : "")}
            style={indent}
            onClick={() => onSelect(node.relative_path)}
            title={node.ignored ? t("code.tree.ignoredHint") : undefined}
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
