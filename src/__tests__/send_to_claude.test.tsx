// 「Claude 에게 보내기」 (ocul-next #send-to-claude) — 맥락을 붙여 도는 claude 세션에 넣거나 새로 연다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  writes: [] as Array<[number, string]>,
  runs: [] as string[],
  changed: new Set<() => void>(),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => api.list,
    write: async (id: number, data: string) => void api.writes.push([id, data]),
    onSessionsChanged: (cb: () => void) => {
      api.changed.add(cb);
      return Promise.resolve(() => void api.changed.delete(cb));
    },
  },
}));
vi.mock("@/features/terminal/runPrompt", () => ({
  runPromptInTerminal: async (_p: number, prompt: string) => void api.runs.push(prompt),
}));

import { SendToClaudeHost } from "@/features/terminal/SendToClaudeHost";
import {
  cancelQueued,
  composeMessage,
  enqueue,
  flushQueue,
  queuedStore,
  readinessOf,
  receiversOf,
  requestSendToClaude,
  type SendContext,
} from "@/features/terminal/sendToClaude";
import { t } from "@/i18n";

function session(id: number, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: "2026-10-29T10:00:00Z",
    alive: true,
    exit_code: null,
    status: { state: "idle", kind: null, msg: null, since: "" },
    busy: true,
    unseen: false,
    ...extra,
  };
}

const journal: SendContext = {
  kind: "journal",
  label: "E2E 소스 파서",
  ref: ".oculpm/journal/20261029/Bugs/0900_bug_x.md",
  note: "검증 없음",
};

beforeEach(() => {
  api.list = [];
  api.writes.length = 0;
  api.runs.length = 0;
  for (const q of queuedStore.get()) cancelQueued(q.key);
});
afterEach(() => cleanup());

describe("보낼 글과 받는 곳", () => {
  it("맥락 한 줄 · 빈 줄 · 사람이 쓴 말", () => {
    const msg = composeMessage(t, journal, "  pnpm test 를 돌려 검증에 적어 줘 ");
    expect(msg).toBe(
      `${t("send.msg.journal", { ref: journal.ref, label: journal.label })} (검증 없음)\n\npnpm test 를 돌려 검증에 적어 줘`,
    );
  });

  it("받는 곳은 셸 위에서 claude 가 도는 세션만 — 빈 셸 · 끝난 세션 · 다른 프로그램은 아니다", () => {
    const got = receiversOf([
      session(1),
      session(2, { busy: false }),
      session(3, { alive: false }),
      session(4, { label: "zsh", status: null }),
      session(5, { status: null }),
    ]);
    expect(got.map((s) => s.id)).toEqual([1, 5]);
  });
});

describe("보내기 대화상자", () => {
  it("도는 세션이 있으면 그 세션에 붙여넣기로 넣고 Enter — ⌘↩ 로도 보낸다", async () => {
    api.list = [session(4, { status: { state: "working", kind: null, msg: null, since: "" } }), session(7)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(journal));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    // 쉬는 세션(7)이 먼저 골라진다.
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    fireEvent.change(box, { target: { value: "검증을 적어 줘" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(api.writes).toHaveLength(2));
    const [[id, pasted], [, enter]] = api.writes;
    expect(id).toBe(7);
    expect(pasted.startsWith("\x1b[200~") && pasted.endsWith("\x1b[201~")).toBe(true);
    expect(pasted).toContain(journal.ref);
    expect(enter).toBe("\r");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t("send.title") })).toBeNull());
  });

  it("도는 세션이 없으면 새 claude 세션을 그 글로 연다 — 빈 글은 못 보낸다", async () => {
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude({ kind: "file", label: "src/a.ts", ref: "src/a.ts" }));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    const submit = screen.getByRole("button", { name: t("send.submit") });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("title", t("send.needsText"));
    fireEvent.change(box, { target: { value: "이 파일을 설명해 줘" } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.runs).toHaveLength(1));
    expect(api.runs[0]).toContain("src/a.ts");
    expect(api.writes).toHaveLength(0);
  });

  it("변경 메모는 할 말 칸이 미리 차 있고, 보내면 onSent 로 비운다", async () => {
    api.list = [session(7)];
    const onSent = vi.fn();
    render(<SendToClaudeHost projectId={1} />);
    act(() =>
      requestSendToClaude({ kind: "notes", label: "메모 1개", ref: "", prefill: "src/a.ts\n- 11행 `x` — 고쳐", onSent }),
    );
    const box = (await screen.findByRole("textbox", { name: t("send.placeholder") })) as HTMLTextAreaElement;
    expect(box.value).toBe("src/a.ts\n- 11행 `x` — 고쳐");
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(api.writes[0][1]).toContain(t("send.msg.notes", { label: "메모 1개", ref: "" }));
  });
});

