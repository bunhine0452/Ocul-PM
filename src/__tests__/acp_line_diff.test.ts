import { describe, expect, it } from "vitest";
import { diffLines, diffStats, focusWindow, type DiffLine } from "@/features/chat/lineDiff";

// 편집 diff 의 줄 비교 — 백엔드가 old/new 원문을 넘기고 여기서 +/− 를 매긴다.

const kinds = (lines: DiffLine[]) => lines.map((l) => `${l.kind}:${l.text}`);

describe("diffLines", () => {
  it("marks a one-line replacement inside common context", () => {
    const out = diffLines("a\nb\nc", "a\nB\nc");
    expect(kinds(out)).toEqual(["ctx:a", "del:b", "add:B", "ctx:c"]);
  });

  /** old 가 없으면 새 파일이다 — 전부 추가로 읽혀야 한다. */
  it("treats a null old side as a brand-new file", () => {
    expect(kinds(diffLines(null, "one\ntwo"))).toEqual(["add:one", "add:two"]);
  });

  it("handles pure insertions and deletions", () => {
    expect(kinds(diffLines("a\nc", "a\nb\nc"))).toEqual(["ctx:a", "add:b", "ctx:c"]);
    expect(kinds(diffLines("a\nb\nc", "a\nc"))).toEqual(["ctx:a", "del:b", "ctx:c"]);
  });

  /** `"a\n"` 의 마지막 개행은 줄이 아니다 — 유령 빈 줄이 붙으면 diff 가 거짓말한다. */
  it("does not invent a trailing empty line", () => {
    expect(kinds(diffLines("a\n", "a\nb\n"))).toEqual(["ctx:a", "add:b"]);
  });

  it("returns nothing for identical inputs", () => {
    expect(diffLines("same\nlines", "same\nlines")).toEqual([
      { kind: "ctx", text: "same" },
      { kind: "ctx", text: "lines" },
    ]);
  });

  /** 교체 구간은 "지운 줄들 → 새 줄들" 순서로 읽혀야 한다 — 섞이면 눈이 길을 잃는다. */
  it("groups deletions before additions within one replacement block", () => {
    const out = diffLines("a\nx\ny\nd", "a\np\nq\nd");
    expect(kinds(out)).toEqual(["ctx:a", "del:x", "del:y", "add:p", "add:q", "ctx:d"]);
  });

  /** 표가 상한을 넘으면 정밀 비교를 포기하되 **정보는 잃지 않는다**. */
  it("falls back to whole-replace when the table would be huge", () => {
    const oldText = Array.from({ length: 600 }, (_, i) => `o${i}`).join("\n");
    const newText = Array.from({ length: 600 }, (_, i) => `n${i}`).join("\n");
    const out = diffLines(oldText, newText);
    const stats = diffStats(out);
    expect(stats).toEqual({ added: 600, removed: 600 });
  });

  it("keeps unicode lines intact", () => {
    const out = diffLines("가\n나", "가\n다"); // i18n-ignore -- 테스트 고정값
    expect(kinds(out)).toEqual(["ctx:가", "del:나", "add:다"]); // i18n-ignore -- 테스트 고정값
  });
});

describe("diffStats", () => {
  it("counts added and removed lines only", () => {
    const out = diffLines("a\nb", "a\nc\nd");
    expect(diffStats(out)).toEqual({ added: 2, removed: 1 });
  });
});

describe("focusWindow", () => {
  /** 머리부터 자르면 공통 문맥만 보이고 정작 바뀐 줄은 창 밖이다. */
  it("centers the window on the first change, keeping one context line", () => {
    const lines: DiffLine[] = [
      { kind: "ctx", text: "1" },
      { kind: "ctx", text: "2" },
      { kind: "ctx", text: "3" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
      { kind: "ctx", text: "4" },
      { kind: "ctx", text: "5" },
    ];
    const window = focusWindow(lines, 3);
    expect(window.lines.map((l) => l.text)).toEqual(["3", "old", "new"]);
    expect(window.hiddenBefore).toBe(2);
    expect(window.hiddenAfter).toBe(2);
  });

  it("returns everything untouched when it already fits", () => {
    const lines: DiffLine[] = [{ kind: "add", text: "only" }];
    expect(focusWindow(lines, 8)).toEqual({
      lines,
      hiddenBefore: 0,
      hiddenAfter: 0,
    });
  });
});
