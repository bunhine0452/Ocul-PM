import { describe, expect, it } from "vitest";
import { mentionsUltracode, nextIndex, withUltracode } from "@/features/chat/ultracode";

// PR-ACP10 — 울트라코드 키워드 옵트인.

describe("mentionsUltracode", () => {
  it("matches the keyword as a whole word, case-insensitively", () => {
    expect(mentionsUltracode("ultracode")).toBe(true);
    expect(mentionsUltracode("please Ultracode this")).toBe(true);
    expect(mentionsUltracode("ULTRACODE")).toBe(true);
  });

  /** `ultracodex` 는 다른 단어다 — 여기서 참이면 키워드가 조용히 안 붙는다. */
  it("does not match when the word is glued to other letters", () => {
    expect(mentionsUltracode("ultracodex")).toBe(false);
    expect(mentionsUltracode("myultracode")).toBe(false);
  });
});

describe("withUltracode", () => {
  it("passes the text through untouched when off", () => {
    expect(withUltracode("refactor this", false)).toBe("refactor this");
  });

  it("prefixes the keyword on its own line when on", () => {
    expect(withUltracode("refactor this", true)).toBe("ultracode\n\nrefactor this");
  });

  /** 두 번 붙으면 사용자가 쓴 적 없는 문장이 되고 화면과 전송분이 어긋난다. */
  it("does not double-prefix when the user already typed it", () => {
    expect(withUltracode("ultracode refactor this", true)).toBe("ultracode refactor this");
  });

  it("leaves empty input alone so a stray keyword is never sent by itself", () => {
    expect(withUltracode("", true)).toBe("");
    expect(withUltracode("   ", true)).toBe("   ");
  });
});

describe("nextIndex", () => {
  it("moves one step in either direction", () => {
    expect(nextIndex(2, 1, 6)).toBe(3);
    expect(nextIndex(2, -1, 6)).toBe(1);
  });

  /** 끝에서 막히면 "안 눌리나" 하고 한 번 더 누르게 되고, 반대편으로 가려면
      지나온 칸을 도로 되짚어야 한다. */
  it("wraps around at both ends", () => {
    expect(nextIndex(5, 1, 6)).toBe(0);
    expect(nextIndex(0, -1, 6)).toBe(5);
  });

  /** 잠긴 칸에서 멎으면 끝에서 막히는 것과 똑같은 막다른 길이다. */
  it("skips locked positions", () => {
    const locked = (at: number) => at === 5;
    expect(nextIndex(4, 1, 6, locked)).toBe(0);
    expect(nextIndex(0, -1, 6, locked)).toBe(4);
  });

  it("stays put when every other position is locked", () => {
    expect(nextIndex(1, 1, 3, (at) => at !== 1)).toBe(1);
  });

  it("is safe on an empty track", () => {
    expect(nextIndex(0, 1, 0)).toBe(0);
  });
});
