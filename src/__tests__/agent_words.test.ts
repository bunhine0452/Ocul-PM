import { describe, expect, it } from "vitest";
import {
  AGENT_WORD_KEYS,
  typedLength,
  wordDurationMs,
  wordKeyAt,
} from "@/features/chat/agentWords";

// PR-ACP13 — 작업 중 상태 단어.

describe("wordKeyAt", () => {
  it("cycles through the list in order", () => {
    const first = AGENT_WORD_KEYS.length;
    expect(wordKeyAt(0)).toBe(AGENT_WORD_KEYS[0]);
    expect(wordKeyAt(1)).toBe(AGENT_WORD_KEYS[1]);
    expect(wordKeyAt(first)).toBe(AGENT_WORD_KEYS[0]);
  });

  /** 틱은 계속 커지고, 음수로 갈 일도 있다(시계 되감김) — 어느 쪽이든 안전해야. */
  it("stays in range for large and negative ticks", () => {
    expect(AGENT_WORD_KEYS).toContain(wordKeyAt(9_999));
    expect(AGENT_WORD_KEYS).toContain(wordKeyAt(-3));
  });
});

describe("typedLength", () => {
  it("reveals one character per interval and stops at the end", () => {
    expect(typedLength(0, 5, 50)).toBe(0);
    expect(typedLength(120, 5, 50)).toBe(2);
    expect(typedLength(10_000, 5, 50)).toBe(5);
  });

  it("never returns a negative length for a rewound clock", () => {
    expect(typedLength(-500, 5, 50)).toBe(0);
  });

  it("returns nothing for an empty word", () => {
    expect(typedLength(1_000, 0)).toBe(0);
  });
});

describe("wordDurationMs", () => {
  /** 다 찍자마자 넘어가면 완성된 단어를 읽을 새가 없다. */
  it("leaves a hold after the last character", () => {
    expect(wordDurationMs(4, 50, 1_000)).toBe(1_200);
  });
});
