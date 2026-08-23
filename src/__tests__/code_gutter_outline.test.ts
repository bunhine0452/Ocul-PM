// git 거터 마커 접기 + 아웃라인의 "지금 어느 심볼 안인가" 계산.
//
// 둘 다 백엔드가 준 자료를 화면 좌표로 옮기는 순수 함수라, 여기가 회귀를
// 잡기에 가장 싼 자리다 (CM6·DOM 을 띄우지 않고 규칙만 본다).
import { describe, expect, it } from "vitest";
import type { GitLineChange, LspSymbol } from "@/lib/bindings";
import { markersByLine } from "@/features/code/gitGutter";
import { indexOfEnclosing } from "@/features/code/CodeOutline";

function change(
  start: number,
  end: number,
  kind: GitLineChange["kind"],
): GitLineChange {
  return { start_line: start, end_line: end, kind };
}

describe("gitGutter — 줄별 마커", () => {
  it("덩어리를 줄 단위로 편다", () => {
    const map = markersByLine([change(3, 5, "added")]);
    expect([...map.entries()]).toEqual([
      [3, "added"],
      [4, "added"],
      [5, "added"],
    ]);
  });

  it("겹치면 더 강한 것이 이긴다 (수정 > 추가 > 삭제)", () => {
    // 마지막에 온 것이 이기게 두면 결과가 응답 순서에 따라 들쭉날쭉해진다.
    const map = markersByLine([change(2, 2, "deleted"), change(2, 2, "added")]);
    expect(map.get(2)).toBe("added");

    const map2 = markersByLine([change(2, 2, "modified"), change(2, 2, "added")]);
    expect(map2.get(2)).toBe("modified");

    // 순서를 뒤집어도 같은 답이어야 한다.
    const map3 = markersByLine([change(2, 2, "added"), change(2, 2, "modified")]);
    expect(map3.get(2)).toBe("modified");
  });

  it("변경이 없으면 비어 있다 (거터가 자리를 안 먹는 근거)", () => {
    expect(markersByLine([]).size).toBe(0);
  });
});

describe("CodeOutline — 커서가 든 심볼", () => {
  const sym = (name: string, line: number, depth = 0): LspSymbol => ({
    name,
    detail: null,
    kind: "function",
    depth,
    line,
    character: 0,
  });

  it("커서보다 앞에서 시작하는 마지막 심볼을 고른다", () => {
    const list = [sym("a", 0), sym("b", 10), sym("c", 20)];
    expect(indexOfEnclosing(list, 0)).toBe(0);
    expect(indexOfEnclosing(list, 9)).toBe(0);
    expect(indexOfEnclosing(list, 10)).toBe(1);
    expect(indexOfEnclosing(list, 99)).toBe(2);
  });

  it("첫 심볼보다 위에 있으면 아무것도 고르지 않는다", () => {
    expect(indexOfEnclosing([sym("a", 5)], 2)).toBe(-1);
    expect(indexOfEnclosing([], 0)).toBe(-1);
  });

  it("중첩된 자식이 부모보다 우선한다 (문서 순서라 자연히 그렇게 된다)", () => {
    const list = [sym("Widget", 10), sym("draw", 12, 1), sym("Other", 30)];
    expect(indexOfEnclosing(list, 13)).toBe(1);
    expect(indexOfEnclosing(list, 11)).toBe(0);
  });
});
