import { describe, expect, it } from "vitest";
import type { AcpCompaction, AcpEvent } from "@/lib/bindings";
import { applyAcpEvent, openTurn } from "@/features/chat/acpTurns";
import { compactionSummary, fmtTokens } from "@/features/chat/compaction";
import { t } from "@/i18n";

// acp-adapter-0751 {#carry-compaction} — 어댑터가 `think` 로 접어 보내는 압축을
// 제 모양으로. 시작은 빈 메타, 끝의 갱신이 숫자를 싣는다 (adapter 0.75+
// `context-compaction.js`: start → tool_call, finish → tool_call_update).

const meta = (fields: Partial<AcpCompaction> = {}): AcpCompaction => ({
  trigger: null,
  pre_tokens: null,
  post_tokens: null,
  duration_ms: null,
  error: null,
  ...fields,
});

const start: AcpEvent = {
  kind: "tool_call",
  id: "compact-1",
  title: "Compact conversation",
  name: "compact",
  subtitle: null,
  tool_kind: "think",
  status: "in_progress",
  locations: [],
  input: null,
  output: null,
  diffs: [],
  compaction: meta(),
};

const finish: AcpEvent = {
  kind: "tool_update",
  id: "compact-1",
  title: null,
  name: null,
  subtitle: null,
  status: "completed",
  input: null,
  output: null,
  diffs: null,
  compaction: meta({ trigger: "automatic", pre_tokens: 128_000, post_tokens: 41_500, duration_ms: 2_310 }),
};

describe("fmtTokens", () => {
  it("짧게 — 천 단위 k, 백만 단위 M, 그 아래는 그대로", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(1_250)).toBe("1.3k");
    expect(fmtTokens(41_500)).toBe("42k");
    expect(fmtTokens(128_000)).toBe("128k");
    expect(fmtTokens(1_250_000)).toBe("1.25M");
  });
});

describe("compactionSummary", () => {
  it("돌고 있으면 숫자 없이 진행 문장", () => {
    expect(compactionSummary(meta(), "in_progress", t)).toBe("대화를 접는 중");
  });

  it("끝나면 앞→뒤 토큰 · 퍼센트 · 방아쇠 · 시간", () => {
    expect(
      compactionSummary(
        meta({ trigger: "automatic", pre_tokens: 128_000, post_tokens: 41_500, duration_ms: 2_310 }),
        "completed",
        t,
      ),
    ).toBe("128k → 42k 토큰 (−68%) · 자동 · 2.3초");
  });

  it("SDK 가 뒤 토큰을 빼먹으면 앞 토큰만, 방아쇠는 그대로", () => {
    expect(compactionSummary(meta({ trigger: "manual", pre_tokens: 90_000 }), "completed", t)).toBe(
      "90k 토큰에서 · 수동",
    );
  });

  it("실패는 사유를 앞세운다", () => {
    expect(compactionSummary(meta({ error: "Not enough messages to compact" }), "failed", t)).toBe(
      "압축에 실패했어요 — Not enough messages to compact",
    );
  });

  it("숫자도 방아쇠도 없이 끝났으면 그저 끝났다고", () => {
    expect(compactionSummary(meta(), "completed", t)).toBe("접었어요");
  });
});

describe("리듀서 — 압축 메타의 생애", () => {
  it("시작의 빈 메타를 끝의 숫자가 덮고, 숫자 없는 갱신은 이미 받은 것을 지우지 않는다", () => {
    let turns = applyAcpEvent(openTurn([], "compact"), start);
    expect(turns[1].tools?.[0].compaction).toEqual(meta());

    turns = applyAcpEvent(turns, finish);
    expect(turns[1].tools?.[0]).toMatchObject({
      status: "completed",
      compaction: { pre_tokens: 128_000, post_tokens: 41_500 },
    });

    // 어댑터의 heartbeat 처럼 메타 없는 갱신이 뒤따라도 숫자는 남는다.
    turns = applyAcpEvent(turns, { ...finish, status: null, compaction: null });
    expect(turns[1].tools?.[0].compaction?.pre_tokens).toBe(128_000);
  });

  it("메타 없는 think 호출은 압축이 아니다", () => {
    const turns = applyAcpEvent(openTurn([], "x"), { ...start, id: "think-1", name: null, compaction: null });
    expect(turns[1].tools?.[0].compaction).toBeUndefined();
  });
});
