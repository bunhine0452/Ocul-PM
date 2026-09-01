import { describe, expect, it } from "vitest";

import {
  SOURCE_ORDER,
  shouldShowRail,
  sourceOf,
  sourceOfAgent,
  sourcesPresent,
  type EntrySource,
} from "@/features/oculpm/entrySource";

// 출처 파생 (Osaurus 라운드 Phase 3 `#source-derive`).
//
// 이 파일이 지키는 계약:
//  1. **세션 접두가 agent.id 보다 먼저다.** 자동화가 쓴 일지의 agent.id 는
//     `auto:<provider>` 라서, 순서를 뒤집으면 스케줄도 감시도 전부 "자동 초안"
//     으로 뭉개진다 — Phase 3 의 배지가 존재할 이유가 사라진다.
//  2. 접두 판정은 백엔드 `SessionId::kind()` 와 **같은 엄격도**다. 느슨하면
//     손으로 적은 `auto-tune` 이 "감시 자동화" 로 둔갑한다.
//  3. 레일은 출처가 1종이면 그리지 않는다.

describe("sourceOf — 8종 판정", () => {
  const cases: [string, string, EntrySource][] = [
    // 세션 접두가 결정한다.
    ["sched-20260901-090000", "auto:anthropic", "schedule"],
    ["auto-20260901-090000", "auto:anthropic", "automation"],
    ["mcp-20260901-090000", "claude-code", "mcp"],
    ["20260901-git", "codex", "backfill"],
    ["import-20260901-090000", "claude-code", "imported"],
    // 접두가 없으면 agent.id 가 결정한다.
    ["20260901-003", "claude-code", "agent"],
    ["20260901-003", "auto:openai", "draft"],
    ["manual-20260901-090000", "manual", "direct"],
    ["manual-20260901-090000", "claude-code", "agent"],
  ];

  for (const [session, agent, expected] of cases) {
    it(`${session} + ${agent} → ${expected}`, () => {
      expect(sourceOf(session, agent)).toBe(expected);
    });
  }

  it("자동화 세션의 auto:* 귀속이 스케줄·감시를 덮지 않는다", () => {
    // 러너는 두 축 모두 `auto:<provider>` 로 귀속한다 — 갈라 주는 것은 접두뿐.
    expect(sourceOf("sched-20260901-090000", "auto:anthropic")).not.toBe(
      sourceOf("auto-20260901-090000", "auto:anthropic"),
    );
  });
});

describe("sourceOf — 경계", () => {
  it("접두만 있고 워크데이 꼬리가 없으면 접두를 믿지 않는다", () => {
    // 손으로 적은 값이 자동화 배지를 훔치면 안 된다.
    expect(sourceOf("auto-tune", "claude-code")).toBe("agent");
    expect(sourceOf("sched-", "manual")).toBe("direct");
    expect(sourceOf("mcp-2026090", "claude-code")).toBe("agent");
  });

  it("git 백필은 정확히 <workday>-git 일 때만", () => {
    expect(sourceOf("20260901-git", "codex")).toBe("backfill");
    expect(sourceOf("20260901-gitlab", "codex")).toBe("agent");
    expect(sourceOf("2026-git", "codex")).toBe("agent");
  });

  it("세션 id 가 없거나 공백이면 agent.id 만으로 읽는다", () => {
    expect(sourceOf(null, "manual")).toBe("direct");
    expect(sourceOf(undefined, "cursor")).toBe("agent");
    expect(sourceOf("   ", "auto:gemini")).toBe("draft");
  });

  it("빈 agent.id 는 '직접' — 알 수 없다고 에이전트로 몰지 않는다", () => {
    expect(sourceOfAgent("")).toBe("direct");
    expect(sourceOfAgent("  ")).toBe("direct");
  });
});

describe("레일 표시 규칙", () => {
  it("출처가 1종뿐이면 그리지 않는다", () => {
    expect(shouldShowRail(["agent", "agent", "agent"])).toBe(false);
    expect(shouldShowRail([])).toBe(false);
  });

  it("2종 이상이면 그린다", () => {
    expect(shouldShowRail(["agent", "direct"])).toBe(true);
  });

  it("나타난 출처는 고정 순서로 접힌다 (렌더마다 흔들리지 않게)", () => {
    expect(sourcesPresent(["mcp", "direct", "mcp", "schedule"])).toEqual([
      "direct",
      "schedule",
      "mcp",
    ]);
  });

  it("SOURCE_ORDER 는 8종을 모두 담는다", () => {
    expect(new Set(SOURCE_ORDER).size).toBe(8);
  });
});
