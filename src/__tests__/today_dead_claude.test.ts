/**
 * 오늘 화면의 「Claude 가 기다려요」 줄은 셸 위에서 무언가 도는 칸만 세운다 (love-round L6 #today-crashed-claude).
 *
 * claude 가 `state=clear` 없이 죽으면 OSC 7501 의 blocked 기록이 셸에 남는다(세션이 끝날 때까지). 그 칸은 셸이 다시
 * 앞이라 백엔드가 `busy: false` 로 재 준다 — 줄이 서면 눌렀을 때 빈 셸이다. 창 제목 · Dock 셈(`waiting_in`)과 같은 규칙.
 */
import { describe, expect, it } from "vitest";

import { buildExceptions } from "@/features/today/todayModel";
import type { ClaudeWaiting, TermInfo, TodayDigest } from "@/lib/bindings";

const since = new Date().toISOString();
const digest: TodayDigest = { plans: [], needs_user: [], blocked: [], journal_plan: [] };

function term(id: number, over: Partial<TermInfo>): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: since,
    alive: true,
    exit_code: null,
    busy: true,
    unseen: false,
    status: { state: "blocked", kind: "permission", msg: "approve Bash", since },
    ...over,
  };
}

const kinds = (terms: TermInfo[], hookWaiting: ClaudeWaiting[] = []) =>
  buildExceptions({ entries: [], digest, unrecorded: null, silent: null, plugin: null, terms, hookWaiting }).map((ex) => ex.key);

describe("waiting line — only cells where something still runs on the shell", () => {
  it("a live claude waiting for permission is a line", () => {
    expect(kinds([term(7, {})])).toEqual(["waiting:7"]);
  });

  it("a claude that died without state=clear (shell back in front, busy false) is not a line", () => {
    expect(kinds([term(7, { busy: false })])).toEqual([]);
  });

  it("an ended session is not a line either", () => {
    expect(kinds([term(7, { alive: false, busy: false })])).toEqual([]);
  });

  it("a dead in-app cell does not hide the outside terminal's hook waiting", () => {
    const hook: ClaudeWaiting = { session_id: "ext-1", kind: "permission_prompt", message: "Claude needs your permission", since };
    expect(kinds([term(7, { busy: false })], [hook])).toEqual(["hook-waiting:ext-1"]);
    expect(kinds([term(7, {})], [hook])).toEqual(["waiting:7"]);
  });
});
