// 탭·분할 상태의 계약. 이 모듈이 따로 있는 이유는 **파일이 디스크에서 움직일 때
// 탭이 따라 움직이는 규칙** 이고, 거기가 가장 조용히 깨지는 자리다.
import { describe, expect, it } from "vitest";
import {
  activateTab,
  allOpenPaths,
  closeOpenPath,
  closeOthers,
  closeTab,
  cycleTab,
  emptyTabs,
  focusPane,
  focusedPath,
  moveTabToOtherPane,
  openFile,
  openPathsUnder,
  pinTab,
  previewPath,
  renameOpenPath,
  sanitizeTabs,
  splitEditor,
  unsplitEditor,
  type CodeTabsState,
} from "@/features/code/codeTabs";

/** `a|b|[c]` — `[]` 가 활성. 창은 `//` 로 나누고, 포커스된 창은 `*` 로 시작한다. */
function show(state: CodeTabsState): string {
  return state.panes
    .map((pane, i) => {
      const body = pane.tabs.map((p) => (p === pane.active ? `[${p}]` : p)).join("|");
      return (state.focused === i ? "*" : "") + body;
    })
    .join(" // ");
}

function withTabs(...paths: string[]): CodeTabsState {
  return paths.reduce((acc, p) => openFile(acc, p), emptyTabs());
}

describe("codeTabs — 열기·닫기", () => {
  it("연 파일이 활성이 되고, 이미 열려 있으면 다시 열지 않는다", () => {
    let s = withTabs("a.ts", "b.ts");
    expect(show(s)).toBe("*a.ts|[b.ts]");
    s = openFile(s, "a.ts");
    expect(show(s)).toBe("*[a.ts]|b.ts");
    expect(allOpenPaths(s)).toEqual(["a.ts", "b.ts"]);
  });

  it("닫으면 오른쪽 이웃이, 없으면 왼쪽이 올라온다", () => {
    let s = activateTab(withTabs("a", "b", "c"), 0, "b");
    s = closeTab(s, 0, "b");
    expect(show(s)).toBe("*a|[c]"); // 오른쪽
    s = closeTab(s, 0, "c");
    expect(show(s)).toBe("*[a]"); // 왼쪽밖에 없다
  });

  it("활성이 아닌 탭을 닫아도 보고 있던 파일은 그대로다", () => {
    const s = closeTab(withTabs("a", "b", "c"), 0, "a");
    expect(show(s)).toBe("*b|[c]");
  });

  it("다른 탭 닫기는 고른 것만 남긴다", () => {
    expect(show(closeOthers(withTabs("a", "b", "c"), 0, "b"))).toBe("*[b]");
  });

  it("전부 닫아도 창은 남는다 (단일 창일 때)", () => {
    let s = withTabs("a");
    s = closeTab(s, 0, "a");
    expect(s.panes).toHaveLength(1);
    expect(focusedPath(s)).toBeNull();
  });
});

describe("codeTabs — 탭 순환 (⌃Tab · ⇧⌘]/[)", () => {
  it("오른쪽으로 돌고, 끝에서는 처음으로 감는다", () => {
    let s = withTabs("a", "b", "c"); // 활성 c (마지막에 연 것)
    s = cycleTab(s, 1);
    expect(show(s)).toBe("*[a]|b|c");
    s = cycleTab(s, 1);
    expect(show(s)).toBe("*a|[b]|c");
  });

  it("왼쪽으로도 감는다", () => {
    const s = cycleTab(activateTab(withTabs("a", "b", "c"), 0, "a"), -1);
    expect(show(s)).toBe("*a|b|[c]");
  });

  it("탭이 하나뿐이거나 없으면 아무 일도 없다", () => {
    const one = withTabs("a");
    expect(cycleTab(one, 1)).toBe(one);
    const none = emptyTabs();
    expect(cycleTab(none, -1)).toBe(none);
  });

  it("분할 중에는 포커스된 창 안에서만 돈다", () => {
    let s = splitEditor(withTabs("a", "b")); // 오른쪽 창 [b], 포커스 1
    s = openFile(s, "c"); // 오른쪽 창 b|[c]
    s = cycleTab(s, 1);
    expect(show(s)).toBe("a|[b] // *[b]|c"); // 왼쪽 창은 그대로
  });
});

