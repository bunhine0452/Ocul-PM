// 트리 키보드 조작 — WAI-ARIA Tree View 규약을 실제로 지키는지.
//
// 이 표가 없으면 드래그를 못 쓰는 사용자에게는 '옮기기' 기능이 아예 없는 것과
// 같다. 뜻풀이가 순수 함수라 DOM 없이 전부 잰다.
import { describe, expect, it } from "vitest";
import { treeKeyAction, type TreeKeyContext } from "@/features/code/treeKeys";
import type { TreeMark } from "@/features/code/treeSelection";

const ORDER: TreeMark[] = [
  { path: "src", isDir: true },
  { path: "src/main.ts", isDir: false },
  { path: "src/deep", isDir: true },
  { path: "lib", isDir: true },
  { path: "a.ts", isDir: false },
];

function ctx(focus: string | null, open: string[] = ["src"]): TreeKeyContext {
  return { order: ORDER, focus, isExpanded: (d) => open.includes(d) };
}

const key = (k: string, mods: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({
  key: k,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("treeKeyAction — 이동", () => {
  it("↑↓ 는 보이는 행을 따라 움직이고 끝에서 멈춘다", () => {
    expect(treeKeyAction(key("ArrowDown"), ctx("src"))).toEqual({
      kind: "move",
      path: "src/main.ts",
      extend: false,
    });
    expect(treeKeyAction(key("ArrowUp"), ctx("src"))).toEqual({
      kind: "move",
      path: "src",
      extend: false,
    });
    expect(treeKeyAction(key("ArrowDown"), ctx("a.ts"))).toEqual({
      kind: "move",
      path: "a.ts",
      extend: false,
    });
  });

  it("포커스가 없으면 첫 행에서 시작한다", () => {
    expect(treeKeyAction(key("ArrowDown"), ctx(null))).toEqual({
      kind: "move",
      path: "src",
      extend: false,
    });
  });

  it("⇧ 를 얹으면 범위를 넓힌다", () => {
    expect(treeKeyAction(key("ArrowDown", { shiftKey: true }), ctx("src"))).toEqual({
      kind: "move",
      path: "src/main.ts",
      extend: true,
    });
  });

  it("Home/End 는 양 끝으로", () => {
    expect(treeKeyAction(key("End"), ctx("src"))).toMatchObject({ path: "a.ts" });
    expect(treeKeyAction(key("Home"), ctx("a.ts"))).toMatchObject({ path: "src" });
  });
});

describe("treeKeyAction — 좌우", () => {
  it("→ 는 접힌 폴더를 열고, 열린 폴더에서는 첫 자식으로 들어간다", () => {
    expect(treeKeyAction(key("ArrowRight"), ctx("lib"))).toEqual({ kind: "expand", path: "lib" });
    expect(treeKeyAction(key("ArrowRight"), ctx("src"))).toEqual({
      kind: "move",
      path: "src/main.ts",
      extend: false,
    });
  });

  it("→ 는 파일에서 아무 일도 하지 않는다 (내려갈 곳이 없다)", () => {
    expect(treeKeyAction(key("ArrowRight"), ctx("a.ts"))).toBeNull();
  });

  it("← 는 열린 폴더를 접고, 그 밖에서는 부모로 올라간다", () => {
    expect(treeKeyAction(key("ArrowLeft"), ctx("src"))).toEqual({ kind: "collapse", path: "src" });
    expect(treeKeyAction(key("ArrowLeft"), ctx("src/main.ts"))).toEqual({
      kind: "move",
      path: "src",
      extend: false,
    });
    // 최상위 파일에는 올라갈 부모가 없다.
    expect(treeKeyAction(key("ArrowLeft"), ctx("a.ts"))).toBeNull();
  });
});

describe("treeKeyAction — 조작", () => {
  it("⏎ · Space · F2 · Delete · Backspace · Esc", () => {
    expect(treeKeyAction(key("Enter"), ctx("a.ts"))).toEqual({
      kind: "activate",
      path: "a.ts",
      isDir: false,
    });
    expect(treeKeyAction(key(" "), ctx("lib"))).toEqual({
      kind: "mark",
      path: "lib",
      isDir: true,
    });
    expect(treeKeyAction(key("F2"), ctx("a.ts"))).toMatchObject({ kind: "rename" });
    expect(treeKeyAction(key("Delete"), ctx("a.ts"))).toMatchObject({ kind: "delete" });
    // macOS 의 '지우기' 는 ⌫ 다.
    expect(treeKeyAction(key("Backspace"), ctx("a.ts"))).toMatchObject({ kind: "delete" });
    expect(treeKeyAction(key("Escape"), ctx("a.ts"))).toEqual({ kind: "clear" });
  });

  it("⌘·⌃·⌥ 조합은 트리가 건드리지 않는다 — ⌘X/⌘V 가 그 자리의 주인이다", () => {
    expect(treeKeyAction(key("x", { metaKey: true }), ctx("a.ts"))).toBeNull();
    expect(treeKeyAction(key("ArrowDown", { metaKey: true }), ctx("src"))).toBeNull();
    expect(treeKeyAction(key("ArrowDown", { altKey: true }), ctx("src"))).toBeNull();
  });

  it("빈 트리에서는 아무 뜻도 없다", () => {
    const empty: TreeKeyContext = { order: [], focus: null, isExpanded: () => false };
    expect(treeKeyAction(key("ArrowDown"), empty)).toBeNull();
    expect(treeKeyAction(key("Escape"), empty)).toBeNull();
  });
});
