import { describe, expect, it } from "vitest";
import {
  leaf,
  collectSids,
  firstSid,
  splitPane,
  removePane,
  setRatio,
  siblingSid,
  clampRatio,
  type PaneNode,
} from "@/lib/termPanes";

// 터미널 개편 (2026-07-20) — 분할 페인 이진 트리의 순수 변형 규칙 고정.

describe("termPanes — 분할 트리", () => {
  it("leaf 분할 → split(기존, 새), 포커스 대상 유지", () => {
    const t = splitPane(leaf("a"), "a", "row", "b");
    expect(t).toEqual({
      type: "split",
      dir: "row",
      ratio: 0.5,
      a: { type: "leaf", sid: "a" },
      b: { type: "leaf", sid: "b" },
    });
    expect(collectSids(t)).toEqual(["a", "b"]);
    expect(firstSid(t)).toBe("a");
  });

  it("중첩 분할 — 깊은 target 만 치환되고 나머지 참조는 보존", () => {
    const base = splitPane(leaf("a"), "a", "row", "b");
    const t = splitPane(base, "b", "col", "c");
    expect(collectSids(t)).toEqual(["a", "b", "c"]);
    if (t.type !== "split") throw new Error("split 이어야 함");
    expect(t.a).toBe((base as Extract<PaneNode, { type: "split" }>).a); // 불변 참조 보존
    // 없는 target 은 원본 그대로 (같은 참조).
    expect(splitPane(t, "zzz", "row", "x")).toBe(t);
  });

  it("removePane — 형제가 자리를 차지, 루트 제거는 null", () => {
    const t = splitPane(splitPane(leaf("a"), "a", "row", "b"), "b", "col", "c");
    const after = removePane(t, "b");
    expect(after && collectSids(after)).toEqual(["a", "c"]);
    const single = removePane(splitPane(leaf("a"), "a", "row", "b"), "b");
    expect(single).toEqual(leaf("a"));
    expect(removePane(leaf("only"), "only")).toBeNull();
  });

  it("setRatio — 경로 지정 + 클램프", () => {
    const t = splitPane(splitPane(leaf("a"), "a", "row", "b"), "b", "col", "c");
    // 루트 비율.
    const r1 = setRatio(t, "", 0.7);
    if (r1.type !== "split") throw new Error();
    expect(r1.ratio).toBe(0.7);
    // b 쪽 중첩 split ("b" 경로) — 극단값은 클램프.
    const r2 = setRatio(t, "b", 0.02);
    if (r2.type !== "split" || r2.b.type !== "split") throw new Error();
    expect(r2.b.ratio).toBe(clampRatio(0.02));
    if (t.type !== "split") throw new Error();
    expect(r2.a).toBe(t.a);
  });

  it("siblingSid — 닫힌 페인의 포커스 승계 대상", () => {
    const t = splitPane(splitPane(leaf("a"), "a", "row", "b"), "b", "col", "c");
    expect(siblingSid(t, "a")).toBe("b"); // a 를 닫으면 b 쪽 첫 leaf
    expect(siblingSid(t, "c")).toBe("b"); // 형제 b
    expect(siblingSid(t, "b")).toBe("c"); // 형제 c
    expect(siblingSid(leaf("x"), "x")).toBeNull();
  });
});
