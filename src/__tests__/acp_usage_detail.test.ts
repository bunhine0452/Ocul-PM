import { describe, expect, test } from "vitest";
import { parseUsageDetail } from "@/features/chat/usageDetail";

/** 실측 원문 (claude 2026-08-20, 머리글 줄은 백엔드가 이미 뗀 뒤). */
const REAL = `Approximate, based on local sessions on this machine — does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.

Last 7d · 4704 requests · 44 sessions
  92% of your usage was at >150k context
  48% of your usage came from subagent-heavy sessions
  Top skills: /frontend-design:frontend-design 2%, /claude-api 1%
  Top MCP servers: plugin:oculpm:oculpm 4%, oculpm 1%`;

describe("parseUsageDetail", () => {
  test("실측 원문을 모양별로 뜯는다", () => {
    const blocks = parseUsageDetail(REAL);
    expect(blocks.map((b) => b.kind)).toEqual([
      "note",
      "stat",
      "share",
      "share",
      "top",
      "top",
    ]);
  });

  test("비율 줄은 숫자와 설명으로 갈라지고 되풀이되는 군더더기는 뗀다", () => {
    const blocks = parseUsageDetail(REAL);
    expect(blocks[2]).toEqual({ kind: "share", pct: 92, text: "was at >150k context" });
  });

  test("Top 줄은 이름표와 항목들로", () => {
    const blocks = parseUsageDetail(REAL);
    expect(blocks[4]).toEqual({
      kind: "top",
      label: "Top skills",
      items: [
        { name: "/frontend-design:frontend-design", pct: 2 },
        { name: "/claude-api", pct: 1 },
      ],
    });
  });

  test("모르는 줄은 정렬 공백까지 원문 그대로 남는다", () => {
    const table = "머리\n  Skills                 % of usage\n    /frontend-design       4%";
    const blocks = parseUsageDetail(table);
    expect(blocks[0]).toEqual({ kind: "note", text: "머리" });
    expect(blocks[1]).toEqual({ kind: "text", text: "  Skills                 % of usage" });
    // "4%" 는 줄 끝이라 Top 항목 모양이 아니다 — 표로 남아야 정렬이 산다.
    expect(blocks[2]).toEqual({ kind: "text", text: "    /frontend-design       4%" });
  });

  test("문구가 통째로 바뀌어도 줄을 잃지 않는다", () => {
    const future = "완전히 새로운 문장\n또 다른 줄";
    expect(parseUsageDetail(future).map((b) => "text" in b && b.text)).toEqual([
      "완전히 새로운 문장",
      "또 다른 줄",
    ]);
  });

  test("빈 입력은 빈 목록", () => {
    expect(parseUsageDetail("")).toEqual([]);
  });
});
