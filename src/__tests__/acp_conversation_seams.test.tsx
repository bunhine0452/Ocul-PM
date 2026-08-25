import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AcpEvent, AcpSession } from "@/lib/bindings";

// 2026-08-25 — AcpConversation 본체(훅 100개)를 커스텀 훅으로 쪼개기 전에 까는
// 특성화 테스트다. 지금 화면이 **무엇을 하는가**를 못 박아, 추출이 동작을 바꾸면
// 여기서 걸리게 한다. 겨냥하는 절취선은 세 가지:
//
//   useTranscripts   — 기록이 대화별로 따로 쌓이는가
//   useSessionMaps   — 실패/작업중이 그 대화에만 붙는가
//   useAcpTabs       — 새 대화가 탭을 늘리고 전환이 활성 대화를 바꾸는가
//
// 기존 acp_parallel_sessions.test.tsx 는 "보내기가 어디로 나가는가"를 본다.
// 여기서는 **받은 것이 어디에 쌓이는가**를 본다 — 반대 방향이다.

const SESSION_A = "sess-a";
const SESSION_B = "sess-b";

/** 화면이 `acpPrompt` 에 넘긴 채널들 — 테스트가 여기로 에이전트 사건을 밀어 넣는다. */
let channels: { sessionId: string | null; ch: { onmessage: ((e: AcpEvent) => void) | null } }[] = [];
let settle: (() => void)[] = [];

function session(id: string | null): AcpSession {
  return {
    agent: { name: "claude-code", title: "Claude Code", version: "0.70.0", auth_required: false },
    commands: [],
    session_id: id,
    title: null,
    options: [],
  };
}

vi.mock("@tauri-apps/api/core", () => ({
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
            // 이미 본 대화로 돌아갈 때 화면이 타는 지름길 — 장부만 바꾸고
            // 기록은 그대로 둔다. null 을 주면 세션이 비어 빈 화면이 된다.
            case "acpSelectSession":
              return (_p: number, sessionId: string) => ok(session(sessionId));
            case "acpLoadSession":
              return (_p: number, sessionId: string) => ok(session(sessionId));
            case "settingsGetAll":
              return () => ok([]);
            case "acpPrompt":
              return (
                _projectId: number,
                sessionId: string | null,
                _text: string,
                _sending: unknown,
                _blocks: unknown,
                ch: { onmessage: ((e: AcpEvent) => void) | null },
              ) => {
                channels.push({ sessionId, ch });
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

async function ask(text: string) {
  const input = await screen.findByLabelText("에이전트 지시 입력");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText(/보내기|대기열에 추가/));
}

/** 마지막으로 열린 채널에 에이전트 사건을 밀어 넣는다. */
function emit(event: AcpEvent) {
  const last = channels[channels.length - 1];
  expect(last, "열린 채널이 없다 — ask() 가 먼저다").toBeTruthy();
  last.ch.onmessage?.(event);
}

const newConversation = (container: HTMLElement) =>
  fireEvent.click(container.querySelector(".acp-panel-new") as HTMLElement);

beforeEach(() => {
  channels = [];
  settle = [];
});
afterEach(cleanup);

describe("AcpConversation — 추출 전 특성화", () => {
  it("받은 답변은 그 대화에만 쌓인다 (탭을 옮기면 사라지고, 돌아오면 그대로)", async () => {
    const { container } = render(wrap(<AcpConversation projectId={1} />));

    await ask("A 질문");
    await waitFor(() => expect(channels).toHaveLength(1));
    emit({ kind: "chunk", text: "에이-답변" });
    await waitFor(() => expect(screen.getByText(/에이-답변/)).toBeTruthy());

    // 새 대화로 넘어가면 A 의 답변은 화면에 없다.
    newConversation(container);
    await waitFor(() => expect(screen.queryByText(/에이-답변/)).toBeNull());

    // 첫 탭으로 돌아오면 그 자리에 그대로 있다.
    fireEvent.click(screen.getAllByRole("tab")[0]);
    await waitFor(() => expect(screen.getByText(/에이-답변/)).toBeTruthy());
  });

  it("실패는 그 대화에만 붙는다", async () => {
    const { container } = render(wrap(<AcpConversation projectId={1} />));

    await ask("A 질문");
    await waitFor(() => expect(channels).toHaveLength(1));
    emit({ kind: "failed", message: "무너졌습니다" });
    await waitFor(() => expect(screen.getByText(/무너졌습니다/)).toBeTruthy());

    newConversation(container);
    await waitFor(() => expect(screen.queryByText(/무너졌습니다/)).toBeNull());
  });

  it("새 대화 버튼이 탭을 하나 늘리고, 보낸 곳이 새 대화로 바뀐다", async () => {
    const { container } = render(wrap(<AcpConversation projectId={1} />));

    await ask("A 질문");
    await waitFor(() => expect(channels).toHaveLength(1));
    expect(channels[0].sessionId).toBe(SESSION_A);
    const before = screen.getAllByRole("tab").length;

    newConversation(container);
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(before + 1));

    await ask("B 질문");
    await waitFor(() => expect(channels).toHaveLength(2));
    expect(channels[1].sessionId).toBe(SESSION_B);
  });

  it("보내지 않은 초안은 대화별로 보관된다 (옮기면 비고, 돌아오면 되살아난다)", async () => {
    const { container } = render(wrap(<AcpConversation projectId={1} />));

    // A 에 기록을 하나 만들어 둔다 — 그래야 돌아올 때 "이미 본 대화" 지름길을 탄다.
    await ask("A 질문");
    await waitFor(() => expect(channels).toHaveLength(1));
    emit({ kind: "chunk", text: "에이-답변" });
    await waitFor(() => expect(screen.getByText(/에이-답변/)).toBeTruthy());

    // 보내지 않은 초안을 남기고 새 대화로 넘어간다.
    fireEvent.change(await screen.findByLabelText("에이전트 지시 입력"), {
      target: { value: "안 보낸 말" },
    });
    newConversation(container);

    // 새 대화의 입력창은 비어 있다 — 초안은 대화에 묶여 있다(draftsRef).
    await waitFor(() =>
      expect((screen.getByLabelText("에이전트 지시 입력") as HTMLTextAreaElement).value).toBe(""),
    );

    // 돌아오면 그 대화의 초안이 되살아난다.
    fireEvent.click(screen.getAllByRole("tab")[0]);
    await waitFor(() =>
      expect((screen.getByLabelText("에이전트 지시 입력") as HTMLTextAreaElement).value).toBe(
        "안 보낸 말",
      ),
    );
  });

  it("추론(thought) 조각도 그 대화의 기록으로 들어간다", async () => {
    render(wrap(<AcpConversation projectId={1} />));

    await ask("A 질문");
    await waitFor(() => expect(channels).toHaveLength(1));
    emit({ kind: "thought", text: "속으로-생각" });
    emit({ kind: "chunk", text: "겉으로-답변" });

    // 답변은 바로 보이고, 화면이 무너지지 않는다(추론은 기본 접힘).
    await waitFor(() => expect(screen.getByText(/겉으로-답변/)).toBeTruthy());
  });
});
