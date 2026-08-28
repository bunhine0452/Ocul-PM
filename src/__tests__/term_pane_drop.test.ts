/**
 * 터미널 드래그-분할 (2026-08-28) — 가장자리 판정과 트리 삽입의 산술.
 *
 * 이 계산이 틀리면 증상이 "왼쪽에 놓았는데 오른쪽에 붙는다" 처럼 손으로만
 * 재현되는 종류라, 경계값(정확히 띠 끝·모서리·상자 밖)을 여기서 못 박는다.
 */
import { describe, expect, it } from "vitest";
import {
  dropEdge,
  edgeToSplit,
  previewBox,
  contains,
  EDGE_BAND,
  type Box,
} from "@/features/terminal/paneDrop";
import { leaf, splitPaneWith, removePane, collectSids } from "@/lib/termPanes";
import {
  reorderTerminalTabs,
  mergeTabIntoPane,
  movePaneToEdge,
  extractPaneToTab,
  type TabsState,
} from "@/features/terminal/dragOps";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

const box: Box = { left: 100, top: 50, width: 400, height: 200 };

describe("paneDrop — 가장자리 판정", () => {
  it("네 가장자리를 각각 집는다", () => {
    expect(dropEdge(box, 110, 150)).toBe("left");
    expect(dropEdge(box, 490, 150)).toBe("right");
    expect(dropEdge(box, 300, 60)).toBe("top");
    expect(dropEdge(box, 300, 240)).toBe("bottom");
  });

  it("한가운데는 취소 — 놓아도 아무 일도 없다", () => {
    expect(dropEdge(box, 300, 150)).toBe("center");
  });

  it("띠 경계는 포함이다 — 딱 EDGE_BAND 만큼 들어온 점도 분할로 본다", () => {
    const x = box.left + box.width * EDGE_BAND;
    expect(dropEdge(box, x, 150)).toBe("left");
    // 한 픽셀만 더 들어가면 가운데.
    expect(dropEdge(box, x + 1, 150)).toBe("center");
  });

  it("모서리는 **비율**로 더 가까운 변이 이긴다 (픽셀 거리가 아니다)", () => {
    // 400×200 상자라 같은 픽셀만큼 들어와도 세로 쪽이 비율로는 두 배 깊다.
    // 왼쪽 위 모서리에서 픽셀 거리가 같으면(5,5) 가로 비율이 더 얕아 왼쪽이 이긴다.
    expect(dropEdge(box, 105, 55)).toBe("left");
    // 위에서 더 얕게 들어오면 위쪽이 이긴다 (fy 0.01 < fx 0.05).
    expect(dropEdge(box, 120, 52)).toBe("top");
  });

  it("상자 밖은 취소다 — 페인을 벗어난 커서에 자리를 만들어 주지 않는다", () => {
    expect(dropEdge(box, 50, 150)).toBe("center");
    expect(dropEdge(box, 300, 500)).toBe("center");
  });

  it("납작한 상자에서도 0 으로 나누지 않는다", () => {
    expect(dropEdge({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe("left");
  });
});

describe("paneDrop — 가장자리 → 분할 방향", () => {
  it("왼쪽·위는 끌려온 쪽이 앞에 온다", () => {
    expect(edgeToSplit("left")).toEqual({ dir: "row", before: true });
    expect(edgeToSplit("top")).toEqual({ dir: "col", before: true });
  });

  it("오른쪽·아래는 뒤에 온다", () => {
    expect(edgeToSplit("right")).toEqual({ dir: "row", before: false });
    expect(edgeToSplit("bottom")).toEqual({ dir: "col", before: false });
  });

  it("가운데는 분할이 아니다", () => {
    expect(edgeToSplit("center")).toBeNull();
  });
});

describe("paneDrop — 미리보기 상자", () => {
  it("차지할 넓이를 그대로 보여준다", () => {
    expect(previewBox(box, "left")).toEqual({ left: 100, top: 50, width: 200, height: 200 });
    expect(previewBox(box, "right")).toEqual({ left: 300, top: 50, width: 200, height: 200 });
    expect(previewBox(box, "top")).toEqual({ left: 100, top: 50, width: 400, height: 100 });
    expect(previewBox(box, "bottom")).toEqual({ left: 100, top: 150, width: 400, height: 100 });
  });

  it("취소에는 아무것도 그리지 않는다", () => {
    expect(previewBox(box, "center")).toBeNull();
  });

  it("contains 는 경계를 포함한다", () => {
    expect(contains(box, 100, 50)).toBe(true);
    expect(contains(box, 500, 250)).toBe(true);
    expect(contains(box, 99, 150)).toBe(false);
  });
});

describe("termPanes — 서브트리 삽입 (드래그 분할)", () => {
  it("끌려온 쪽을 겨눈 가장자리에 앉힌다", () => {
    const before = splitPaneWith(leaf("a"), "a", "row", leaf("b"), true);
    expect(before).toEqual({
      type: "split",
      dir: "row",
      ratio: 0.5,
      a: { type: "leaf", sid: "b" },
      b: { type: "leaf", sid: "a" },
    });
    const after = splitPaneWith(leaf("a"), "a", "row", leaf("b"), false);
    expect(collectSids(after)).toEqual(["a", "b"]);
  });

  it("분할이 있는 탭을 통째로 끌어와도 트리가 보존된다", () => {
    const incoming = splitPaneWith(leaf("x"), "x", "col", leaf("y"));
    const merged = splitPaneWith(leaf("a"), "a", "row", incoming, false);
    expect(collectSids(merged)).toEqual(["a", "x", "y"]);
  });

  it("겨눈 잎이 없으면 원본 참조를 그대로 돌려준다 (재렌더 절약)", () => {
    const tree = splitPaneWith(leaf("a"), "a", "row", leaf("b"));
    expect(splitPaneWith(tree, "zzz", "col", leaf("c"))).toBe(tree);
  });

  it("같은 탭 안에서 페인을 옮기면 = 뺐다가 그 자리에 다시 꽂는 것", () => {
    // a | b  →  b 를 a 의 위로.
    const tree = splitPaneWith(leaf("a"), "a", "row", leaf("b"));
    const without = removePane(tree, "b");
    expect(without).toEqual(leaf("a"));
    const moved = splitPaneWith(without!, "a", "col", leaf("b"), true);
    expect(moved).toEqual({
      type: "split",
      dir: "col",
      ratio: 0.5,
      a: { type: "leaf", sid: "b" },
      b: { type: "leaf", sid: "a" },
    });
  });
});

// ── 드래그가 탭 목록에 남기는 결과 ──────────────────────────────────────────
//
// 규칙이 서로 물려 있어(합치면 탭이 줄고, 빼내면 늘고, 둘 다 포커스·활성 탭이
// 함께 움직인다) 조합을 여기서 못 박는다.

const tab = (id: string, over: Partial<TerminalTab> = {}): TerminalTab => ({
  id,
  label: id,
  shell: "zsh",
  cwd: "/x",
  ...over,
});

const state = (tabs: TerminalTab[], activeId: string | null): TabsState => ({ tabs, activeId });
const ids = (s: TabsState) => s.tabs.map((t) => t.id);

describe("dragOps — 세션 순서 바꾸기", () => {
  it("끌어 놓은 자리로 옮긴다", () => {
    const before = state([tab("a"), tab("b"), tab("c")], "a");
    expect(ids(reorderTerminalTabs(before, "a", 3))).toEqual(["b", "c", "a"]);
    expect(ids(reorderTerminalTabs(before, "c", 0))).toEqual(["c", "a", "b"]);
  });

  it("제자리면 상태를 건드리지 않는다 (참조까지 동일)", () => {
    const before = state([tab("a"), tab("b")], "a");
    expect(reorderTerminalTabs(before, "a", 0)).toBe(before);
    expect(reorderTerminalTabs(before, "없는탭", 1)).toBe(before);
  });
});

describe("dragOps — 세션을 페인 가장자리에 합치기 (드래그 분할)", () => {
  it("끌려온 탭이 사라지고 그 트리가 대상 페인 옆에 앉는다", () => {
    const before = state([tab("a"), tab("b")], "a");
    const after = mergeTabIntoPane(before, "b", "a", "right");
    expect(ids(after)).toEqual(["a"]);
    expect(after.activeId).toBe("a");
    expect(after.tabs[0].panes).toEqual({
      type: "split",
      dir: "row",
      ratio: 0.5,
      a: { type: "leaf", sid: "a" },
      b: { type: "leaf", sid: "b" },
    });
    // 포커스는 방금 손에 들고 있던 세션이 가져간다.
    expect(after.tabs[0].focusSid).toBe("b");
  });

  it("왼쪽에 놓으면 왼쪽에 앉는다", () => {
    const after = mergeTabIntoPane(state([tab("a"), tab("b")], "a"), "b", "a", "left");
    expect(collectSids(after.tabs[0].panes!)).toEqual(["b", "a"]);
  });

  it("이미 분할된 세션을 끌어오면 그 구조가 통째로 들어온다", () => {
    const split = tab("b", {
      panes: splitPaneWith(leaf("b"), "b", "col", leaf("b2")),
      focusSid: "b2",
    });
    const after = mergeTabIntoPane(state([tab("a"), split], "a"), "b", "a", "bottom");
    expect(collectSids(after.tabs[0].panes!)).toEqual(["a", "b", "b2"]);
    expect(after.tabs[0].focusSid).toBe("b2");
  });

  it("가운데(취소)·자기 자신·없는 대상은 아무 일도 하지 않는다", () => {
    const before = state([tab("a"), tab("b")], "a");
    expect(mergeTabIntoPane(before, "b", "a", "center")).toBe(before);
    expect(mergeTabIntoPane(before, "a", "a", "right")).toBe(before);
    expect(mergeTabIntoPane(before, "b", "없는페인", "right")).toBe(before);
  });
});

describe("dragOps — 분할 안에서 페인 자리 바꾸기", () => {
  const split = () =>
    state(
      [tab("a", { panes: splitPaneWith(leaf("a"), "a", "row", leaf("a2")), focusSid: "a" })],
      "a",
    );

  it("뺐다가 겨눈 자리에 다시 꽂는다", () => {
    const after = movePaneToEdge(split(), "a", "a2", "a", "top");
    expect(after.tabs[0].panes).toEqual({
      type: "split",
      dir: "col",
      ratio: 0.5,
      a: { type: "leaf", sid: "a2" },
      b: { type: "leaf", sid: "a" },
    });
    expect(after.tabs[0].focusSid).toBe("a2");
  });

  it("자기 자신 위·가운데·유일 페인은 아무 일도 하지 않는다", () => {
    const s = split();
    expect(movePaneToEdge(s, "a", "a2", "a2", "top")).toBe(s);
    expect(movePaneToEdge(s, "a", "a2", "a", "center")).toBe(s);
    const single = state([tab("solo")], "solo");
    expect(movePaneToEdge(single, "solo", "solo", "solo", "right")).toBe(single);
  });
});

describe("dragOps — 페인을 빼내 세션으로 (분할의 반대)", () => {
  it("sid 는 그대로 두고 새 탭이 그것을 문다 — 살아 있는 셸이 끊기지 않는다", () => {
    const before = state(
      [
        tab("a", { panes: splitPaneWith(leaf("a"), "a", "row", leaf("a2")), focusSid: "a2" }),
        tab("z"),
      ],
      "a",
    );
    const after = extractPaneToTab(before, "a", "a2", 1, "new1");
    expect(ids(after)).toEqual(["a", "new1", "z"]);
    expect(after.activeId).toBe("new1");
    const born = after.tabs[1];
    expect(born.panes).toEqual(leaf("a2"));
    expect(born.focusSid).toBe("a2");
    // 남은 쪽은 형제만 남고 포커스가 그리로 넘어간다.
    expect(after.tabs[0].panes).toEqual(leaf("a"));
    expect(after.tabs[0].focusSid).toBe("a");
  });

  it("이미 단독 페인이면 빼낼 것이 없다", () => {
    const before = state([tab("solo")], "solo");
    expect(extractPaneToTab(before, "solo", "solo", 0, "new1")).toBe(before);
  });

  it("범위 밖 인덱스는 끝으로 자른다", () => {
    const before = state(
      [tab("a", { panes: splitPaneWith(leaf("a"), "a", "row", leaf("a2")) })],
      "a",
    );
    expect(ids(extractPaneToTab(before, "a", "a2", 99, "new1"))).toEqual(["a", "new1"]);
  });
});
