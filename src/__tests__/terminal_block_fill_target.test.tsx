/**
 * 명령 블록 「채우기」가 **누른 페인**이 아니라 포커스된 페인에 쓰던 것 (2026-10-18).
 *
 * 거터 캡슐은 mousedown 을 삼킨다(캔버스로 흘러가면 선택이 시작된다) — 그래서
 * 분할된 옆 페인의 캡슐을 눌러도 포커스는 옮겨 가지 않는다. 그런데 「채우기」는
 * 「활성 탭의 포커스 페인」에 썼다: B 의 명령을 골랐는데 A 의 프롬프트에 채워졌다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const writes: Array<{ sid: string; data: string }> = [];

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "writeToPty")
            return (sid: string, data: string) => {
              writes.push({ sid, data });
              return ok(null);
            };
          if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
          if (prop === "listProjects") return () => ok([]);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// xterm 은 jsdom 에서 뜨지 않는다 — 페인마다 받은 props 만 붙들어 둔다.
type PaneProps = { sessionId: string; onBlockActivate?: (a: unknown) => void };
const panes = new Map<string, PaneProps>();
vi.mock("@/features/terminal/TerminalInstance", () => ({
  TerminalInstance: (props: PaneProps) => {
    panes.set(props.sessionId, props);
    return <div data-testid="pane" data-sid={props.sessionId} />;
  },
}));

import { TerminalSurface } from "@/features/terminal/TerminalSurface";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

afterEach(() => {
  cleanup();
  panes.clear();
  writes.length = 0;
});

describe("block menu fill", () => {
  it("fills the pane whose capsule was clicked, not the focused one", async () => {
    const { container } = render(
      <SettingsProvider>
        <WorkspaceProvider projectId={5301}>
          <TerminalSurface projectRoot="/tmp" />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-testid="pane"]').length).toBe(1));
    const first = container.querySelector('[data-testid="pane"]')!.getAttribute("data-sid")!;

    // 나누면 새 페인이 포커스를 갖는다 — 원래 페인은 이제 옆 페인이다.
    fireEvent.click(screen.getByLabelText(t("term.splitRow")));
    await waitFor(() => expect(container.querySelectorAll('[data-testid="pane"]').length).toBe(2));

    act(() => {
      panes.get(first)!.onBlockActivate!({
        block: { id: 1, line: 0, command: "pnpm test", startedAt: 0, exitCode: 1 },
        rect: { top: 0, left: 0, bottom: 0, right: 0 },
        output: "",
      });
    });
    fireEvent.click(await screen.findByText(t("term.block.fill")));

    await waitFor(() => expect(writes).toEqual([{ sid: first, data: "pnpm test" }]));
  });
});