describe("codeTabs — 분할", () => {
  it("분할하면 보고 있던 파일이 새 창에 실리고 포커스가 옮겨간다", () => {
    const s = splitEditor(withTabs("a", "b"));
    expect(show(s)).toBe("a|[b] // *[b]");
  });

  it("이미 분할이면 분할 버튼은 반대쪽으로 포커스만 옮긴다", () => {
    const split = splitEditor(withTabs("a"));
    expect(splitEditor(split).focused).toBe(0);
    expect(splitEditor(split).panes).toHaveLength(2);
  });

  it("한쪽 창의 마지막 탭을 닫으면 분할이 접힌다", () => {
    let s = splitEditor(withTabs("a", "b")); // a|[b] // *[b]
    s = closeTab(s, 1, "b");
    expect(s.panes).toHaveLength(1);
    expect(show(s)).toBe("*a|[b]");
  });

  it("분할 해제는 양쪽 탭을 합치고 보던 파일을 유지한다", () => {
    let s = splitEditor(withTabs("a", "b")); // *[b] 가 오른쪽 창
    s = openFile(s, "c"); // 오른쪽 창에 c 추가
    expect(show(s)).toBe("a|[b] // *b|[c]");
    s = unsplitEditor(s);
    // 중복(b)은 접히고, 포커스가 있던 쪽에서 보던 c 를 계속 본다.
    expect(show(s)).toBe("*a|b|[c]");
  });

  it("탭을 반대쪽 창으로 보내면 원래 창에서는 사라진다", () => {
    let s = withTabs("a", "b");
    s = moveTabToOtherPane(s, 0, "a"); // 분할되면서 이동
    expect(show(s)).toBe("[b] // *[a]");
    s = moveTabToOtherPane(s, 1, "a"); // 되돌리면 오른쪽 창이 비어 접힌다
    expect(s.panes).toHaveLength(1);
    expect(allOpenPaths(s).sort()).toEqual(["a", "b"]);
  });
});

describe("codeTabs — 파일 조작과의 정합", () => {
  it("파일 이름이 바뀌면 그 탭이 새 경로를 가리킨다", () => {
    const s = renameOpenPath(withTabs("src/a.ts", "src/b.ts"), "src/a.ts", "src/z.ts", false);
    expect(show(s)).toBe("*src/z.ts|[src/b.ts]");
  });

  it("폴더 이름이 바뀌면 그 아래 열린 탭이 전부 따라온다", () => {
    let s = withTabs("src/a.ts", "src/deep/b.ts", "docs/c.md");
    s = renameOpenPath(s, "src", "lib", true);
    expect(allOpenPaths(s)).toEqual(["lib/a.ts", "lib/deep/b.ts", "docs/c.md"]);
    // 활성 탭도 따라온다 — 안 그러면 저장할 수 없는 유령 탭이 된다.
    expect(focusedPath(s)).toBe("docs/c.md");
    s = activateTab(s, 0, "lib/a.ts");
    expect(focusedPath(s)).toBe("lib/a.ts");
  });

  it("접두사가 겹치는 형제 폴더는 건드리지 않는다", () => {
    // `src` 이름 바꾸기가 `src-old/` 까지 끌고 가면 안 된다.
    const s = renameOpenPath(withTabs("src/a.ts", "src-old/a.ts"), "src", "lib", true);
    expect(allOpenPaths(s)).toEqual(["lib/a.ts", "src-old/a.ts"]);
  });

  it("삭제된 파일의 탭은 닫히고, 오른쪽 이웃이 올라온다", () => {
    let s = activateTab(withTabs("a", "b", "c"), 0, "b");
    s = closeOpenPath(s, "b", false);
    expect(show(s)).toBe("*a|[c]");
  });

  it("삭제된 폴더 아래 탭이 전부 닫히고, 남는 것이 없으면 분할도 접힌다", () => {
    let s = withTabs("src/a.ts", "README.md");
    s = moveTabToOtherPane(s, 0, "src/a.ts"); // README // *src/a.ts
    expect(openPathsUnder(s, "src", true)).toEqual(["src/a.ts"]);
    s = closeOpenPath(s, "src", true);
    expect(s.panes).toHaveLength(1);
    expect(show(s)).toBe("*[README.md]");
  });

  it("열려 있지 않은 경로의 삭제는 상태를 그대로 둔다 (동일 참조)", () => {
    const s = withTabs("a", "b");
    expect(closeOpenPath(s, "c", false)).toBe(s);
    expect(renameOpenPath(s, "c", "d", false)).toBe(s);
  });
});

