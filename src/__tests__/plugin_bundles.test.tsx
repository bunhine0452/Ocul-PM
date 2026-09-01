import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// ─── Osaurus 라운드 Phase 6 — 플러그인 번들 임포트 · 미이행 고지 ───────────
//
// 세 규약을 잰다:
//   1. 미리보기가 먼저다 — 「미리보기」는 dry 로 부르고 설치하지 않는다
//   2. 이행하지 않는 아티팩트가 사유와 함께 화면에 남는다 (조용한 무시 금지)
//   3. 이미 설치된 번들은 **명시적 확인** 없이 교체되지 않는다

import { unusedFieldsFor } from "@/features/settings/automation/automationModel";
import { notHonoredReasonKey } from "@/features/settings/plugins/NotHonoredNotice";
import type { AutomationDef, BundleImportResult } from "@/lib/bindings";

function result(over: Partial<BundleImportResult> = {}): BundleImportResult {
  return {
    manifest: {
      id: "team-kit",
      name: "Team Kit",
      version: "1.2.0",
      description: "팀 공용 스킬 묶음",
      homepage: null,
      manifest_missing: false,
      artifacts: [
        {
          kind: "skill",
          source: "skills/run-evals",
          dest: ".claude/skills/run-evals",
          name: "run-evals",
          reason: null,
        },
        {
          kind: "not_honored",
          source: "hooks/",
          dest: null,
          name: "hooks",
          reason: "hooks_run_shell",
        },
      ],
    },
    report: {
      bundle_id: "team-kit",
      dry: true,
      placements: [],
      wrote: 2,
      unchanged: 0,
      conflicts: 0,
      failed: 0,
      not_honored: [
        {
          kind: "not_honored",
          source: "hooks/",
          dest: null,
          name: "hooks",
          reason: "hooks_run_shell",
        },
      ],
      skipped: [],
    },
    mcp: { added: [], conflicts: [], unreadable: false },
    automations: [],
    already_installed: null,
    ...over,
  };
}

const fx = {
  preview: result(),
  install: result({ report: { ...result().report, dry: false } }),
  calls: [] as Array<{ dry: boolean; replace: boolean }>,
  confirmed: true,
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "pluginImport":
              return (
                _p: number,
                _k: string,
                _s: string,
                dry: boolean,
                replace: boolean,
              ) => {
                fx.calls.push({ dry, replace });
                return ok(dry ? fx.preview : fx.install);
              };
            case "pluginList":
              return () => ok([]);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@/hooks/useConfirm", () => ({
  useConfirm: () => ({
    confirm: () => Promise.resolve(fx.confirmed),
    confirmDialog: null,
  }),
}));

import { PluginBundlesBlock } from "@/features/settings/plugins/PluginBundlesBlock";

beforeEach(() => {
  fx.preview = result();
  fx.install = result({ report: { ...result().report, dry: false } });
  fx.calls = [];
  fx.confirmed = true;
});

afterEach(() => cleanup());

async function openPreview(r: ReturnType<typeof render>) {
  fireEvent.change(r.getByLabelText(/번들 출처/), { target: { value: "owner/repo" } });
  fireEvent.click(r.getByRole("button", { name: "미리보기" }));
  await waitFor(() => expect(r.getByText("Team Kit")).toBeTruthy());
}

describe("PluginBundlesBlock", () => {
  it("미리보기는 dry 로 부르고 설치하지 않는다", async () => {
    const r = render(<PluginBundlesBlock projectId={1} />);
    await openPreview(r);
    expect(fx.calls).toEqual([{ dry: true, replace: false }]);
  });

  it("이행하지 않는 아티팩트를 사유와 함께 적는다", async () => {
    const r = render(<PluginBundlesBlock projectId={1} />);
    await openPreview(r);
    expect(r.getByText(/감지했지만 실행하지 않습니다/)).toBeTruthy();
    expect(r.getByText("hooks")).toBeTruthy();
    expect(r.getByText(/셸 스크립트를 실행합니다/)).toBeTruthy();
  });

  it("놓을 자리를 그대로 보여 준다 — Claude Code 가 읽는 경로", async () => {
    const r = render(<PluginBundlesBlock projectId={1} />);
    await openPreview(r);
    expect(r.getByText(/\.claude\/skills\/run-evals/)).toBeTruthy();
  });

  it("이미 설치돼 있으면 확인을 받고서야 교체한다", async () => {
    fx.install = result({
      report: { ...result().report, dry: false },
      already_installed: {
        id: "team-kit",
        name: "Team Kit",
        version: "1.0.0",
        source: "owner/repo",
        installed_at: "2026-09-01T10:00:00+09:00",
        items: [],
        mcp_keys: [],
        automations: [],
      },
    });
    const r = render(<PluginBundlesBlock projectId={1} />);
    await openPreview(r);

    fireEvent.click(r.getByRole("button", { name: "설치" }));
    await waitFor(() => expect(fx.calls.length).toBe(3));
    expect(fx.calls[1]).toEqual({ dry: false, replace: false });
    expect(fx.calls[2]).toEqual(
      { dry: false, replace: true },
      // 첫 호출은 replace 없이 나가고 아무것도 쓰지 않는다. 확인을 받은
      // 뒤에야 replace 로 다시 부른다 — 확인 없이 덮는 길이 없다.
    );
  });

  it("확인을 거절하면 교체 호출이 나가지 않는다", async () => {
    fx.confirmed = false;
    fx.install = result({
      report: { ...result().report, dry: false },
      already_installed: {
        id: "team-kit",
        name: "Team Kit",
        version: "1.0.0",
        source: "owner/repo",
        installed_at: "t",
        items: [],
        mcp_keys: [],
        automations: [],
      },
    });
    const r = render(<PluginBundlesBlock projectId={1} />);
    await openPreview(r);
    fireEvent.click(r.getByRole("button", { name: "설치" }));
    await waitFor(() => expect(fx.calls.length).toBe(2));
    expect(fx.calls.some((c) => c.replace)).toBe(false);
  });
});

describe("미이행 고지 — 일반화 (#not-honored-notice)", () => {
  it("모르는 사유 코드도 키를 만들어 화면까지 간다", () => {
    expect(notHonoredReasonKey("hooks_run_shell")).toBe("notHonored.reason.hooks_run_shell");
    expect(notHonoredReasonKey(null)).toBe("notHonored.reason.unknown");
  });

  it("빈도를 바꿔 남은 값을 자동화 에디터가 잡는다", () => {
    const def = {
      id: "d",
      kind: "schedule",
      title: "t",
      enabled: false,
      created: "2026-09-01",
      updated: "2026-09-01",
      frequency: "daily",
      at: "09:00",
      weekday: "mon",
      day_of_month: null,
      month: null,
      day: null,
      every: null,
      cron: null,
      watch: null,
      recursive: null,
      responsiveness: null,
      output: "none",
      instructions: "i",
    } as unknown as AutomationDef;
    expect(unusedFieldsFor(def)).toEqual(["weekday"]);
    // `at` 은 daily 가 읽는다 — 읽는 값을 미이행으로 적으면 거짓말이 된다.
    expect(unusedFieldsFor(def)).not.toContain("at");
  });

  it("감시 자동화는 시각 필드를 하나도 읽지 않는다", () => {
    const def = {
      kind: "watcher",
      frequency: "daily",
      at: "09:00",
      cron: null,
      weekday: null,
      every: null,
      day_of_month: null,
      month: null,
      day: null,
      watch: "src",
      responsiveness: "balanced",
    } as unknown as AutomationDef;
    expect(unusedFieldsFor(def).sort()).toEqual(["at", "frequency"]);
  });
});
