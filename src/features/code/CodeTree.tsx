// 코드 화면 좌측 파일 트리 — **지연 로딩**이다. 자식을 노드가 들고 있지 않고
// `childrenOf(경로)` 로 조회한다 (`undefined` = 아직 안 읽음). 덕분에 폴더를
// 펼칠 때 그 한 단계만 읽으면 되고, 필터 결과처럼 이미 전량이 있는 소스도
// 같은 렌더러를 그대로 쓴다 (treeUtils 의 flattenToDirMap).
//
// 부모가 필터·펼침·파일 조작을 소유하고, 여기는 그리기와 입력만 한다 —
// 이름을 받는 인라인 입력칸까지 포함해서 (값은 제출 시점에 부모로 올라간다).
// React.memo — 에디터 타이핑마다 화면이 리렌더돼도 prop 이 같으면 건너뛴다.
import { memo, useEffect, useRef, useState } from "react";
import type { CodeEntry } from "./treeUtils";
import { ChevronRight } from "@/components/Icons";
import { FileIcon } from "./FileIcon";
import { t, useT } from "@/i18n";
import { TREE_DIR_ATTR, TREE_PATH_ATTR } from "./useCodeImport";

/** 트리 안에서 드래그되는 경로의 mime — 탭 드래그와 섞이지 않게 따로 둔다. */
export const PATH_DND_MIME = "application/x-oculpm-code-path";

/**
 * 인라인 입력이 떠 있는 자리.
 *
 * 새 파일/폴더는 **부모 폴더의 자식 목록 맨 위**에, 이름 바꾸기는 **대상 행
 * 자리에** 뜬다 — 다이얼로그보다 지금 어디를 고치는지가 눈에 바로 보인다.
 */
export type TreeDraft =
  | { kind: "create"; parent: string; isDir: boolean }
  | { kind: "rename"; path: string; isDir: boolean; initial: string };

interface CodeTreeProps {
  /** 부모 경로 → 자식들. `undefined` 면 아직 안 읽은 가지다. 루트 키는 `""`. */
  childrenOf: (dirPath: string) => CodeEntry[] | undefined;
  /** 지금 읽는 중인 폴더들 — 펼침 자리에 한 줄을 그린다. */
  loadingDirs: Set<string>;
  selected: string | null;
  expanded: Set<string>;
  /** 미저장 편집이 있는 파일 경로들 — 점 배지. */
  dirtyPaths: Set<string>;
  /** 어느 창에든 탭으로 열려 있는 파일 — 굵게. */
  openPaths: Set<string>;
  draft: TreeDraft | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDraftSubmit: (name: string) => void;
  onDraftCancel: () => void;
  /** 우클릭. `entry` 가 null 이면 빈 배경(=루트)에서 열렸다. */
  onContextMenu: (
    e: React.MouseEvent,
    entry: { path: string; isDir: boolean } | null,
  ) => void;
  /** 드래그로 옮기기. `toDir` 은 목적지 폴더 (`""` = 프로젝트 루트). */
  onMove: (from: string, toDir: string) => void;
  /**
   * Finder 에서 끌고 온 파일이 지금 놓이면 들어갈 폴더 (`null` = 그런 드래그 중이 아님).
   *
   * OS 드롭은 웹뷰의 dragover 를 타지 않아(Tauri 가 가로챈다) 행 스스로는 알 수
   * 없다 — 화면이 좌표로 풀어 준 답을 받아 그 자리만 밝힌다.
   */
  dropDir: string | null;
}

/** 한 단계의 들여쓰기 폭 (px). 가이드 선·자리 계산이 전부 이 값에서 나온다. */
const INDENT = 14;

/**
 * VS Code 식 들여쓰기 가이드 — depth 만큼 세로선 칸을 그린다.
 *
 * paddingLeft 로만 들여쓰면 깊은 트리에서 어느 줄이 어느 폴더의 자식인지
 * 눈으로 따라갈 수 없다. 선은 CSS gradient (`.code-tree-guide`)가 그린다.
 */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="code-tree-guide" aria-hidden />
      ))}
    </>
  );
}

