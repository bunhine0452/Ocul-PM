import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── 미룬 지름길(defer) 원장 카드 — EvalTrend 결 자기은닉 렌더 스모크 ────────
//
// 파싱·정렬·상한은 rust 쪽(defer_ledger.rs) 단위 테스트가 고정한다. 여기는
// 프론트 계약만 본다: 마커 0건이면 카드 자체를 그리지 않고, 행 클릭은 일반
// 파일용 openInEditor 로 file:line 을 연다 (일지 전용 경로 아님).

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

// ceiling 이 title 로도 노출되는지 (긴 텍스트 truncate 대비 hover 전체보기).
const CEILING_SAMPLE = "전역 락이라 동시 1건";

const fx = {
  signals: null as Dict | null,
  calls: {
    open: [] as unknown[][],
  },
};

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ state: { currentProjectRoot: "/proj" } }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { externalEditorCommand: "code --goto %path" } }),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "deferSignals":
              return () => ok(fx.signals);
            case "openInEditor":
              return (...a: unknown[]) => {
                fx.calls.open.push(a);
                return ok(null);
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

import { DeferLedgerPanel } from "@/features/retro/DeferLedger";

beforeEach(() => {
  fx.signals = {
    markers: [
      {
        path: "src/a.rs",
        line: 12,
        ceiling: "전역 락이라 동시 1건",
        trigger: null,
        no_trigger: true,
      },
      {
        path: "src/b.ts",
        line: 3,
        ceiling: "캐시 무효화 없음",
        trigger: "TTL 도입되면",
        no_trigger: false,
      },
    ],
    files_scanned: 42,
    truncated: true,
  };
  fx.calls.open = [];
});

afterEach(() => {
  cleanup();
});

describe("DeferLedgerPanel", () => {
  it("마커를 그리고, 트리거 없음 배지·상한 각주·file:line 열기 계약 + axe", async () => {
    const { container, findByText, getByText, getByRole, getByTitle } = render(
      <DeferLedgerPanel projectId={1} />,
    );
    await findByText("미룬 지름길");

    // no_trigger → 앰버 배지 (썩음 경고 title 포함).
    const badge = getByText("트리거 없음").closest("span");
    expect(badge?.getAttribute("title")).toMatch(/조용히 썩습니다/);
    // 트리거 있는 행은 트리거 텍스트를 그대로.
    expect(getByText("TTL 도입되면")).toBeTruthy();
    // truncated → 침묵 절단 금지 각주.
    expect(getByText(/상한 도달/)).toBeTruthy();
    expect(getByTitle(CEILING_SAMPLE)).toBeTruthy();

    // 행 클릭 → 일반 파일용 openInEditor(root, relPath, editorCmd, line).
    fireEvent.click(getByRole("button", { name: "src/a.rs:12" }));
    await waitFor(() => expect(fx.calls.open).toHaveLength(1));
    expect(fx.calls.open[0]).toEqual(["/proj", "src/a.rs", "code --goto %path", 12]);

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("마커가 0건이면 카드 자체를 그리지 않는다", async () => {
    fx.signals = { markers: [], files_scanned: 10, truncated: false };
    const { container } = render(<DeferLedgerPanel projectId={1} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
