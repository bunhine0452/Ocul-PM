import { describe, expect, it } from "vitest";

import { seatActivity } from "@/features/sessions/sessionActivity";
import type { SessionSeat } from "@/features/sessions/sessionModel";
import type { AgentCard, Lease, Task } from "@/lib/bindings";

// 플랜 v3-surface {#activity-vocab-reuse}.
//
// 세션 화면의 「무엇을 하고 있는가」가 대화 화면과 **같은 어휘**를 쓴다.
// 그리고 지어내지 않는다 — 원장이 모르는 것은 적지 않는다.

const CARD = {
  agent_id: "claude-term-1",
  name: "claude-code",
  description: null,
  version: "1",
  provider: "claude-code",
  surface: "terminal",
  session_id: null,
  pid: 1,
  project_root: "/p",
  heartbeat_at: "2026-09-06T00:00:00Z",
  verified: false,
} as unknown as AgentCard;

function seat(over: Partial<SessionSeat> = {}): SessionSeat {
  return {
    id: "claude-term-1",
    card: CARD,
    liveness: "live",
    alias: null,
    label: "Claude Code",
    registeredName: null,
    leases: [],
    openTasks: [],
    ...over,
  };
}

const lease = (patterns: string[]) =>
  ({ id: "l", holder: "claude-term-1", patterns, note: null, created_at: "", expires_at: "" }) as Lease;

const task = (state: string, title: string) =>
  ({ id: "t", title, state, from: "a", to: "claude-term-1" }) as unknown as Task;

describe("세션 한 자리의 활동", () => {
  it("아는 것이 없으면 아무 말도 하지 않는다", () => {
    expect(seatActivity(seat())).toBeNull();
  });

  it("잡은 구역은 「고침」이다 — 대화 화면과 같은 낱말", () => {
    expect(seatActivity(seat({ leases: [lease(["src/**", "docs/**"])] }))).toEqual({
      kind: "edit",
      detail: "src/** · docs/**",
    });
  });

  it("안 끝난 태스크는 세션 원장 어휘로", () => {
    expect(seatActivity(seat({ openTasks: [task("working", "색인 다시 걷기")] }))?.kind).toBe(
      "oculpm-a2a",
    );
  });

  it("승인 대기가 나머지를 이긴다 — 사람이 눌러야 풀리는 것이 먼저다", () => {
    const activity = seatActivity(
      seat({
        leases: [lease(["src/**"])],
        openTasks: [task("working", "그 일"), task("submitted", "승인 기다리는 일")],
      }),
    );
    expect(activity).toEqual({ kind: "permission", detail: "승인 기다리는 일" });
  });
});
