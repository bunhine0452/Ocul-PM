// 「Claude 에게 보내기」 를 다시 열 때 (TS-07 회귀) — 받는 곳 기본값은 **이번에 연 뒤 읽은** 목록으로 정한다.
// 닫혀 있는 동안 목록은 따라가지 않아 낡는다: 첫 보내기가 새 claude 세션을 열고 두 번째로 열면, 쉬는 그 세션
// 대신 지난번의 「새 세션」 이 기본이라 ⌘↩ 가 같은 폴더에 claude 를 하나 더 띄웠다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  fail: false,
  changed: new Set<() => void>(),
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => {
      if (api.fail) throw new Error("no ipc");
      return api.list;
    },
    write: async () => {},
    onSessionsChanged: (cb: () => void) => {
      api.changed.add(cb);
      return Promise.resolve(() => void api.changed.delete(cb));
    },
  },
}));
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { t } from "@/i18n";
import { SendToClaudeHost, __resetSendDraftsForTests } from "@/features/terminal/SendToClaudeHost";
import { requestSendToClaude, type SendContext } from "@/features/terminal/sendToClaude";
import { __resetSessionNumbersForTests } from "@/features/terminal/status";

function session(id: number): TermInfo {
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
  };
}
const plan: SendContext = { kind: "plan", label: "Fix the cache", ref: "cache-plan#ttl" };
const receiver = () => (screen.getByRole("combobox") as HTMLSelectElement).value;
// 세션 사건 — 다시 읽기는 `REFETCH_COALESCE_MS`(150ms) 모아서 한 번.
const sessionsChanged = () =>
  act(async () => {
    for (const cb of api.changed) cb();
    await new Promise((r) => setTimeout(r, 200));
  });

beforeEach(() => {
  api.list = [];
  api.fail = false;
  __resetSendDraftsForTests();
  __resetSessionNumbersForTests();
});
afterEach(() => cleanup());

describe("send dialog opened again", () => {
  it("first open has no claude session (new); reopened after one started, it defaults to that idle session", async () => {
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    await waitFor(() => expect(receiver()).toBe("new"));
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 닫혀 있는 동안 claude 세션이 떴다(첫 보내기가 연 것) — 대화상자는 그 사건을 받지 않는다.
    api.list = [session(4)];
    act(() => requestSendToClaude(plan));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(receiver()).toBe("4");
  });

  it("when a re-read fails it sends to a new session, as the hint says; the next good read brings the session back", async () => {
    api.list = [session(4)];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude(plan));
    await waitFor(() => expect(receiver()).toBe("4"));
    api.fail = true;
    await sessionsChanged();
    expect(screen.getByText(t("send.listFailed"))).toBeInTheDocument();
    expect(receiver()).toBe("new");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    api.fail = false;
    await sessionsChanged();
    await waitFor(() => expect(receiver()).toBe("4"));
  });
});
