import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import type { AcpSession } from "@/lib/bindings";

// 2026-09-02 — **가만히 있을 때 얼마나 나가는가**.
//
// Claude Code 화면은 가만히 두어도 백엔드를 두들기고 있었다. 되읽기 효과가
// `session` 객체를 의존성으로 잡은 채 그 안에서 새 객체로 상태를 갈아 끼워,
// 효과가 스스로를 다시 부르는 고리가 생겼다. 800ms 동안 `acp_status`·
// `acp_options`·`acp_session_title`·`acp_list_sessions` 가 **각각 2,979번**
// 나갔다 — 마지막 것은 어댑터로 나가는 진짜 JSON-RPC 왕복이라 Claude Code
// 프로세스까지 함께 두들겼다.
//
// 화면에는 아무 일도 안 일어나므로 눈으로는 안 보인다. 그래서 세어 본다.

const calls: Record<string, number> = {};

function session(id: string | null): AcpSession {
  return {
    agent: { name: "claude-code", title: "Claude Code", version: "0.73.0", auth_required: false },
    commands: [],
    session_id: id,
    title: null,
    options: [
      {
        id: "model",
        name: "Model",
        category: "model",
        current: "opus",
        choices: [{ value: "opus", name: "Opus", description: null }],
        is_boolean: false,
      },
    ],
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
        get: (_t, prop: string) => () => {
          calls[prop] = (calls[prop] ?? 0) + 1;
          switch (prop) {
            case "acpStart":
              return ok(session("sess-a"));
            // 어댑터는 살아 있다고 답한다 — 죽은 척하면 배너 경로로 새어 나가
            // 정작 재보려는 되읽기 고리를 못 본다.
            case "acpStatus":
              return ok(session("sess-a").agent);
            // **매번 새 배열**을 준다. 실제 IPC 가 그렇고, 고리의 씨앗이 이것이다.
            case "acpOptions":
              return ok(session("sess-a").options);
            case "acpListSessions":
              return ok([]);
            case "settingsGetAll":
              return ok([]);
            default:
              return ok(null);
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

/**
 * jsdom 의 `getClientRects()` 는 언제나 비어 있다 — 화면은 자기가 안 보인다고
 * 믿고 되읽기를 통째로 건너뛴다. 보이는 척해야 이 테스트가 볼 것을 본다.
 */
const realClientRects = Element.prototype.getClientRects;
beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  Element.prototype.getClientRects = () =>
    [{ width: 800, height: 600 }] as unknown as DOMRectList;
});
afterEach(() => {
  Element.prototype.getClientRects = realClientRects;
  cleanup();
});

describe("the Claude Code screen while idle", () => {
  it("re-reads once on attach and never re-triggers itself", async () => {
    render(
      <SettingsProvider>
        <WorkspaceProvider projectId={1}>
          <AcpConversation projectId={1} />
        </WorkspaceProvider>
      </SettingsProvider>,
    );

    await waitFor(() => expect(calls.acpOptions ?? 0).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 여유를 넉넉히 둔다 — StrictMode 이중 마운트·깨어남 신호로 몇 번은 더
    // 나갈 수 있다. 잡으려는 것은 "몇 번 더"가 아니라 **끝없이**다.
    expect(calls.acpStatus ?? 0).toBeLessThan(10);
    expect(calls.acpOptions ?? 0).toBeLessThan(10);
    expect(calls.acpSessionTitle ?? 0).toBeLessThan(10);
    // 이건 어댑터로 나가는 진짜 왕복이라 특히 아껴야 한다.
    expect(calls.acpListSessions ?? 0).toBeLessThan(10);
  });
});
