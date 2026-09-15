import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// ─── 닥터 「워처 계측」 행 ({#scheduling-telemetry}) ──────────────────────────
//
// perf-baseline §7 이 "재는 계측이 없다" 고 적어 둔 숫자들이 상태 봉투의
// `watcher_sched` 로 오고, 닥터가 그것을 한 줄로 그린다. 핵심 계약 —
// (a) 여섯 숫자가 전부 문장에 실린다, (b) 처리 누적은 ms 를 초로 줄여 보인다,
// (c) 봉투에 칸이 없으면(구형 백엔드) 행은 「확인 실패」로 남고 나머지는 멀쩡하다.

const fx = {
  status: {} as Record<string, unknown>,
};

function status(over: Record<string, unknown> = {}) {
  return {
    initialized: true,
    config_valid: true,
    lock_state: "healthy",
    current_workday: "20260915",
    watcher_state: "running",
    watcher_dropped_total: 0,
    watcher_user_paused: false,
    ...over,
  };
}

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "oculpmGetStatus":
              return () => ok(fx.status);
            case "settingsGetAll":
              return () => ok([]);
            case "secretHas":
              return () => ok(false);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@/api/automation", () => ({
  automationApi: { overview: () => Promise.reject(new Error("no automation")) },
}));

vi.mock("@/contexts/WorkspaceContext", () => ({
  useOptionalWorkspace: () => ({ state: { currentProjectId: 1, indexingProjectId: null } }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { DoctorSection } from "@/features/settings/tabs/DoctorSection";

function mount() {
  return render(
    <SettingsProvider>
      <DoctorSection />
    </SettingsProvider>,
  );
}

afterEach(cleanup);

describe("닥터 워처 계측 행", () => {
  it("여섯 계수기를 한 줄에 그리고 처리 누적은 초로 줄인다", async () => {
    fx.status = status({
      watcher_sched: {
        started_at: "2026-09-15T00:00:00Z",
        events_total: 590,
        dropped_total: 3,
        queue_depth: 2,
        queue_high_water: 577,
        handle_ms_total: 1234,
        handle_max_ms: 41,
      },
    });
    const { getByText } = mount();
    await waitFor(() => getByText("워처 계측"));
    const row = getByText("워처 계측").closest("li");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("이벤트 590");
    expect(row!.textContent).toContain("버림 3");
    expect(row!.textContent).toContain("큐 2/최대 577");
    expect(row!.textContent).toContain("처리 누적 1.2s");
    expect(row!.textContent).toContain("최대 41ms");
  });

  it("워처가 멈춰 있으면 숫자는 그리되 회색 점이다", async () => {
    fx.status = status({
      watcher_state: "stopped",
      watcher_sched: {
        started_at: null,
        events_total: 0,
        dropped_total: 0,
        queue_depth: 0,
        queue_high_water: 0,
        handle_ms_total: 0,
        handle_max_ms: 0,
      },
    });
    const { getByText } = mount();
    await waitFor(() => getByText("워처 계측"));
    const row = getByText("워처 계측").closest("li")!;
    expect(row.textContent).toContain("이벤트 0");
    expect(row.querySelector("span[aria-hidden]")!.className).toContain("muted-foreground");
  });

  it("봉투에 계측 칸이 없으면 그 행만 「확인 실패」다", async () => {
    fx.status = status(); // watcher_sched 없음 — 구형 백엔드
    const { getByText } = mount();
    await waitFor(() => getByText("워처 계측"));
    const row = getByText("워처 계측").closest("li")!;
    expect(row.textContent).toContain("확인 실패");
    // 이웃 워처 행은 정상이다.
    expect(getByText("워처").closest("li")!.textContent).toContain("감시 중");
  });
});