export const CodeTree = memo(function CodeTree(props: CodeTreeProps) {
  useT();
  const [rootDrop, setRootDrop] = useState(false);
  return (
    <div
      className={"code-tree" + (rootDrop || props.dropDir === "" ? " droproot" : "")}
      role="tree"
      aria-label={t("code.treeAria")}
      onContextMenu={(e) => {
        // 행에서 이미 처리했으면 여기까지 오지 않는다 (행이 stopPropagation).
        props.onContextMenu(e, null);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PATH_DND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setRootDrop(true);
      }}
      onDragLeave={() => setRootDrop(false)}
      onDrop={(e) => {
        setRootDrop(false);
        const from = e.dataTransfer.getData(PATH_DND_MIME);
        if (!from) return;
        e.preventDefault();
        props.onMove(from, "");
      }}
    >
      <TreeLevel {...props} dirPath="" depth={0} />
    </div>
  );
});

function TreeLevel({ dirPath, depth, ...props }: CodeTreeProps & { dirPath: string; depth: number }) {
  const {
    childrenOf,
    loadingDirs,
    selected,
    expanded,
    dirtyPaths,
    openPaths,
    draft,
    onToggle,
    onSelect,
    onDraftSubmit,
    onDraftCancel,
    onContextMenu,
    onMove,
  } = props;
  const nodes = childrenOf(dirPath);
  const creatingHere = draft?.kind === "create" && draft.parent === dirPath;

  if (nodes === undefined) {
    // 아직 안 읽은 가지. 펼쳤는데 아무 것도 안 나오는 것과 "읽는 중"은 반드시
    // 구별돼야 한다 — 안 그러면 빈 폴더로 읽힌다.
    return <div className="code-tree-loading" style={{ paddingLeft: 6 + depth * INDENT + 19 }}>{t("code.tree.loading")}</div>;
  }
  if (nodes.length === 0 && depth > 0 && !creatingHere) {
    return <div className="code-tree-loading" style={{ paddingLeft: 6 + depth * INDENT + 19 }}>{t("code.tree.emptyDir")}</div>;
  }

  return (
    <>
      {creatingHere ? (
        <DraftRow
          depth={depth}
          isDir={draft.isDir}
          initial=""
          onSubmit={onDraftSubmit}
          onCancel={onDraftCancel}
        />
      ) : null}
      {nodes.map((node) => {
        if (draft?.kind === "rename" && draft.path === node.relative_path) {
          return (
            <DraftRow
              key={node.relative_path}
              depth={depth}
              isDir={node.is_dir}
              initial={draft.initial}
              onSubmit={onDraftSubmit}
              onCancel={onDraftCancel}
            />
          );
        }
        // 저장소가 무시하도록 정한 것은 **숨기지 않고 흐리게** — 디스크에 있는
        // 것은 보이되, 왜 검색·인덱싱에 안 걸리는지가 눈으로 설명된다.
        const dim = node.ignored ? " ignored" : "";
        // 좌표→행 되찾기용 표식. OS 드롭은 `elementFromPoint` 말고는 어느 행
        // 위인지 알 방법이 없다 (dragover 가 웹뷰까지 오지 않는다).
        const dragProps = {
          [TREE_PATH_ATTR]: node.relative_path,
          [TREE_DIR_ATTR]: node.is_dir ? "1" : "0",
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.setData(PATH_DND_MIME, node.relative_path);
            e.dataTransfer.effectAllowed = "move";
          },
        };
        const menuProps = {
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, { path: node.relative_path, isDir: node.is_dir });
          },
        };

        if (node.is_dir) {
          const open = expanded.has(node.relative_path);
          return (
            <div key={node.relative_path} role="treeitem" aria-expanded={open}>
              <DirRow
                node={node}
                open={open}
                dim={dim}
                depth={depth}
                loading={loadingDirs.has(node.relative_path)}
                onToggle={onToggle}
                onMove={onMove}
                extDrop={props.dropDir === node.relative_path}
                dragProps={dragProps}
                menuProps={menuProps}
              />
              {open ? <TreeLevel {...props} dirPath={node.relative_path} depth={depth + 1} /> : null}
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
            className={
              "code-tree-row code-tree-file" +
              dim +
              (isSel ? " on" : "") +
              (openPaths.has(node.relative_path) ? " open" : "")
            }
            onClick={() => onSelect(node.relative_path)}
            title={node.ignored ? t("code.tree.ignoredHint") : undefined}
            {...dragProps}
            {...menuProps}
          >
            <Guides depth={depth} />
            {/* 캐럿 자리 확보 — 이게 없으면 파일 라벨이 폴더 라벨보다 왼쪽에
                서서 같은 깊이가 다른 깊이처럼 보인다. */}
            <span className="code-tree-caret-pad" aria-hidden />
            <FileIcon name={node.name} size={16} className="code-tree-ico" />
            <span className="code-tree-label">{node.name}</span>
            {dirtyPaths.has(node.relative_path) ? (
              <span className="code-tree-dirty" title={t("code.dirty")} aria-label={t("code.dirty")} />
            ) : null}
          </button>
        );
      })}
    </>
  );
}

