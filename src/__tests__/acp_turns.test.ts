import { describe, expect, it } from "vitest";
import type { AcpEvent } from "@/lib/bindings";
import {
  applyAcpEvent,
  closeTurn,
  insertNotice,
  openTurn,
  turnReceipt,
  fileChangeDiscrepancy,
  type AcpTurn,
} from "@/features/chat/acpTurns";

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
    expect(turns[0]).toEqual<AcpTurn>({ role: "user", text: "2 + 2 ?" });
    expect(turns[1].text).toBe("4 total");
    // 화면은 조각을 그린다 — 이어진 글은 한 조각으로 합쳐진다.
    expect(turns[1].blocks).toEqual([{ kind: "text", text: "4 total" }]);
  });

  it("keeps thoughts separate from the answer", () => {
    let turns = openTurn([], "ask");

    turns = applyAcpEvent(turns, thought("hmm"));
    turns = applyAcpEvent(turns, chunk("answer"));

    expect(turns[1].text).toBe("answer");
    expect(turns[1].thought).toBe("hmm");
    // 생각은 조각에 섞이지 않는다 — 접힌 영역에서 따로 보여 준다.
    expect(turns[1].blocks).toEqual([{ kind: "text", text: "answer" }]);
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
  diffs: [],
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
      diffs: null,
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
      diffs: null,
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
    diffs: [],
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
      diffs: null,
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
      diffs: [],
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
      diffs: [],
    };
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, { ...base, id: "a" });
    turns = applyAcpEvent(turns, { ...base, id: "b" });
    expect(turns[1].tools).toHaveLength(2);
  });
});

describe("blocks keep arrival order", () => {
  /** 도구를 전부 위에, 글을 전부 아래에 모으면 도구 사이사이의 설명이 맨 밑에
      줄줄이 붙어 서로 다른 대목의 문장이 한 문단처럼 이어져 보인다. */
  it("interleaves text and tool calls as they arrived", () => {
    const call = (id: string): AcpEvent => ({
      kind: "tool_call",
      id,
      title: id,
      name: "Bash",
      subtitle: null,
      tool_kind: "execute",
      status: "pending",
      locations: [],
      input: null,
      output: null,
      diffs: [],
    });

    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, chunk("먼저 살펴봅니다.")); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, call("a"));
    turns = applyAcpEvent(turns, chunk("이제 고칩니다.")); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, call("b"));

    expect(turns[1].blocks).toEqual([
      { kind: "text", text: "먼저 살펴봅니다." }, // i18n-ignore -- 테스트 고정값
      { kind: "tool", call: expect.objectContaining({ id: "a" }) },
      { kind: "text", text: "이제 고칩니다." }, // i18n-ignore -- 테스트 고정값
      { kind: "tool", call: expect.objectContaining({ id: "b" }) },
    ]);
  });

  /** 갱신은 **그 자리에서** 바뀌어야 한다 — 뒤로 밀리면 카드가 문장을 건너뛴다. */
  it("updates a tool block in place", () => {
    const base: AcpEvent = {
      kind: "tool_call",
      id: "a",
      title: "a",
      name: "Bash",
      subtitle: null,
      tool_kind: "execute",
      status: "pending",
      locations: [],
      input: null,
      output: null,
      diffs: [],
    };
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, base);
    turns = applyAcpEvent(turns, chunk("설명")); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, {
      kind: "tool_update",
      id: "a",
      name: null,
      subtitle: null,
      title: null,
      status: "completed",
      input: null,
      output: "done",
      diffs: null,
    });

    const blocks = turns[1].blocks ?? [];
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "text"]);
    expect(blocks[0]).toEqual({
      kind: "tool",
      call: expect.objectContaining({ status: "completed", output: "done" }),
    });
  });
});

describe("insertNotice", () => {
  it("appends when no turn is open", () => {
    const turns = insertNotice([], "Opus");
    expect(turns).toEqual([{ role: "notice", text: "Opus" }]);
  });

  /** 맨 뒤에 붙이면 "마지막 턴이 받는 중인 턴"이라는 규칙이 깨져, 그 뒤
      도착하는 청크가 갈 곳을 잃고 조용히 버려진다. */
  it("slips in before the open agent turn so streaming keeps working", () => {
    let turns = openTurn([], "ask");
    turns = insertNotice(turns, "Opus");
    expect(turns.map((t) => t.role)).toEqual(["user", "notice", "agent"]);

    turns = applyAcpEvent(turns, chunk("answer"));
    expect(turns[2].text).toBe("answer");
  });

  it("appends after a closed turn", () => {
    let turns = applyAcpEvent(openTurn([], "ask"), chunk("done"));
    turns = applyAcpEvent(turns, done);
    turns = insertNotice(turns, "Opus");
    expect(turns[turns.length - 1]).toEqual({ role: "notice", text: "Opus" });
  });
});

