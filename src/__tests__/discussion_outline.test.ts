import { afterEach, describe, expect, it } from "vitest";

import { dropDraft, keepDraft, peekDraft } from "@/features/discussion/draftStore";
import { outlineIndexAt, parseOutline, previewText, textStats } from "@/features/discussion/outline";
import { PROSE_MEASURE_PX, PROSE_MIN_GUTTER_PX, PROSE_OPTIONS, proseLayout } from "@/features/discussion/proseEditor";

// 논의 편집기 개편 (2026-10-08) — 편집기가 기대는 순수 판독들.

const DOC = [
  "## 문제 정의", //            1
  "본문", //                    2
  "#### 제약", //               3 — 개요에 안 든다
  "## 후보 해결 방안", //        4
  "### 방안 A — 캐시 {#opt-a}", // 5
  "```md", //                   6
  "## 코드 안의 제목", //        7 — 펜스 안이라 제목이 아니다
  "```", //                     8
  "## 리스크", //                9 — 파서가 모르는 제목
  "- [ ] 할 일 {#next-1}", //   10
].join("\n");

describe("parseOutline", () => {
  it("`##`·`###` 만, 펜스 밖에서, id 를 뗀 제목으로, 1-base 줄로 읽는다", () => {
    expect(parseOutline(DOC)).toEqual([
      { level: 2, title: "문제 정의", line: 1, kind: "problem" },
      { level: 2, title: "후보 해결 방안", line: 4, kind: "options" },
      { level: 3, title: "방안 A — 캐시", line: 5, kind: "options" },
      { level: 2, title: "리스크", line: 9, kind: "unknown" },
    ]);
  });

  it("줄이 속한 항목을 찾는다 — 첫 제목 위면 -1", () => {
    const items = parseOutline(`머리말\n${DOC}`);
    expect(outlineIndexAt(items, 1)).toBe(-1);
    expect(outlineIndexAt(items, 2)).toBe(0);
    expect(outlineIndexAt(items, 6)).toBe(2);
    expect(outlineIndexAt(items, 999)).toBe(3);
  });
});

describe("미리보기·분량", () => {
  it("줄 끝의 안정 id 와 혼자 선 주석 줄만 걷는다", () => {
    expect(
      previewText("### 방안 A {#opt-a}\n<!-- oculpm:discussion-log begin v1 -->\n- [ ] 할 일 {#next-1}\n{#x} 가운데 <!-- 꼬리 -->"),
    ).toBe("### 방안 A\n- [ ] 할 일\n{#x} 가운데 <!-- 꼬리 -->");
  });

  it("글자 수는 공백을 빼고, 로그 경계 주석은 세지 않는다", () => {
    expect(textStats("가나 다\n<!-- oculpm:discussion-log begin v1 -->\nab cd")).toEqual({ chars: 7, words: 4 });
  });
});

describe("산문 편집기 설정", () => {
  it("쓰는 동안 뜨는 제안을 전부 끈다", () => {
    expect(PROSE_OPTIONS.quickSuggestions).toBe(false);
    expect(PROSE_OPTIONS.wordBasedSuggestions).toBe("off");
    expect(PROSE_OPTIONS.suggestOnTriggerCharacters).toBe(false);
    expect(PROSE_OPTIONS.inlineSuggest).toEqual({ enabled: false });
    expect(PROSE_OPTIONS.acceptSuggestionOnEnter).toBe("off");
  });

  it("본문 글꼴로, 실제 폭으로 접는다", () => {
    expect(PROSE_OPTIONS.fontFamily).toBe("var(--font)");
    expect(PROSE_OPTIONS.wrappingStrategy).toBe("advanced");
    expect(PROSE_OPTIONS.wordWrap).toBe("bounded");
  });

  it("넓은 판에선 칼럼을 가운데에, 좁은 판에선 최소 여백만 남긴다", () => {
    const wide = proseLayout(1200, 8);
    expect(wide.gutter).toBe((1200 - PROSE_MEASURE_PX) / 2);
    expect(wide.column).toBe(Math.floor(PROSE_MEASURE_PX / 8));
    const narrow = proseLayout(500, 8);
    expect(narrow.gutter).toBe(PROSE_MIN_GUTTER_PX);
    expect(narrow.column).toBe(Math.floor((500 - 2 * PROSE_MIN_GUTTER_PX) / 8));
  });
});

describe("초안 붙들기", () => {
  afterEach(() => dropDraft(1, "d"));

  it("바뀐 글만 붙들고, 디스크와 같아지면 놓는다", () => {
    keepDraft(1, "d", { text: "새 글", baseText: "옛 글", baseHash: "h" });
    expect(peekDraft(1, "d")).toEqual({ text: "새 글", baseText: "옛 글", baseHash: "h" });
    expect(peekDraft(2, "d")).toBeUndefined();
    keepDraft(1, "d", { text: "옛 글", baseText: "옛 글", baseHash: "h" });
    expect(peekDraft(1, "d")).toBeUndefined();
  });
});
