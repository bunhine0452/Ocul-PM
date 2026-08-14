import { describe, expect, it } from "vitest";
import { applyMention, findMentionQuery } from "@/features/chat/acpMention";

// PR-ACP5 — `@` 파일 멘션 파싱.
//
// 지키는 성질: ① 이메일 주소를 멘션으로 오인하지 않는다 ② 고른 뒤 앞 문장이
// 살아 있다. 둘 다 눈으로는 잘 안 보이고 조용히 틀리는 자리다.

describe("findMentionQuery", () => {
  it("finds a mention at the end of the input", () => {
    expect(findMentionQuery("look at @src/app")).toEqual({ query: "src/app", start: 8 });
  });

  it("treats a bare @ as an empty query so the picker opens immediately", () => {
    expect(findMentionQuery("look at @")).toEqual({ query: "", start: 8 });
  });

  it("finds a mention at the very start of the input", () => {
    expect(findMentionQuery("@main.rs")).toEqual({ query: "main.rs", start: 0 });
  });

  /** `user@example.com` 이 파일 멘션으로 잡히면 입력할 때마다 목록이 튀어나온다. */
  it("ignores an @ that is glued to preceding text", () => {
    expect(findMentionQuery("mail me at user@example.com")).toBeNull();
  });

  it("stops matching once the mention is followed by a space", () => {
    expect(findMentionQuery("@src/app.ts and then")).toBeNull();
  });
});

describe("applyMention", () => {
  it("replaces only the mention and keeps the sentence before it", () => {
    const text = "please read @src/ap";
    const mention = findMentionQuery(text)!;

    expect(applyMention(text, mention, "src/app.ts")).toBe("please read @src/app.ts ");
  });

  it("works when the mention is the whole input", () => {
    const text = "@";
    const mention = findMentionQuery(text)!;

    expect(applyMention(text, mention, "README.md")).toBe("@README.md ");
  });
});
