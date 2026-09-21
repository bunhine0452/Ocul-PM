import { describe, expect, it } from "vitest";

import type { ConversationTrace, FirstRecordLedger } from "@/lib/bindings";
import { deriveFirstRecord, probe3, shortConversation } from "@/features/today/firstRecordModel";

// ─── first-record-loop {#p1-card} — 첫 기록 카드의 순수한 부분 ──────────────
//
// 보고서 §7 의 상태표를 그대로 문는다. 핵심은 하나다: **성공은 대화 id 로
// 귀속된 일지뿐이다.** 총 일지 수·백필·귀속 불명 일지는 어느 것도 성공이 아니다.

function trace(over: Partial<ConversationTrace> = {}): ConversationTrace {
  return {
    conversation: "11111111-aaaa-bbbb-cccc-dddddddddddd",
    segment_open: false,
    live: false,
    started_at: null,
    last_activity_at: null,
    first_journal: null,
    journal_count: 0,
    missing_signal: false,
    ...over,
  };
}

function ledger(over: Partial<FirstRecordLedger> = {}): FirstRecordLedger {
  return { conversations: [], unattributed_recent: 0, hooks_seen: false, window_days: 30, ...over };
}

const journal = {
  relative_path: "20260922/Bugs/1010_bug_x.md",
  title: "버그 하나",
  created_at: "2026-09-22T10:10:00+09:00",
  agent_id: "claude-code",
};

describe("deriveFirstRecord — 상태 우선순위", () => {
  it("관측된 것이 없으면 준비 상태이고, 훅 연결 여부를 따로 들고 간다", () => {
    expect(deriveFirstRecord(ledger())).toEqual({ kind: "ready", hooksSeen: false });
    expect(deriveFirstRecord(ledger({ hooks_seen: true }))).toEqual({ kind: "ready", hooksSeen: true });
  });

  it("살아 있는 대화가 있고 일지가 없으면 실행 중 — 성공이 아니다", () => {
    const live = trace({ live: true, segment_open: true });
    const view = deriveFirstRecord(ledger({ conversations: [live, trace({ live: true, conversation: "2" })] }));
    expect(view.kind).toBe("running");
    if (view.kind !== "running") return;
    expect(view.conversation).toBe(live);
    expect(view.liveCount).toBe(2);
  });

  it("자기 id 를 적은 일지가 있으면 기록 확인 — 실행 중인 옆 대화보다 앞선다", () => {
    const running = trace({ live: true, conversation: "running" });
    const done = trace({ conversation: "done", first_journal: journal, journal_count: 1 });
    const view = deriveFirstRecord(ledger({ conversations: [running, done] }));
    expect(view.kind).toBe("recorded");
    if (view.kind !== "recorded") return;
    expect(view.journal.relative_path).toBe(journal.relative_path);
    expect(view.conversation.conversation).toBe("done");
  });

  it("귀속 불명 일지만 있으면 성공이 아니라 「알 수 없음」이다 — 백필·수동 기록의 자리", () => {
    const view = deriveFirstRecord(ledger({ unattributed_recent: 3 }));
    expect(view).toEqual({ kind: "unattributed", count: 3 });
  });

  it("기록 없이 끝난 대화는 귀속 불명 일지보다 먼저 말한다", () => {
    const gone = trace({ missing_signal: true });
    const view = deriveFirstRecord(ledger({ conversations: [gone], unattributed_recent: 2 }));
    expect(view.kind).toBe("missing");
  });

  it("죽은 대화(생존 흔적 없음)에 일지도 신호도 없으면 준비 상태로 돌아간다", () => {
    const stale = trace({ segment_open: true, live: false });
    expect(deriveFirstRecord(ledger({ conversations: [stale], hooks_seen: true }))).toEqual({
      kind: "ready",
      hooksSeen: true,
    });
  });
});

describe("helpers", () => {
  it("shortConversation 은 세션·미기록 카드와 같은 8자 축약", () => {
    expect(shortConversation("11111111-aaaa-bbbb")).toBe("11111111…");
    expect(shortConversation("short")).toBe("short");
  });

  it("probe3 — null 은 모름이지 없음이 아니다", () => {
    expect(probe3(null)).toBe("unknown");
    expect(probe3(undefined)).toBe("unknown");
    expect(probe3(false)).toBe("no");
    expect(probe3(true)).toBe("yes");
  });
});
