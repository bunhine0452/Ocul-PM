import { describe, expect, it } from "vitest";
import type { AcpEvent } from "@/lib/bindings";
import { applyAcpEvent, closeTurn, openTurn, type AcpTurn } from "@/features/chat/acpTurns";

// PR-ACP2 — ACP 스트리밍 누적 리듀서.
//
// 여기서 지키는 성질은 하나다: **청크는 열려 있는 마지막 에이전트 턴에만 붙는다.**
// 이게 깨지면 대화가 조용히 뒤섞이고, 화면만 보고는 원인을 찾을 수 없다.

const chunk = (text: string): AcpEvent => ({ kind: "chunk", text });
const thought = (text: string): AcpEvent => ({ kind: "thought", text });
const done: AcpEvent = { kind: "done", stop_reason: "end_turn" };

describe("applyAcpEvent", () => {
  it("appends chunks to the open agent turn", () => {
    // Arrange
    let turns = openTurn([], "2 + 2 ?");

    // Act
    turns = applyAcpEvent(turns, chunk("4"));
    turns = applyAcpEvent(turns, chunk(" total"));

    // Assert
    expect(turns).toEqual<AcpTurn[]>([
      { role: "user", text: "2 + 2 ?" },
      { role: "agent", text: "4 total" },
    ]);
  });

  it("keeps thoughts separate from the answer", () => {
    let turns = openTurn([], "ask");

    turns = applyAcpEvent(turns, thought("hmm"));
    turns = applyAcpEvent(turns, chunk("answer"));

    expect(turns[1]).toEqual({ role: "agent", text: "answer", thought: "hmm" });
  });

  /** 늦게 도착한 청크가 다음 질문의 답에 섞이면 대화가 조용히 오염된다. */
  it("drops chunks that arrive after the turn closed", () => {
    let turns = applyAcpEvent(openTurn([], "first ask"), chunk("first answer"));
    turns = applyAcpEvent(turns, done);

    turns = applyAcpEvent(turns, chunk(" late chunk"));

    expect(turns[1].text).toBe("first answer");
  });

  it("never lets a late chunk land on a new user turn", () => {
    let turns = applyAcpEvent(openTurn([], "first ask"), done);
    turns = openTurn(turns, "second ask");
    // 새 에이전트 턴이 열렸으므로 이제부터의 청크는 여기 붙어야 한다.
    turns = applyAcpEvent(turns, chunk("second answer"));

    expect(turns.map((t) => t.text)).toEqual(["first ask", "", "second ask", "second answer"]);
  });

  it("ignores events it does not render without disturbing the turns", () => {
    const turns = applyAcpEvent(openTurn([], "ask"), {
      kind: "other",
      update: "tool_call",
    });

    expect(turns.map((t) => t.role)).toEqual(["user", "agent"]);
  });

  it("returns a new array rather than mutating the input", () => {
    const before = openTurn([], "ask");
    const after = applyAcpEvent(before, chunk("answer"));

    expect(after).not.toBe(before);
    expect(before[1].text).toBe("");
  });
});

describe("closeTurn", () => {
  it("closes the agent turn so later chunks are refused", () => {
    let turns = closeTurn(openTurn([], "ask"));
    turns = applyAcpEvent(turns, chunk("late"));

    expect(turns[1].text).toBe("");
  });
});

// ─── PR-ACP3 — 도구 호출 카드 누적 ───────────────────────────────────────────

const toolCall = (id: string, title: string): AcpEvent => ({
  kind: "tool_call",
  id,
  title,
  tool_kind: "edit",
  status: "pending",
  locations: ["/repo/a.ts"],
});

describe("tool calls", () => {
  it("collects tool calls on the open agent turn in arrival order", () => {
    let turns = openTurn([], "fix it");

    turns = applyAcpEvent(turns, toolCall("t1", "Read a.ts"));
    turns = applyAcpEvent(turns, toolCall("t2", "Edit a.ts"));

    expect(turns[1].tools?.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(turns[1].tools?.[0].locations).toEqual(["/repo/a.ts"]);
  });

  /** 부분 갱신이 안 온 필드를 덮으면 멀쩡한 제목이 빈 문자열로 지워진다. */
  it("patches only the fields present in an update", () => {
    let turns = applyAcpEvent(openTurn([], "fix it"), toolCall("t1", "Edit a.ts"));

    turns = applyAcpEvent(turns, {
      kind: "tool_update",
      id: "t1",
      title: null,
      status: "completed",
    });

    expect(turns[1].tools?.[0]).toMatchObject({ title: "Edit a.ts", status: "completed" });
  });

  it("ignores updates for tool calls it never saw", () => {
    let turns = applyAcpEvent(openTurn([], "fix it"), toolCall("t1", "Edit a.ts"));

    turns = applyAcpEvent(turns, {
      kind: "tool_update",
      id: "ghost",
      title: "ghost",
      status: "failed",
    });

    expect(turns[1].tools).toHaveLength(1);
    expect(turns[1].tools?.[0].status).toBe("pending");
  });

  it("refuses tool calls that arrive after the turn closed", () => {
    let turns = applyAcpEvent(openTurn([], "fix it"), done);

    turns = applyAcpEvent(turns, toolCall("late", "Late tool"));

    expect(turns[1].tools).toBeUndefined();
  });
});
