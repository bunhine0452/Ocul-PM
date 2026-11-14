// 「Claude 에게 보내기」 대화상자 다듬기 (TS-07) — 받는 곳을 열린 동안 따라가고, 읽기 전엔 보내지 않고,
// 쓰던 말은 맥락마다 남고, 프롬프트 칸은 고치지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  gate: null as Promise<void> | null,
  changed: new Set<() => void>(),
  runs: [] as string[],
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => {
      if (api.gate) await api.gate;
      return api.list;
    },
    write: async () => {},
    onSessionsChanged: (cb: () => void) => {
      api.changed.add(cb);
      return Promise.resolve(() => void api.changed.delete(cb));
    },
  },
}));
vi.mock("@/features/terminal/runPrompt", () => ({
  runPromptInTerminal: async (_p: number, prompt: string) => void api.runs.push(prompt),
}));

import { t } from "@/i18n";
import { SendToClaudeHost, __resetSendDraftsForTests } from "@/features/terminal/SendToClaudeHost";
import { requestSendToClaude, type SendContext } from "@/features/terminal/sendToClaude";
import { __resetSessionNumbersForTests } from "@/features/terminal/status";

function session(id: number, extra: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: "2026-11-14T10:00:00Z",
    alive: true,
    exit_code: null,
    status: { state: "idle", kind: null, msg: null, since: "" },
    busy: true,
    unseen: false,
    ...extra,
  };
}
const plan: SendContext = { kind: "plan", label: "Fix the cache", ref: "cache-plan#ttl" };

beforeEach(() => {
  api.list = [];
  api.gate = null;
  api.runs.length = 0;
  __resetSendDraftsForTests();
  __resetSessionNumbersForTests();
});
afterEach(() => cleanup());

describe("send dialog", () => {
  it("follows the receiver while open — the hint changes when the session starts working", async () => {
    api.list = [session(4)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("4"));
    expect(screen.queryByText(t("send.hint.working"))).toBeNull();
    api.list = [session(4, { status: { state: "working", kind: null, msg: null, since: "" } })];
    await act(async () => {
      for (const cb of api.changed) cb();
    });
    expect(await screen.findByText(t("send.hint.working"))).toBeInTheDocument();
  });

  it("cannot send before the terminal list is read — ⌘↩ no longer opens a new claude session by surprise", async () => {
    let release = () => {};
    api.gate = new Promise<void>((r) => (release = r));
    api.list = [session(4)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    fireEvent.change(box, { target: { value: "shorten the TTL" } });
    const submit = screen.getByRole("button", { name: t("send.submit") });
    expect(submit).toBeDisabled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(api.runs).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("button", { name: t("send.submit") })).not.toBeDisabled());
  });

  it("says when the list could not be read, and sends to a new session", async () => {
    api.gate = Promise.reject(new Error("no ipc"));
    api.gate.catch(() => {});
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    expect(await screen.findByText(t("send.listFailed"))).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("new");
  });

  it("keeps the draft per context across Esc; sending clears it", async () => {
    api.list = [];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    fireEvent.change(box, { target: { value: "long Korean instructions" } });
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 다른 맥락은 빈 칸, 같은 맥락은 쓰던 말.
    act(() => requestSendToClaude({ kind: "file", label: "src/a.ts", ref: "src/a.ts" }));
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    act(() => requestSendToClaude(plan));
    const again = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(again.value).toBe("long Korean instructions");
    await waitFor(() => expect(screen.getByRole("button", { name: t("send.submit") })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: t("send.submit") }));
    await waitFor(() => expect(api.runs).toHaveLength(1));
    act(() => requestSendToClaude(plan));
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("");
  });

  it("the prompt box does not spell-check or autocorrect; ⌘↩ sits inside the send button; the ref is mono", async () => {
    api.list = [session(4), session(9)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    const box = await screen.findByRole("textbox", { name: t("send.placeholder") });
    expect(box).toHaveAttribute("spellcheck", "false");
    expect(box).toHaveAttribute("autocorrect", "off");
    expect(box).toHaveAttribute("autocapitalize", "off");
    const submit = screen.getByRole("button", { name: t("send.submit") });
    expect(submit.querySelector("kbd")?.textContent).toBe("⌘↩");
    expect(document.querySelector(".send-head kbd")).toBeNull();
    expect(document.querySelector(".send-ref.mono")?.textContent).toBe("cache-plan#ttl");
    // 받는 곳은 탭과 같은 번호 — 백엔드 id(4 · 9)가 아니라 창 안에서 연 순서(1 · 2).
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(screen.getAllByRole("option")[1].textContent).toContain(t("send.session", { n: 2, label: "claude", word: t("terminal.state.idle") }));
  });
});