describe("plan (TODO list)", () => {
  const plan = (entries: { content: string; status: string }[]): AcpEvent => ({
    kind: "plan",
    entries: entries.map((e) => ({ ...e, priority: "medium" })),
  });

  /** 스펙: 갱신은 언제나 **전체 목록**이고 클라이언트가 통째로 갈아 끼운다.
      합치면 같은 항목이 갱신될 때마다 화면에 여러 벌 쌓인다. */
  it("replaces the list wholesale instead of merging", () => {
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, plan([{ content: "a", status: "pending" }]));
    turns = applyAcpEvent(
      turns,
      plan([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ]),
    );

    expect(turns[1].plan).toHaveLength(2);
    expect(turns[1].plan?.[0].status).toBe("completed");
  });

  /** 목록은 턴에 하나다 — 조각 순서에 끼면 갱신마다 새 카드가 생긴다. */
  it("does not add itself to the ordered blocks", () => {
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, chunk("설명")); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, plan([{ content: "a", status: "pending" }]));
    expect(turns[1].blocks?.map((b) => b.kind)).toEqual(["text"]);
  });

  it("is dropped once the turn closed", () => {
    let turns = applyAcpEvent(openTurn([], "go"), done);
    turns = applyAcpEvent(turns, plan([{ content: "late", status: "pending" }]));
    expect(turns[1].plan).toBeUndefined();
  });
});

describe("session failures", () => {
  const failure = (id: string, title: string, revisionTitle?: string): AcpEvent => ({
    kind: "failure",
    id,
    category: "limit",
    severity: "error",
    title: revisionTitle ?? title,
    details: null,
  });

  /** 스펙: 같은 id 의 더 높은 revision 은 그 줄을 제자리에서 고치는 것이지 새
      줄이 아니다. 밀어 넣으면 재시도마다 같은 사고가 여러 줄 쌓인다. */
  it("updates the same incident in place instead of stacking", () => {
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, failure("t1:error", "rate limited"));
    turns = applyAcpEvent(turns, failure("t1:error", "", "retrying in 30s"));

    const blocks = turns[1].blocks ?? [];
    expect(blocks.filter((b) => b.kind === "failure")).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "failure", title: "retrying in 30s" });
  });

  /** 다른 id 는 다른 사건이다 — 제목이 같아도 합치지 않는다(스펙). */
  it("keeps distinct incidents apart even with identical text", () => {
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, failure("t1:error", "rate limited"));
    turns = applyAcpEvent(turns, failure("t2:error", "rate limited"));
    expect((turns[1].blocks ?? []).filter((b) => b.kind === "failure")).toHaveLength(2);
  });

  /** 일어난 자리가 정보다 — 어느 도구 뒤에 걸렸는지가 순서로 읽힌다. */
  it("sits where it happened in the block order", () => {
    let turns = openTurn([], "go");
    turns = applyAcpEvent(turns, chunk("작업 중")); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, failure("t1:error", "rate limited"));
    expect((turns[1].blocks ?? []).map((b) => b.kind)).toEqual(["text", "failure"]);
  });
});

// ─── 턴 영수증 ──────────────────────────────────────────────────────────────

describe("turnReceipt", () => {
  const edit = (id: string, path: string): AcpEvent => ({
    kind: "tool_call",
    id,
    title: "Edit",
    name: "Edit",
    subtitle: null,
    tool_kind: "edit",
    status: "completed",
    locations: [path],
    input: null,
    output: null,
    diffs: [],
  });
  const bash = (id: string): AcpEvent => ({
    kind: "tool_call",
    id,
    title: "Bash",
    name: "Bash",
    subtitle: null,
    tool_kind: "execute",
    status: "completed",
    locations: [],
    input: "pnpm test",
    output: null,
    diffs: [],
  });

  it("summarizes tools, touched files and commands of a closed turn", () => {
    let turns = openTurn([], "고쳐줘", undefined, 1_000); // i18n-ignore -- 테스트 고정값
    turns = applyAcpEvent(turns, edit("e1", "/repo/a.ts"));
    turns = applyAcpEvent(turns, edit("e2", "/repo/a.ts")); // 같은 파일 — 한 번만 센다.
    turns = applyAcpEvent(turns, bash("b1"));
    turns = closeTurn(turns, 73_000);

    expect(turnReceipt(turns[1])).toEqual({
      tools: 3,
      files: 1,
      commands: 1,
      seconds: 72,
    });
  });

  /** 말로만 답한 턴에 "도구 0" 영수증을 붙이면 정보가 아니라 소음이다. */
  it("is null for open turns and tool-less turns", () => {
    let turns = openTurn([], "ask", undefined, 1_000);
    turns = applyAcpEvent(turns, edit("e1", "/repo/a.ts"));
    expect(turnReceipt(turns[1])).toBeNull(); // 아직 안 닫힘.

    let talk = openTurn([], "ask", undefined, 1_000);
    talk = closeTurn(talk, 5_000);
    expect(turnReceipt(talk[1])).toBeNull(); // 도구 없음.
  });

  /** 재생으로 복원한 턴에는 시각이 없다 — 없는 시간을 지어내면 안 된다. */
  it("omits duration when the turn has no timestamps", () => {
    let turns = openTurn([], "ask"); // now 없음 (재생과 같은 조건)
    turns = applyAcpEvent(turns, bash("b1"));
    turns = closeTurn(turns);
    expect(turnReceipt(turns[1])?.seconds).toBeNull();
  });

  /** done 이벤트로 닫혀도 끝 시각이 찍힌다 — 영수증의 소요 시간이 여기서 나온다. */
  it("stamps endedAt when the done event closes the turn", () => {
    let turns = openTurn([], "ask", undefined, 1_000);
    turns = applyAcpEvent(turns, bash("b1"));
    turns = applyAcpEvent(turns, done, false, 31_000);
    expect(turnReceipt(turns[1])?.seconds).toBe(30);
  });
});

