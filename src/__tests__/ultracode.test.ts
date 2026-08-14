import { describe, expect, it } from "vitest";
import { mentionsUltracode, withUltracode } from "@/features/chat/ultracode";

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