const working = { state: "working", kind: null, msg: null, since: "" };
const asking = { state: "blocked", kind: "permission", msg: "Bash", since: "" };

describe("보낼 말 줄 세우기", () => {
  it("일하는 중 · 묻는 중은 기다리고, 상태를 안 알리는 옛 claude 는 바로 넣는다", () => {
    expect(readinessOf(working)).toBe("working");
    expect(readinessOf(asking)).toBe("blocked");
    for (const state of ["idle", "done", "error"]) expect(readinessOf({ ...working, state })).toBe("ready");
    expect(readinessOf(null)).toBe("ready");
  });

  it("손을 놓은 세션에 그 세션 몫을 한 번에 넣고, 끝난 세션 몫은 버린다 — 두 번 불려도 한 번만 간다", async () => {
    const got: Array<[number, string]> = [];
    const deliver = async (id: number, m: string) => void got.push([id, m]);
    const onA = vi.fn();
    enqueue(4, "가", onA);
    enqueue(4, "나");
    enqueue(9, "다");
    const stillWorking = await flushQueue([session(4, { status: working }), session(9, { status: working })], deliver);
    expect(stillWorking.delivered).toHaveLength(0);
    expect(queuedStore.get()).toHaveLength(3);

    const list = [session(4), session(9, { alive: false })];
    const [first, second] = await Promise.all([flushQueue(list, deliver), flushQueue(list, deliver)]);
    expect(got).toEqual([[4, "가\n\n나"]]);
    expect(first.delivered.map((q) => q.message)).toEqual(["가", "나"]);
    expect(first.dropped.map((q) => q.message)).toEqual(["다"]);
    expect(second.delivered).toHaveLength(0);
    expect(onA).toHaveBeenCalledTimes(1);
    expect(queuedStore.get()).toHaveLength(0);
  });

  it("일하는 세션에 보내면 줄에 서고, 손을 놓는 사건에 넣는다", async () => {
    api.list = [session(4, { status: working })];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(journal));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    await screen.findByText(t("send.hint.working"));
    fireEvent.change(box, { target: { value: "검증을 적어 줘" } });
    fireEvent.click(screen.getByRole("button", { name: t("send.submitQueue") }));
    await waitFor(() => expect(queuedStore.get()).toHaveLength(1));
    expect(api.writes).toHaveLength(0);

    api.list = [session(4)];
    await act(async () => {
      for (const cb of api.changed) cb();
    });
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[0][1]).toContain("검증을 적어 줘");
    expect(api.writes[1][1]).toBe("\r");
    expect(queuedStore.get()).toHaveLength(0);
  });

  it("「지금 끼워 넣기」는 일하는 중이면 바로 넣는다", async () => {
    api.list = [session(4, { status: working })];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(journal));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    fireEvent.change(box, { target: { value: "멈추고 이것부터" } });
    fireEvent.click(await screen.findByRole("button", { name: t("send.now") }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(queuedStore.get()).toHaveLength(0);
  });

  it("대화상자를 연 뒤 권한 질문이 떴으면 ⇧⌘↩ 이어도 넣지 않는다 — Enter 가 선택지를 누른다", async () => {
    api.list = [session(4)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(journal));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("4"));
    api.list = [session(4, { status: asking })];
    fireEvent.change(box, { target: { value: "이것도" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true, shiftKey: true });
    await waitFor(() => expect(queuedStore.get()).toHaveLength(1));
    expect(api.writes).toHaveLength(0);
  });
});
