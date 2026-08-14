import { describe, expect, it } from "vitest";
import { relativeTime } from "@/features/chat/relativeTime";

// PR-ACP8 — 대화 목록의 짧은 상대 시각.

const NOW = Date.parse("2026-08-14T13:50:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("collapses anything under a minute to now", () => {
    expect(relativeTime(ago(0), NOW)).toBe("now");
    expect(relativeTime(ago(59_000), NOW)).toBe("now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime(ago(17 * 60_000), NOW)).toBe("17m");
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe("2h");
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe("3d");
  });

  it("rounds down so a not-yet-elapsed unit never shows early", () => {
    expect(relativeTime(ago(3_599_000), NOW)).toBe("59m");
    expect(relativeTime(ago(86_399_000), NOW)).toBe("23h");
  });

  /** 시계가 어긋나 미래로 찍힌 항목이 "-3m" 으로 보이면 버그로 읽힌다. */
  it("does not print negative ages for future timestamps", () => {
    expect(relativeTime(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe("now");
  });

  it("returns null for missing or unparseable input", () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(undefined, NOW)).toBeNull();
    expect(relativeTime("not a date", NOW)).toBeNull();
  });
});
