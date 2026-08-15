import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── ocul-pm 설정 하위 탭 (2026-07-20) ──────────────────────────────────────
//
// PR-CI0~CI8 이 얹은 블록들로 한 화면이 과하게 길어져 5분할했다. 계약:
// 탭 하나만 렌더되고(스크롤 길이 억제), 전환이 동작하며, 기본은 "기록".

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));

import { OculpmSettings, SubTabs } from "@/features/settings/OculpmSettings";

function Harness() {
  const [tab, setTab] = useState<
    "record" | "agents" | "automation" | "integration" | "logs"
  >("record");
  return (
    <div>
      <SubTabs value={tab} onChange={setTab} />
      <div data-testid="active">{tab}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("ocul-pm 설정 하위 탭", () => {
  it("5개 탭이 tablist 로 노출되고 기본 선택은 기록", () => {
    const r = render(<Harness />);
    const tabs = r.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "기록",
      "에이전트",
      "자동화",
      "연동",
      "로그",
    ]);
    expect(r.getByRole("tab", { name: "기록" }).getAttribute("aria-selected")).toBe("true");
    expect(r.getByTestId("active").textContent).toBe("record");
  });

  it("탭 클릭이 선택 상태를 옮긴다 (aria-selected 는 항상 하나)", async () => {
    const r = render(<Harness />);
    fireEvent.click(r.getByRole("tab", { name: "연동" }));
    await waitFor(() => expect(r.getByTestId("active").textContent).toBe("integration"));
    const selected = r.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe("연동");
  });

  it("a11y — axe 위반 0", async () => {
    const r = render(<Harness />);
    expect(summarize(await axe(r.container, AXE_OPTIONS))).toEqual([]);
  });
});

// 시작 탭(런처)은 `WorkspaceProvider` 를 마운트하지 않는다. 설정 오버레이는
// 시작 탭·프로젝트 탭 양쪽에서 같은 패널을 띄우므로, 이 화면이 워크스페이스를
// **필수로** 요구하면 시작 탭에서 예외가 나고 경계가 없어 창 전체가 빈 화면이
// 된다 (실기기 발견 2026-08-16). 빈 상태로 살아남아야 한다.
describe("ocul-pm 설정 — 워크스페이스 없는 창", () => {
  it("프로젝트가 없어도 크래시 대신 안내를 보여준다", () => {
    const r = render(<OculpmSettings />);
    expect(r.getByText("프로젝트를 먼저 선택하세요.")).toBeInTheDocument();
  });
});
