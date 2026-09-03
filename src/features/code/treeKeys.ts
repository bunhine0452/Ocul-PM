// 트리 키보드 조작의 규칙 — 순수 함수. React·DOM 을 모른다.
//
// 트리는 `role="tree"` 를 쓰면서도 화살표가 없었다. 규약을 절반만 지킨 것도
// 문제지만, 실질적인 손해는 따로 있다: **드래그를 못 쓰는 사용자에게는 옮기기
// 기능이 아예 없는 것**과 같았다 (파일 조작이 우클릭 메뉴로만 닿았다).
//
// 어느 키가 무슨 뜻인지는 WAI-ARIA Tree View 규약과 VS Code 탐색기를 따른다.
// 판단을 여기 모아 두면 "지금 무엇에 포커스가 있는가" 를 DOM 에 묻지 않고도
// 전부 테스트할 수 있다.
import type { TreeMark } from "./treeSelection";

export type TreeKeyAction =
  /** 포커스를 옮긴다. `extend` 면 ⇧ 범위 선택까지. */
  | { kind: "move"; path: string; extend: boolean }
  | { kind: "expand"; path: string }
  | { kind: "collapse"; path: string }
  /** ⏎ — 파일이면 열고 폴더면 여닫는다. */
  | { kind: "activate"; path: string; isDir: boolean }
  /** Space — 뽑기 토글 (열지 않는다). */
  | { kind: "mark"; path: string; isDir: boolean }
  | { kind: "rename"; path: string; isDir: boolean }
  | { kind: "delete"; path: string; isDir: boolean }
  /** Esc — 뽑아 둔 것과 잘라 둔 것을 버린다. */
  | { kind: "clear" };

export interface TreeKeyContext {
  /** 지금 보이는 행들, 위에서 아래 순서로. */
  order: readonly TreeMark[];
  /** 지금 포커스가 있는 행. 없으면 첫 행부터 시작한다. */
  focus: string | null;
  isExpanded: (dir: string) => boolean;
}

export interface TreeKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** `src/a/b.rs` → `src/a`. 최상위면 null (트리에는 루트 행이 없다). */
function parentOf(path: string): string | null {
  const at = path.lastIndexOf("/");
  return at < 0 ? null : path.slice(0, at);
}

/**
 * 이 키가 트리에서 무슨 뜻인가. 트리가 처리할 것이 없으면 `null` —
 * 호출자는 그때 `preventDefault` 를 하지 않는다.
 *
 * ⌘·⌃·⌥ 조합은 전부 흘려보낸다. 그 자리들은 화면·앱 단축키(⌘X/⌘V/⌘N…)의
 * 것이고, 트리가 먼저 집으면 그쪽이 조용히 죽는다.
 */
export function treeKeyAction(e: TreeKeyEvent, ctx: TreeKeyContext): TreeKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const { order, focus } = ctx;
  if (order.length === 0) return null;

  const at = focus == null ? -1 : order.findIndex((x) => x.path === focus);
  const current = at >= 0 ? order[at] : null;

  const step = (delta: number): TreeKeyAction => {
    // 포커스가 없으면 어느 방향이든 첫 행에서 시작한다.
    const next = at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + delta));
    return { kind: "move", path: order[next].path, extend: e.shiftKey };
  };

  switch (e.key) {
    case "ArrowDown":
      return step(1);
    case "ArrowUp":
      return step(-1);
    case "Home":
      return { kind: "move", path: order[0].path, extend: e.shiftKey };
    case "End":
      return { kind: "move", path: order[order.length - 1].path, extend: e.shiftKey };
    case "ArrowRight": {
      if (!current) return step(1);
      // 접힌 폴더는 연다. 이미 열린 폴더에서는 **첫 자식으로** 들어간다 —
      // 그 자식은 정의상 목록의 바로 다음 행이다.
      if (!current.isDir) return null;
      return ctx.isExpanded(current.path)
        ? step(1)
        : { kind: "expand", path: current.path };
    }
    case "ArrowLeft": {
      if (!current) return null;
      if (current.isDir && ctx.isExpanded(current.path)) {
        return { kind: "collapse", path: current.path };
      }
      // 접힌 폴더·파일에서는 **부모로 올라간다** (VS Code 와 같다). 부모가
      // 목록에 없을 수는 없다 — 자식이 보이면 부모도 보인다.
      const parent = parentOf(current.path);
      return parent == null ? null : { kind: "move", path: parent, extend: false };
    }
    case "Enter":
      return current ? { kind: "activate", path: current.path, isDir: current.isDir } : null;
    case " ":
      return current ? { kind: "mark", path: current.path, isDir: current.isDir } : null;
    case "F2":
      return current ? { kind: "rename", path: current.path, isDir: current.isDir } : null;
    // Backspace 도 받는다 — macOS 의 '지우기' 는 Delete 키가 아니라 ⌫ 다.
    case "Delete":
    case "Backspace":
      return current ? { kind: "delete", path: current.path, isDir: current.isDir } : null;
    case "Escape":
      return { kind: "clear" };
    default:
      return null;
  }
}
