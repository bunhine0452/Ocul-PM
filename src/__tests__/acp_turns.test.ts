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
  name: null,
  subtitle: null,
  tool_kind: "edit",
  status: "pending",
  locations: ["/repo/a.ts"],
  input: null,
  output: null,
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
      name: null,
      subtitle: null,
      id: "t1",
      title: null,
      status: "completed",
      input: null,
      output: null,
    });

    expect(turns[1].tools?.[0]).toMatchObject({ title: "Edit a.ts", status: "completed" });
  });

  it("ignores updates for tool calls it never saw", () => {
    let turns = applyAcpEvent(openTurn([], "fix it"), toolCall("t1", "Edit a.ts"));

    turns = applyAcpEvent(turns, {
      kind: "tool_update",
      name: null,
      subtitle: null,
      id: "ghost",
      title: "ghost",
      status: "failed",
      input: null,
      output: null,
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

// ─── PR-ACP8 — session/load 재생으로 지난 대화 복원 ──────────────────────────
//
// `session/load` 는 스펙상 지난 대화를 session/update 로 통째로 되흘려보낸다.
// 리듀서가 **빈 목록에서** 그 이벤트만으로 대화를 세울 수 있어야 한다.

const userChunk = (text: string): AcpEvent => ({ kind: "user_chunk", text });

describe("replay (session/load)", () => {
  it("rebuilds an alternating transcript from scratch", () => {
    let turns: AcpTurn[] = [];
    for (const event of [
      userChunk("first ask"),
      chunk("first answer"),
      userChunk("second ask"),
      chunk("second answer"),
    ]) {
      turns = applyAcpEvent(turns, event, true);
    }

    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "first ask"],
      ["agent", "first answer"],
      ["user", "second ask"],
      ["agent", "second answer"],
    ]);
  });

  it("merges consecutive chunks of the same message", () => {
    let turns = applyAcpEvent([], userChunk("ask "), true);
    turns = applyAcpEvent(turns, userChunk("more"), true);
    turns = applyAcpEvent(turns, chunk("ans"), true);
    turns = applyAcpEvent(turns, chunk("wer"), true);

    expect(turns.map((t) => t.text)).toEqual(["ask more", "answer"]);
  });

  /** 라이브에서는 사용자 발화를 우리가 이미 그렸다 — 반향이 오면 무시해야 한다. */
  it("ignores user chunks outside replay so live turns are not duplicated", () => {
    const turns = applyAcpEvent(openTurn([], "ask"), userChunk("ask"));

    expect(turns.map((t) => t.role)).toEqual(["user", "agent"]);
  });

  it("keeps tool calls attached to the agent turn it opened", () => {
    let turns = applyAcpEvent([], userChunk("fix it"), true);
    turns = applyAcpEvent(turns, toolCall("t1", "Edit a.ts"), true);
    turns = applyAcpEvent(turns, chunk("done"), true);

    expect(turns).toHaveLength(2);
    expect(turns[1].tools?.map((t) => t.id)).toEqual(["t1"]);
    expect(turns[1].text).toBe("done");
  });
});


describe("tool input/output", () => {
  const call: AcpEvent = {
    kind: "tool_call",
    name: null,
    subtitle: null,
    id: "t1",
    title: "Bash",
    tool_kind: "execute",
    status: "in_progress",
    locations: [],
    input: "ls -la",
    output: null,
  };

  it("carries the input from the initial call", () => {
    const turns = applyAcpEvent(openTurn([], "run it"), call);
    expect(turns[1].tools?.[0]).toMatchObject({ input: "ls -la", output: undefined });
  });

  /** null 은 "안 왔다"이지 "비었다"가 아니다 — 이미 받은 걸 지우면 안 된다. */
  it("keeps an earlier input when a later update omits it", () => {
    let turns = applyAcpEvent(openTurn([], "run it"), call);
    turns = applyAcpEvent(turns, {
      kind: "tool_update",
      name: null,
      subtitle: null,
      id: "t1",
      title: null,
      status: "completed",
      input: null,
      output: "total 8",
    });

    expect(turns[1].tools?.[0]).toMatchObject({
      input: "ls -la",
      output: "total 8",
      status: "completed",
    });
  });
});

// ─── 생각 시간 ──────────────────────────────────────────────────────────────

describe("thinking timing", () => {
  const thought = (text: string): AcpEvent => ({ kind: "thought", text });

  it("stamps the start on the first thought and the end on the first answer", () => {
    let turns = applyAcpEvent(openTurn([], "ask"), thought("hmm"), false, 1_000);
    turns = applyAcpEvent(turns, thought(" more"), false, 3_000);
    turns = applyAcpEvent(turns, chunk("answer"), false, 19_000);

    expect(turns[1].thoughtStart).toBe(1_000);
    expect(turns[1].thoughtEnd).toBe(19_000);
  });

  /** 답변 중간에 다시 생각해도 "생각한 시간"은 처음 구간이다. */
  it("does not move the end once it is stamped", () => {
    let turns = applyAcpEvent(openTurn([], "ask"), thought("a"), false, 1_000);
    turns = applyAcpEvent(turns, chunk("x"), false, 5_000);
    turns = applyAcpEvent(turns, thought("b"), false, 8_000);
    turns = applyAcpEvent(turns, chunk("y"), false, 9_000);

    expect(turns[1].thoughtEnd).toBe(5_000);
  });

  it("leaves both unset when the agent never thinks out loud", () => {
    const turns = applyAcpEvent(openTurn([], "ask"), chunk("answer"), false, 5_000);
    expect(turns[1].thoughtStart).toBeUndefined();
    expect(turns[1].thoughtEnd).toBeUndefined();
  });
});

describe("tool_call arriving twice", () => {
  /** 같은 세션을 두 번 재생하면 실제로 이렇게 됐다 — React 가 "두 자식이 같은
      key" 라며 카드를 지우거나 겹쳐 그렸다. */
  it("updates the existing card instead of adding a second one with the same id", () => {
    const call = {
      kind: "tool_call" as const,
      id: "toolu_01",
      title: "Read",
      name: "Read",
      subtitle: null,
      tool_kind: "read",
      status: "pending",
      locations: [],
      input: null,
      output: null,
    };
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, call);
    turns = applyAcpEvent(turns, { ...call, status: "completed", output: "done" });

    const tools = turns[1].tools ?? [];
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe("completed");
    expect(tools[0].output).toBe("done");
  });

  it("still keeps distinct ids apart", () => {
    const base = {
      kind: "tool_call" as const,
      title: "Read",
      name: "Read",
      subtitle: null,
      tool_kind: "read",
      status: "pending",
      locations: [],
      input: null,
      output: null,
    };
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, { ...base, id: "a" });
    turns = applyAcpEvent(turns, { ...base, id: "b" });
    expect(turns[1].tools).toHaveLength(2);
  });
});
