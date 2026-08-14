import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "@/features/chat/markdownBlocks";

// PR-ACP7 — 스트리밍 마크다운 블록 분할.
//
// 지키는 성질 둘: ① 코드블록 안의 빈 줄은 경계가 아니다(잘리면 반쪽 펜스가
// 따로 파싱돼 화면이 깨진다) ② 완성된 블록의 **문자열이 안정**해야 memo 가
// 먹는다 — 뒤에 글자가 더 붙어도 앞 블록들은 그대로여야 한다.

describe("splitMarkdownBlocks", () => {
  it("splits prose on blank lines", () => {
    expect(splitMarkdownBlocks("first\n\nsecond")).toEqual(["first", "second"]);
  });

  it("collapses runs of blank lines instead of emitting empty blocks", () => {
    expect(splitMarkdownBlocks("a\n\n\n\nb")).toEqual(["a", "b"]);
  });

  /** 코드 한복판이 잘리면 반쪽 펜스가 따로 파싱돼 화면이 깨진다. */
  it("keeps blank lines inside a fenced code block together", () => {
    const text = "before\n\n```rust\nlet a = 1;\n\nlet b = 2;\n```\n\nafter";

    expect(splitMarkdownBlocks(text)).toEqual([
      "before",
      "```rust\nlet a = 1;\n\nlet b = 2;\n```",
      "after",
    ]);
  });

  it("treats an unclosed fence as one still-growing block", () => {
    const text = "intro\n\n```ts\nconst x = 1;";

    expect(splitMarkdownBlocks(text)).toEqual(["intro", "```ts\nconst x = 1;"]);
  });

  it("does not confuse a ~~~ fence with a ``` fence", () => {
    const text = "~~~\n```\nstill inside\n~~~";

    expect(splitMarkdownBlocks(text)).toEqual(["~~~\n```\nstill inside\n~~~"]);
  });

  /**
   * memo 가 먹으려면 앞 블록의 **문자열 아이덴티티**가 스트리밍 내내 같아야
   * 한다. 이게 깨지면 매 프레임 전부 재파싱돼 최적화가 통째로 무의미해진다.
   */
  it("keeps earlier blocks byte-identical as the text grows", () => {
    const partial = splitMarkdownBlocks("one\n\ntwo");
    const grown = splitMarkdownBlocks("one\n\ntwo and more\n\nthree");

    expect(grown[0]).toBe(partial[0]);
    expect(grown.length).toBeGreaterThan(partial.length);
  });

  it("returns nothing for empty input", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
  });
});
