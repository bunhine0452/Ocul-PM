// 트리 우클릭 메뉴의 **차림표** — 무엇을 할 수 있는지만 정하고 실행은 화면이 한다.
//
// 메뉴 항목은 자리(빈 배경 · 파일 · 폴더)마다 다르고 그 규칙은 UI 가 아니라
// 제품 결정이다. 화면 파일에서 떼어 두면 "어느 자리에 무엇이 뜨는가"를
// 한눈에 읽을 수 있고, 배열 하나라 테스트도 쉽다.
import type { CodeMenuItem } from "./CodeContextMenu";
import { parentDir } from "./fileOps";
import { t } from "@/i18n";

/** 메뉴가 부를 수 있는 것들. 화면이 실제 동작을 쥔다. */
export interface TreeMenuActions {
  startCreate: (parent: string, isDir: boolean) => void;
  startRename: (path: string, isDir: boolean) => void;
  askDelete: (path: string, isDir: boolean) => void;
  /** ⌘X — 잘라 둔다. 디스크는 ⌘V 까지 그대로다. */
  cut: (path: string, isDir: boolean) => void;
  /**
   * ⌘V — 잘라 둔 것을 여기로 옮긴다. **잘라 둔 것이 있을 때만** 넘어온다:
   * 없으면 항목 자체를 그리지 않는다 (회색으로 놔두면 왜 못 누르는지 모른다).
   */
  paste?: () => void;
  /** 옆 창에 열기 — 파일에만 뜬다. */
  openBeside: (path: string) => void;
}

/**
 * `entry` 가 null 이면 빈 배경(=프로젝트 루트)에서 열린 메뉴다.
 *
 * 새로 만들기는 **폴더 기준**으로 붙는다 — 파일 위에서 열었으면 그 파일의
 * 부모에 만든다 (VS Code 와 같다).
 */
export function treeMenuItems(
  entry: { path: string; isDir: boolean } | null,
  actions: TreeMenuActions,
): CodeMenuItem[] {
  const parent = entry ? (entry.isDir ? entry.path : parentDir(entry.path)) : "";
  const items: CodeMenuItem[] = [
    {
      label: t("code.ops.newFile"),
      hint: "⌘N",
      onSelect: () => actions.startCreate(parent, false),
    },
    { label: t("code.ops.newFolder"), onSelect: () => actions.startCreate(parent, true) },
  ];
  // 붙여넣기는 빈 배경에서도 뜬다 — 루트로 옮기는 유일한 메뉴 경로다.
  const paste = actions.paste;
  if (paste) {
    items.push({
      label: t("code.ops.pasteHere"),
      hint: "⌘V",
      onSelect: paste,
      separatorBefore: true,
    });
  }
  if (!entry) return items;
  items.push(
    {
      label: t("code.ops.cut"),
      hint: "⌘X",
      onSelect: () => actions.cut(entry.path, entry.isDir),
      separatorBefore: true,
    },
    {
      label: t("code.ops.rename"),
      hint: "F2",
      onSelect: () => actions.startRename(entry.path, entry.isDir),
      separatorBefore: true,
    },
    {
      label: t("code.ops.delete"),
      hint: "⌫",
      onSelect: () => actions.askDelete(entry.path, entry.isDir),
      danger: true,
    },
  );
  if (!entry.isDir) {
    items.push({
      label: t("code.tabs.openBeside"),
      onSelect: () => actions.openBeside(entry.path),
      separatorBefore: true,
    });
  }
  return items;
}
