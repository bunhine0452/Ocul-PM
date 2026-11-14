// 한 세션은 어디서나 같은 이름 · 번호 (11-15 합류 G-04).
//
//  - 「Claude 에게 보내기」 의 토스트 「터미널 n」 은 탭 앞 숫자다 — 받는 곳 목록의 순번(셸 칸은 받는 곳이 아니라
//    빠진다)을 부르던 `sendOrRun` 은 부르는 곳이 없어 걷었다.
//  - OS 알림의 제목은 탭과 같은 이름(`sessionName`)이다 — 탭이 「시도 2」 라 부르는 레인 세션을 알림은 대화 주제로,
//    제목 없는 Codex 칸을 셸 이름으로 불렀다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TermInfo } from "@/api/terminal";

const fx = vi.hoisted(() => ({
  list: [] as TermInfo[],
  notes: [] as Array<{ title: string; body: string }>,
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => fx.list,
    write: async () => {},
    onSessionsChanged: () => Promise.resolve(() => {}),
  },
}));
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));
vi.mock("@/features/terminal/race", () => ({ laneNumberOf: (id: number) => (id === 22 ? 2 : null), useRace: () => {} }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification: (n: { title: string; body: string }) => void fx.notes.push(n),
}));

import { alertIfWaiting, setAlertProjectName } from "@/features/terminal/attention";
import { SendToClaudeHost } from "@/features/terminal/SendToClaudeHost";
import { requestSendToClaude } from "@/features/terminal/sendToClaude";
import { __resetSessionNumbersForTests, sessionName } from "@/features/terminal/status";
import { t } from "@/i18n";
import { getToasts } from "@/lib/toast";

const IDLE = { state: "idle", kind: null, msg: null, since: "2026-11-15T09:00:00Z" };
const BLOCKED = { state: "blocked", kind: "permission", msg: "approve Write: a.ts", since: "2026-11-15T09:05:00Z" };

function session(id: number, over: Partial<TermInfo> = {}): TermInfo {
  return { id, project_id: 1, label: "claude", started_at: "", alive: true, exit_code: null, status: IDLE, busy: true, unseen: false, ...over };
}

beforeEach(() => {
  __resetSessionNumbersForTests();
  fx.list = [];
  fx.notes = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("send toast — the tab's number", () => {
  it("three sessions, the second receives: the toast says 2, not its place among the receivers", async () => {
    fx.list = [
      session(11, { label: "zsh", status: null, busy: false }), // 빈 셸 — 받는 곳이 아니다
      session(12), // 쉬는 claude — 기본 받는 곳, 탭 2
      session(13, { status: { ...IDLE, state: "working" } }),
    ];
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude({ kind: "notes", label: "memo", ref: "src/a.ts", prefill: "look at this" }));
    const send = await screen.findByRole("button", { name: t("send.submit") });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(getToasts().some((x) => x.message === t("send.sent", { n: 2 }))).toBe(true));
    expect(getToasts().some((x) => x.message === t("send.sent", { n: 1 }))).toBe(false);
  });
});

describe("OS notification — the tab's name in the title", () => {
  beforeEach(() => {
    setAlertProjectName("ai-pm");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  it.each([
    ["a lane session goes by the band's name (race.lane), not its conversation title", session(22, { title: "Fix login" } as Partial<TermInfo>)],
    ["an untitled Codex pane is codex, not the shell's name", session(23, { label: "zsh", status: { ...IDLE, app: "codex" } as TermInfo["status"] })],
    ["a titled session keeps its conversation title", session(24, { title: "Refactor cache" } as Partial<TermInfo>)],
  ])("%s", async (_name, info) => {
    const waiting = { ...info, status: { ...BLOCKED, app: (info.status as { app?: string } | null)?.app } as TermInfo["status"] };
    alertIfWaiting(info.status, waiting);
    await waitFor(() => expect(fx.notes).toHaveLength(1));
    expect(fx.notes[0].title).toBe(`ai-pm · ${sessionName(t, waiting)}`);
    expect(fx.notes[0].body).toContain("approve Write: a.ts");
  });

  it("calls the lane session by the band's name", async () => {
    const info = session(22, { title: "Fix login", status: BLOCKED } as Partial<TermInfo>);
    alertIfWaiting(IDLE, info);
    await waitFor(() => expect(fx.notes).toHaveLength(1));
    expect(fx.notes[0].title).toBe(`ai-pm · ${t("race.lane", { n: 2 })}`);
  });
});
