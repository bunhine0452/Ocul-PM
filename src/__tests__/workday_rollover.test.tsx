import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import type { OculpmStatus } from "@/lib/bindings";

// 자정 롤오버 — 앱을 계속 켜 둔 채 workday 경계를 넘기면 메인 창의 "오늘"
// 상태(workdayKey)가 재시작 없이 새 날짜로 넘어가야 한다. WorkspaceContext 의
// 롤오버 워처가 백엔드 status 를 다시 조회해 current_workday 가 실제로 바뀌면
// 커밋한다. 이 계약이 깨지면(다시 프로젝트 오픈 때만 조회하면) 여기서 잡힌다.

// 백엔드가 돌려줄 workday — 테스트가 도중에 바꿔 자정 넘김을 흉내낸다.
let backendWorkday = "20260721";
const getStatus = vi.fn(async (_pid: number): Promise<OculpmStatus> => ({
  initialized: true,
  config_valid: true,
  lock_state: { held_by_us: true } as unknown as OculpmStatus["lock_state"],
  current_workday: backendWorkday,
  watcher_state: "running" as unknown as OculpmStatus["watcher_state"],
}));

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: { getStatus: (pid: number) => getStatus(pid) },
}));

// 임포트는 mock 선언 뒤에.
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";

const statusFor = (workday: string): OculpmStatus =>
  ({
    initialized: true,
    config_valid: true,
    lock_state: { held_by_us: true },
    current_workday: workday,
    watcher_state: "running",
  }) as unknown as OculpmStatus;

let ctx: ReturnType<typeof useWorkspace> | null = null;
let renderCount = 0;
function Harness() {
  ctx = useWorkspace();
  renderCount += 1;
  return <div data-testid="wk">{String(ctx.state.workdayKey)}</div>;
}

beforeEach(() => {
  // 이전 테스트가 persist 한 프로젝트 선택이 새 마운트로 새지 않도록 초기화.
  localStorage.clear();
  backendWorkday = "20260721";
  renderCount = 0;
  getStatus.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  ctx = null;
});

describe("WorkspaceContext — 자정 workday 롤오버", () => {
  it("경계를 넘기면 workdayKey 가 새 날짜로 갱신된다", async () => {
    const { getByTestId } = render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>,
    );

    // 프로젝트 오픈 + 초기 status (오늘 = 07-21).
    act(() => {
      ctx!.setProject(1, "P", "/p");
      ctx!.setOculpmStatus(statusFor("20260721"));
    });
    expect(getByTestId("wk").textContent).toBe("20260721");

    // 자정 넘김: 다음 status 조회는 07-22 를 돌려준다.
    backendWorkday = "20260722";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(getByTestId("wk").textContent).toBe("20260722");
    expect(getStatus).toHaveBeenCalled();
  });

  it("같은 날 안에서는 상태를 다시 커밋하지 않는다", async () => {
    const { getByTestId } = render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>,
    );
    act(() => {
      ctx!.setProject(1, "P", "/p");
      ctx!.setOculpmStatus(statusFor("20260721"));
    });
    const rendersAfterSetup = renderCount;

    // workday 는 그대로 — 여러 tick 을 돌려도 커밋(=리렌더)이 없어야 한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });

    expect(getStatus).toHaveBeenCalled(); // tick 은 돌았다 (조회는 함)
    expect(renderCount).toBe(rendersAfterSetup); // 그러나 상태 커밋/리렌더는 없다
    expect(getByTestId("wk").textContent).toBe("20260721");
  });

  it("프로젝트가 없으면 status 를 조회하지 않는다", async () => {
    render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>,
    );
    // setProject 를 호출하지 않음 — currentProjectId 는 null.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getStatus).not.toHaveBeenCalled();
  });
});