/** 폴더 행 — 드롭 대상이라 자기 하이라이트 상태를 갖는다. */
function DirRow({
  node,
  open,
  dim,
  depth,
  loading,
  onToggle,
  onMove,
  extDrop,
  dragProps,
  menuProps,
}: {
  node: CodeEntry;
  open: boolean;
  dim: string;
  depth: number;
  loading: boolean;
  onToggle: (path: string) => void;
  onMove: (from: string, toDir: string) => void;
  /** Finder 드래그가 지금 이 폴더 위에 있다. */
  extDrop: boolean;
  dragProps: object;
  menuProps: object;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      className={"code-tree-row code-tree-dir" + dim + (over || extDrop ? " dropover" : "")}
      onClick={() => onToggle(node.relative_path)}
      title={node.ignored ? t("code.tree.ignoredHint") : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PATH_DND_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData(PATH_DND_MIME);
        if (!from) return;
        e.preventDefault();
        e.stopPropagation();
        onMove(from, node.relative_path);
      }}
      {...dragProps}
      {...menuProps}
    >
      <Guides depth={depth} />
      <ChevronRight size={13} className={"code-tree-caret" + (open ? " open" : "")} />
      <FileIcon name={node.name} isDir open={open} size={16} className="code-tree-ico" />
      <span className="code-tree-label">{node.name}</span>
      {loading ? <span className="code-tree-spin" aria-hidden /> : null}
    </button>
  );
}

/**
 * 이름을 받는 한 줄. Enter 로 확정, Escape 와 **포커스 이탈로 취소** — 트리
 * 어딘가를 클릭했는데 입력칸이 남아 있으면 무엇이 유효한 상태인지 알 수 없다.
 */
function DraftRow({
  depth,
  isDir,
  initial,
  onSubmit,
  onCancel,
}: {
  depth: number;
  isDir: boolean;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  useT();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  // 제출/취소가 두 번 불리지 않게 — blur 는 Enter 직후에도 한 번 더 온다.
  const settled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // 확장자 앞까지만 선택 — 이름 바꾸기의 십중팔구는 확장자를 그대로 둔다.
    const dot = initial.lastIndexOf(".");
    if (!isDir && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial, isDir]);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (commit && name) onSubmit(name);
    else onCancel();
  };

  return (
    <div className="code-tree-row code-tree-draft">
      <Guides depth={depth} />
      <span className="code-tree-caret-pad" aria-hidden />
      <FileIcon name={isDir ? "" : value || initial} isDir={isDir} size={16} className="code-tree-ico" />
      <input
        ref={ref}
        className="code-tree-draft-input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label={isDir ? t("code.ops.newFolder") : t("code.ops.newFile")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => settle(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            settle(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            settle(false);
          }
        }}
      />
    </div>
  );
}
