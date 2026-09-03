import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AcpSession } from "@/lib/bindings";

// 2026-08-20 — "한 프로젝트에 세션을 여러 개 돌릴 수 없다".
//
// 탭은 진작에 여러 개 열렸다. 안 되던 것은 **동시에 굴리는 것**이다: 화면에
// 작업 중 표시가 하나뿐이라 A 가 도는 동안 B 에 친 말이 대기열로 들어갔고,
// 백엔드도 `acp_prompt` 가 "활성 대화" 장부를 보고 보냈다. 그래서 탭을 옮기는
// 순간 수신자가 바뀌었다.
//
// 어댑터는 한 연결에서 세션 둘을 동시에 굴린다(스파이크 4:
// docs/acp-panel/spike/acp_concurrency_spike.py — 두 스트림이 교차했다).
// 여기서 지키는 것은 그 능력을 화면이 실제로 쓰는가다.

const SESSION_A = "sess-a";
const SESSION_B = "sess-b";

/** `acp_prompt` 로 나간 것들 — 어느 대화에 무엇을 보냈나. */
const sent: { provider: "claude" | "codex" | null; sessionId: string | null; text: string }[] = [];
/** 아직 안 끝난 턴들 — 테스트가 원할 때만 닫는다. */
let settle: (() => void)[] = [];

function session(id: string | null): AcpSession {
  return {
    agent: { name: "claude-code", title: "Claude Code", version: "0.73.0", auth_required: false, supports_image: true },
    commands: [],
    session_id: id,
    title: null,
    options: [],
  };
}

vi.mock("@tauri-apps/api/core", () => ({
  // 실물은 Tauri 내부(`__TAURI_INTERNALS__`)에 콜백을 등록한다 — jsdom 에는 없다.
  // 화면이 하는 일은 `onmessage` 를 달아 커맨드에 넘기는 것뿐이라 이걸로 충분하다.
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
  invoke: () => Promise.resolve(),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "acpStart":
              return () => ok(session(SESSION_A));
            case "acpNewSession":
              return () => ok(session(SESSION_B));
            case "acpListSessions":
              return () => ok([]);
            // 설정은 `[키, 값]` 배열을 기대한다 — null 이 가면 provider 가 터진다.
            case "settingsGetAll":
              return () => ok([]);
            case "acpPrompt":
              return (
                _projectId: number,
                provider: "claude" | "codex" | null,
                sessionId: string | null,
                text: string,
              ) => {
                sent.push({ provider, sessionId, text });
                // 턴을 **열어 둔 채** 둔다 — "A 가 도는 동안" 이 이 테스트의 전제다.
                return new Promise((resolve) => {
                  settle.push(() => resolve({ status: "ok" as const, data: "end_turn" }));
                });
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { AcpConversation } from "@/features/chat/AcpConversation";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";

function wrap(node: React.ReactNode) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>
  );
}

/** 입력창에 치고 보낸다. */
async function ask(text: string) {
  const input = await screen.findByLabelText("에이전트 지시 입력");
  fireEvent.change(input, { target: { value: text } });
  // **`보내기` 일 때만 누른다.** 같은 버튼이 대기 중에는 `대기열에 추가` 가 되고,
  // 그때 누르면 메시지가 큐에 들어가 새 채널이 열리지 않는다 — 테스트는 오지 않을
  // 채널을 기다리다 시간초과로 죽는다. 예전 정규식(`/보내기|대기열에 추가/`)은 둘 다
  // 받아 주어서, 세션이 아직 뜨는 중인 느린 순간에만 **다른 코드 경로**를 눌렀다.
  // (2026-08-28: 병렬 실행 부하에서만 재현되던 flake 의 정체.)
  fireEvent.click(await screen.findByLabelText("보내기"));
}

/**
 * 입력창에 치고 **대기열에 넣는다** — 턴이 도는 중이라 같은 버튼이
 * `대기열에 추가` 인 상태를 의도적으로 겨냥한다. `ask` 와 갈라 둔 이유는
 * 위 주석과 같다: 어느 쪽이 눌렸는지 테스트가 스스로 못 박아야 한다.
 */
async function askQueued(text: string) {
  const input = await screen.findByLabelText("에이전트 지시 입력");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(await screen.findByLabelText("대기열에 추가"));
}

beforeEach(() => {
  sent.length = 0;
  settle = [];
});
afterEach(cleanup);

describe("한 프로젝트의 대화 여러 개", () => {
  it("A 가 도는 중에 연 새 대화는 **곧장** 나간다 (대기열이 아니다)", async () => {
    const { container } = render(wrap(<AcpConversation projectId={1} />));

    await ask("첫 질문");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ provider: "claude", sessionId: SESSION_A, text: "첫 질문" });

    // A 의 턴은 아직 안 끝났다 — 그 상태로 새 대화를 연다.
    fireEvent.click(container.querySelector(".acp-panel-new") as HTMLElement);

    // 새 대화의 컴포저는 잠겨 있지 않아야 한다. 예전에는 화면에 하나뿐인
    // 작업 중 표시 때문에 여기가 "대기열에 추가" 였다.
    await waitFor(() =>
      expect(screen.getByLabelText("보내기")).toBeTruthy(),
    );

    await ask("둘째 질문");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ provider: "claude", sessionId: SESSION_B, text: "둘째 질문" });
  });

  it("같은 대화에 연달아 치면 예전처럼 줄을 선다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    await ask("첫 질문");
    await waitFor(() => expect(sent).toHaveLength(1));

    // 같은 대화가 도는 중 — 두 번째 문장은 대기열로 가야 한다.
    await askQueued("둘째 질문");
    expect(sent).toHaveLength(1);

    // 턴이 끝나면 그제서야 나간다.
    settle[0]();
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ provider: "claude", sessionId: SESSION_A, text: "둘째 질문" });
  });

  it("Codex 화면은 같은 ACP 흐름을 codex provider로 보낸다", async () => {
    render(wrap(<AcpConversation projectId={1} provider="codex" />));
    await ask("Codex 질문");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ provider: "codex", sessionId: SESSION_A, text: "Codex 질문" });
  });
});
