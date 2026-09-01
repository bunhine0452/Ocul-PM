import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// ─── Osaurus 라운드 Phase 6 — 선언적 설정 승인 카드 ─────────────────────────
//
// 이 라운드의 규약 셋을 렌더로 단언한다:
//   1. 계획을 **먼저** 보여 준다 — 문서를 여는 것만으로 아무것도 쓰이지 않는다
//   2. 이행 불가 항목이 목록에서 조용히 빠지지 않는다 (사유까지 적힌다)
//   3. 「적용 완료」는 대조 검증(`residual`)이 0 일 때만 말한다

import {
  groupPlan,
  hasWrites,
  reasonKey,
  surfaceLabelKey,
} from "@/features/settings/config/planView";
import type { ConfigPlan, ConfigPlanItem } from "@/lib/bindings";

function item(over: Partial<ConfigPlanItem> = {}): ConfigPlanItem {
  return {
    surface: "settings",
    key: "core_model",
    op: "change",
    from: "sonnet",
    to: "haiku",
    reason: null,
    ...over,
  };
}

function plan(items: ConfigPlanItem[], over: Partial<ConfigPlan> = {}): ConfigPlan {
  const count = (op: string) => items.filter((i) => i.op === op).length;
  return {
    project_root: "/tmp/proj",
    items,
    added: count("add"),
    changed: count("change"),
    unchanged: count("unchanged"),
    blocked: count("blocked"),
    ...over,
  };
}

const fx = {
  plan: plan([]),
  apply: {
    status: "applied" as "applied" | "partial" | "no_op",
    applied: ["core_model"],
    failed: [] as unknown[],
    blocked: 0,
    residual: 0,
  },
  calls: { plan: 0, apply: 0, read: 0 },
  docText: "oculpm_config: v1\n" as string | null,
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "configReadFile":
              return () => {
                fx.calls.read += 1;
                return ok(fx.docText);
              };
            case "configPlan":
              return () => {
                fx.calls.plan += 1;
                return ok(fx.plan);
              };
            case "configApply":
              return () => {
                fx.calls.apply += 1;
                return ok(fx.apply);
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

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ state: { currentProjectId: 3 } }),
}));

import { DeclarativeConfigSection } from "@/features/settings/config/DeclarativeConfigSection";

beforeEach(() => {
  fx.plan = plan([]);
  fx.apply = { status: "applied", applied: ["core_model"], failed: [], blocked: 0, residual: 0 };
  fx.calls = { plan: 0, apply: 0, read: 0 };
  fx.docText = "oculpm_config: v1\n";
});

afterEach(() => cleanup());

describe("planView (순수 함수)", () => {
  it("변경 없음은 줄이 아니라 합계로만 나온다", () => {
    const groups = groupPlan(
      plan([item({ op: "unchanged" }), item({ key: "theme", op: "add", from: null, to: "nord" })]),
    );
    expect(groups.map((g) => g.op)).toEqual(["add"]);
  });

  it("표시 순서는 쓰는 것 먼저, 못 하는 것 마지막", () => {
    const groups = groupPlan(
      plan([
        item({ key: "r.md", surface: "rule", op: "blocked", reason: "content_not_carried" }),
        item({ key: "theme", op: "add" }),
        item({ key: "core_model", op: "change" }),
      ]),
    );
    expect(groups.map((g) => g.op)).toEqual(["add", "change", "blocked"]);
  });

  it("이행 불가만 있으면 쓸 것이 없다 — 적용 버튼이 살아 있으면 안 된다", () => {
    expect(hasWrites(plan([item({ op: "blocked" })]))).toBe(false);
    expect(hasWrites(plan([item({ op: "add" })]))).toBe(true);
  });

  it("모르는 사유 코드도 키를 만들어 넘긴다 (조용히 사라지지 않는다)", () => {
    expect(reasonKey("brand_new_reason")).toBe("settings.declarative.reason.brand_new_reason");
    expect(reasonKey(null)).toBe("settings.declarative.reason.unknown");
    expect(surfaceLabelKey("oculpm_config")).toBe("settings.declarative.surface.oculpm_config");
  });
});

describe("DeclarativeConfigSection", () => {
  it("문서를 열면 계획만 하고 적용하지 않는다", async () => {
    fx.plan = plan([item({ key: "theme", op: "add", from: null, to: "nord" })]);
    const r = render(<DeclarativeConfigSection />);

    fireEvent.click(r.getByRole("button", { name: /문서 열어 계획 보기/ }));
    await waitFor(() => expect(fx.calls.plan).toBe(1));
    expect(fx.calls.apply).toBe(0);
    expect(r.getByText(/설정을 이 상태로 맞춥니다/)).toBeTruthy();
    expect(r.getByText(/theme/)).toBeTruthy();
  });

  it("이행 불가 항목을 사유와 함께 그대로 적는다", async () => {
    fx.plan = plan([
      item({
        surface: "rule",
        key: "typescript/coding-style.md",
        op: "blocked",
        from: null,
        to: "blake3:abc",
        reason: "content_not_carried",
      }),
    ]);
    const r = render(<DeclarativeConfigSection />);
    fireEvent.click(r.getByRole("button", { name: /문서 열어 계획 보기/ }));

    await waitFor(() => expect(r.getByText(/typescript\/coding-style\.md/)).toBeTruthy());
    expect(r.getByText(/이행하지 않음/)).toBeTruthy();
    expect(r.getByText(/해시만 싣습니다/)).toBeTruthy();
    // 쓸 것이 없으므로 적용은 막혀 있다.
    expect(r.getByRole("button", { name: "적용" }).hasAttribute("disabled")).toBe(true);
  });

  it("대조 검증에서 남은 차이가 있으면 «적용 완료» 라고 말하지 않는다", async () => {
    fx.plan = plan([item({ key: "core_model", op: "change" })]);
    fx.apply = {
      status: "partial",
      applied: ["core_model"],
      failed: [],
      blocked: 0,
      residual: 1,
    };
    const r = render(<DeclarativeConfigSection />);
    fireEvent.click(r.getByRole("button", { name: /문서 열어 계획 보기/ }));
    await waitFor(() => expect(r.getByRole("button", { name: "적용" })).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(fx.calls.apply).toBe(1));
    expect(r.getByText(/일부만 적용됨/)).toBeTruthy();
    expect(r.queryByText(/적용 완료/)).toBeNull();
  });

  it("전부 적용됐으면 완료라고 말한다", async () => {
    fx.plan = plan([item({ key: "core_model", op: "change" })]);
    const r = render(<DeclarativeConfigSection />);
    fireEvent.click(r.getByRole("button", { name: /문서 열어 계획 보기/ }));
    await waitFor(() => expect(r.getByRole("button", { name: "적용" })).toBeTruthy());

    fireEvent.click(r.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(r.getByText(/적용 완료/)).toBeTruthy());
  });

  it("파일 선택을 취소하면 카드가 뜨지 않는다", async () => {
    fx.docText = null;
    const r = render(<DeclarativeConfigSection />);
    fireEvent.click(r.getByRole("button", { name: /문서 열어 계획 보기/ }));
    await waitFor(() => expect(fx.calls.read).toBe(1));
    expect(fx.calls.plan).toBe(0);
    expect(r.queryByText(/설정을 이 상태로 맞춥니다/)).toBeNull();
  });
});