describe("codeTabs — 미리보기 탭", () => {
  /** 트리 단일 클릭 = 미리보기로 열기. */
  const peek = (s: CodeTabsState, path: string, dirty?: Set<string>) =>
    openFile(s, path, s.focused, { preview: true, dirtyPaths: dirty });

  it("연속으로 훑으면 탭은 하나고 경로만 바뀐다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = peek(s, "b.ts");
    s = peek(s, "c.ts");
    expect(show(s)).toBe("*[c.ts]");
    expect(previewPath(s, 0)).toBe("c.ts");
  });

  it("교체는 자리를 옮기지 않는다 — 훑는 동안 탭이 좌우로 튀면 안 된다", () => {
    let s = withTabs("keep.ts");
    s = peek(s, "a.ts");
    s = openFile(s, "tail.ts"); // 고정으로 하나 더
    s = peek(s, "b.ts");
    expect(s.panes[0].tabs).toEqual(["keep.ts", "b.ts", "tail.ts"]);
  });

  it("이미 열린 고정 탭을 훑어도 미리보기가 되지 않는다", () => {
    let s = withTabs("pinned.ts");
    s = peek(s, "peeked.ts");
    s = peek(s, "pinned.ts");
    expect(show(s)).toBe("*[pinned.ts]|peeked.ts");
    // 미리보기 자리는 그대로 — 고정 탭을 눌렀다고 그 탭이 사라지면 안 된다.
    expect(previewPath(s, 0)).toBe("peeked.ts");
  });

  it("고정하면(편집·더블클릭) 다음에 훑는 파일과 둘 다 남는다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = pinTab(s, 0, "a.ts");
    expect(previewPath(s, 0)).toBeNull();
    s = peek(s, "b.ts");
    expect(show(s)).toBe("*a.ts|[b.ts]");
  });

  it("고정은 미리보기가 아닌 경로에 대해 같은 상태를 그대로 돌려준다", () => {
    // 첫 편집이 타자마다 부르는 자리다 — 새 객체를 만들면 매 글자 리렌더다.
    const s = withTabs("a.ts");
    expect(pinTab(s, 0, "a.ts")).toBe(s);
    expect(pinTab(s, 0, "없는파일.ts")).toBe(s);
  });

  it("미저장인 미리보기 탭은 교체하지 않는다 (방어)", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = peek(s, "b.ts", new Set(["a.ts"]));
    expect(show(s)).toBe("*a.ts|[b.ts]");
    expect(previewPath(s, 0)).toBe("b.ts");
  });

  it("미리보기 탭을 닫으면 자리가 빈다", () => {
    let s = withTabs("a.ts");
    s = peek(s, "b.ts");
    s = closeTab(s, 0, "b.ts");
    expect(previewPath(s, 0)).toBeNull();
  });

  it("다른 창으로 옮기면 고정된다 — 계속 볼 것이라는 신호다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = openFile(s, "b.ts");
    s = moveTabToOtherPane(s, 0, "a.ts");
    expect(previewPath(s, 1)).toBeNull();
    expect(previewPath(s, 0)).toBeNull();
  });

  it("분할해도 미리보기가 창을 넘어가지 않는다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = splitEditor(s);
    // 씨앗 탭은 새 창에서 고정이다 — 아니면 한쪽에서 훑는 것이 반대쪽을 갈아친다.
    expect(previewPath(s, 1)).toBeNull();
    expect(previewPath(s, 0)).toBe("a.ts");
  });

  it("합칠 때는 첫 창의 미리보기만 남는다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = splitEditor(s);
    s = peek(s, "b.ts");
    expect(previewPath(s, 1)).toBe("b.ts");
    s = unsplitEditor(s);
    expect(s.panes).toHaveLength(1);
    expect(previewPath(s, 0)).toBe("a.ts");
  });

  it("이름이 바뀌면 미리보기도 따라가고, 지워지면 자리가 빈다", () => {
    let s = peek(emptyTabs(), "a.ts");
    s = renameOpenPath(s, "a.ts", "z.ts", false);
    expect(previewPath(s, 0)).toBe("z.ts");
    s = closeOpenPath(s, "z.ts", false);
    expect(previewPath(s, 0)).toBeNull();
  });
});

describe("codeTabs — 영속 복원", () => {
  it("미리보기 필드가 없던 예전 JSON 도 받고, 목록 밖이면 비운다", () => {
    const old = sanitizeTabs({ panes: [{ tabs: ["a"], active: "a" }], focused: 0 });
    expect(previewPath(old, 0)).toBeNull();
    const stray = sanitizeTabs({
      panes: [{ tabs: ["a"], active: "a", preview: "gone" }],
      focused: 0,
    });
    expect(previewPath(stray, 0)).toBeNull();
    const kept = sanitizeTabs({
      panes: [{ tabs: ["a", "b"], active: "a", preview: "b" }],
      focused: 0,
    });
    expect(previewPath(kept, 0)).toBe("b");
  });

  it("망가진 값에서도 그릴 수 있는 모양을 만든다", () => {
    expect(sanitizeTabs(null)).toEqual(emptyTabs());
    expect(sanitizeTabs({ panes: [], focused: 9 })).toEqual(emptyTabs());
    // 활성이 목록에 없으면 첫 탭으로, 중복은 접히고, 창은 둘까지.
    const s = sanitizeTabs({
      panes: [
        { tabs: ["a", "a", "b"], active: "gone" },
        { tabs: ["c"], active: "c" },
        { tabs: ["d"], active: "d" },
      ],
      focused: 1,
    });
    expect(show(s)).toBe("[a]|b // *[c]");
  });

  it("두 번째 창이 비어 저장됐으면 단일 창으로 접어서 되살린다", () => {
    const s = sanitizeTabs({ panes: [{ tabs: ["a"], active: "a" }, { tabs: [], active: null }], focused: 1 });
    expect(s.panes).toHaveLength(1);
    expect(s.focused).toBe(0);
  });

  it("포커스가 범위를 벗어나면 첫 창으로 되돌린다", () => {
    expect(focusPane(sanitizeTabs({ panes: [{ tabs: ["a"], active: "a" }], focused: 5 }), 3).focused).toBe(0);
  });
});