// ── 파일 변경 감사 (어댑터 0.70.0) ──────────────────────────────────────────
// 에이전트가 턴 끝에 직접 신고하는 목록. 도구 흔적으로 센 영수증과 출처가
// 달라서, 어긋날 때가 정보다.

const report = (over: Partial<Extract<AcpEvent, { kind: "file_change_report" }>> = {}): AcpEvent => ({
  kind: "file_change_report",
  request_id: "req-1",
  paths: ["/w/a.ts"],
  complete: true,
  truncated: false,
  uncertainty: null,
  unavailable: null,
  ...over,
});

describe("file change audit", () => {
  it("attaches to the last agent turn even after it closed", () => {
    // 어댑터는 Stop 훅에서 보고를 만들어 done 과 순서가 뒤집힐 수 있다.
    let turns = openTurn([], "fix it");
    turns = applyAcpEvent(turns, chunk("done"));
    turns = applyAcpEvent(turns, done, false, 1000);
    expect(turns[turns.length - 1].closed).toBe(true);

    turns = applyAcpEvent(turns, report({ paths: ["/w/a.ts", "/w/b.ts"] }));

    expect(turns[turns.length - 1].fileChanges?.paths).toEqual(["/w/a.ts", "/w/b.ts"]);
  });

  it("stays silent when the report agrees with the inferred receipt", () => {
    // 같은 수를 두 번 적으면 정보가 아니라 소음이다.
    const turn: AcpTurn = {
      role: "agent",
      text: "",
      closed: true,
      tools: [{ id: "1", title: "Edit", kind: "edit", status: "completed", locations: ["/w/a.ts"] }],
      fileChanges: { requestId: "r", paths: ["/w/a.ts"], complete: true, truncated: false },
    };
    expect(fileChangeDiscrepancy(turn)).toBeNull();
  });

  it("flags files the tool trace never showed", () => {
    // 명령·자식 프로세스가 바꾼 파일은 편집 도구 호출로 안 잡힌다 — 이게 핵심 가치다.
    const turn: AcpTurn = {
      role: "agent",
      text: "",
      closed: true,
      tools: [{ id: "1", title: "Bash", kind: "execute", status: "completed", locations: [] }],
      fileChanges: {
        requestId: "r",
        paths: ["/w/gen.ts", "/w/gen.d.ts"],
        complete: true,
        truncated: false,
      },
    };
    expect(fileChangeDiscrepancy(turn)).toEqual({ kind: "extra", declared: 2, inferred: 0 });
  });

  it("surfaces the agent's own uncertainty rather than hiding it", () => {
    const turn: AcpTurn = {
      role: "agent",
      text: "",
      closed: true,
      fileChanges: {
        requestId: "r",
        paths: ["/w/a.ts"],
        complete: false,
        truncated: false,
        uncertainty: "could not verify files created by the build",
      },
    };
    expect(fileChangeDiscrepancy(turn)).toEqual({
      kind: "partial",
      declared: 1,
      uncertainty: "could not verify files created by the build",
    });
  });

  it("distinguishes no report from a report that never arrived", () => {
    expect(fileChangeDiscrepancy({ role: "agent", text: "", closed: true })).toBeNull();
    expect(
      fileChangeDiscrepancy({
        role: "agent",
        text: "",
        closed: true,
        fileChanges: {
          requestId: "r",
          paths: [],
          complete: false,
          truncated: false,
          unavailable: "timeout",
        },
      }),
    ).toEqual({ kind: "missing", reason: "timeout" });
  });
});
