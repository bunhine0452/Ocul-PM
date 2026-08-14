import { describe, expect, it } from "vitest";
import { revealCount, splitAt } from "@/features/chat/streamPacer";

// 스트리밍 속도 고르기 — 화면의 리듬을 네트워크의 리듬에서 떼어 낸다.

describe("revealCount", () => {
  it("reveals nothing when the queue is empty", () => {
    expect(revealCount(0)).toBe(0);
    expect(revealCount(-5)).toBe(0);
  });

  /** 밀린 만큼 빨라져야 긴 답이 쏟아져도 화면이 뒤처지지 않는다. */
  it("speeds up as the queue grows", () => {
    expect(revealCount(600, { divisor: 6 })).toBe(100);
    expect(revealCount(60, { divisor: 6 })).toBe(10);
  });

  /** 최소 속도가 없으면 조각이 띄엄띄엄 올 때 한 글자씩 기어간다. */
  it("keeps a floor so short bursts still flow", () => {
    expect(revealCount(3, { divisor: 6, min: 2 })).toBe(2);
  });

  /** 대기줄보다 많이 꺼내면 없는 글자를 그리게 된다. */
  it("never reveals more than the queue holds", () => {
    expect(revealCount(1, { min: 8 })).toBe(1);
  });
});

describe("splitAt", () => {
  it("splits into revealed and remaining", () => {
    expect(splitAt("abcdef", 2)).toEqual(["ab", "cdef"]);
  });

  it("handles the ends", () => {
    expect(splitAt("abc", 0)).toEqual(["", "abc"]);
    expect(splitAt("abc", 99)).toEqual(["abc", ""]);
  });

  /** 코드 단위 한가운데서 자르면 반쪽짜리 글자가 한 프레임 스쳤다 사라진다. */
  it("does not cut a surrogate pair in half", () => {
    const text = "a🙂b";
    const [shown, rest] = splitAt(text, 2);
    expect(shown).toBe("a🙂");
    expect(rest).toBe("b");
    expect(shown + rest).toBe(text);
  });
});

describe("splitAt word boundaries", () => {
  /** 반쪽 낱말이 한 프레임 스치면 눈이 매번 읽기를 다시 시작한다 — 흐르는 게
      아니라 덜컹거리는 느낌의 정체다. */
  it("backs up to a space instead of cutting a word in half", () => {
    const [shown, rest] = splitAt("hello production ready", 12);
    expect(shown).toBe("hello ");
    expect(rest).toBe("production ready");
  });

  /** 너무 멀리 물러나면 아무것도 안 나가는 프레임이 생긴다 — 포기하고 자른다. */
  it("gives up when the word is far longer than the lookback", () => {
    const long = "a".repeat(60);
    const [shown, rest] = splitAt(long, 20);
    expect(shown).toHaveLength(20);
    expect(shown + rest).toBe(long);
  });

  it("cuts cleanly when the boundary already lands on a space", () => {
    const [shown, rest] = splitAt("one two three", 4);
    expect(shown).toBe("one ");
    expect(rest).toBe("two three");
  });
});
