// 「Claude 에게 보내기」 (ocul-next #send-to-claude) — 맥락을 붙여 도는 claude 세션에 넣거나 새로 연다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const api = vi.hoisted(() => ({
  list: [] as TermInfo[],
  writes: [] as Array<[number, string]>,
  runs: [] as string[],
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => api.list,
    write: async (id: number, data: string) => void api.writes.push([id, data]),
  },
}));
vi.mock("@/features/terminal/runPrompt", () => ({
  runPromptInTerminal: async (_p: number, prompt: string) => void api.runs.push(prompt),
}));

import { SendToClaudeHost } from "@/features/terminal/SendToClaudeHost";
import { composeMessage, receiversOf, requestSendToClaude, type SendContext } from "@/features/terminal/sendToClaude";
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
});
